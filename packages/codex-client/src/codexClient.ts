/** 为 ui-forge 提供 Codex 原生请求、事件和交互回复的薄接入层。 */
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { bundleDirectory, prepareD2C, type D2COptions, type PreparedD2C } from "./d2c.js";
import {
  prepareD2CRuntime,
  type D2CRuntimeOptions,
  type PreparedD2CRuntime,
} from "./d2cRuntime.js";
import type {
  InitializeResponse,
  NativeMethods,
  ServerNotification,
  ServerRequest,
} from "./generated/native.js";
import { nativeNotificationMethods, nativeSchemas, validateNative } from "./protocol.js";
import { StdioTransport, type LateResponse } from "./runtime/transport.js";

const optionsSchema = z.strictObject({
  cwd: z.string().refine(isAbsolute, "cwd must be absolute"),
  executable: z.string().min(1).default("codex"),
  requestTimeoutMs: z.number().int().positive().max(2_147_483_647).default(60_000),
  signal: z.instanceof(AbortSignal).optional(),
  configOverrides: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
});

/** 进程启动选项；configOverrides 是 Codex -c 使用的点分键与标量值，在插件加载前生效且不写入配置文件。 */
export type CodexClientOptions = z.input<typeof optionsSchema>;
/** 可调用的原生方法；初始化由 connect 统一完成。 */
export type CodexMethod = Exclude<keyof NativeMethods, "initialize">;
/** 未回复的原生交互请求；token 防止宿主误回复过期或其他连接的请求。 */
export type PendingRequest = { token: string; request: ServerRequest };
/** 连接事件；notification 和 request 保留 Codex 的原生字段。 */
export type CodexEvent =
  | { type: "notification"; notification: ServerNotification }
  | { type: "unknownNotification"; notification: { method: string; params?: unknown } }
  | { type: "unsupportedRequest"; requestId: ServerRequest["id"]; method: string }
  | ({ type: "lateResponse" } & LateResponse)
  | ({ type: "request" } & PendingRequest)
  | { type: "close"; error: Error };

/** 一个宿主持有一个连接；页面取消订阅不会停止 Codex 执行。 */
export class CodexClient {
  private readonly options: z.output<typeof optionsSchema>;
  private readonly listeners = new Set<(event: CodexEvent) => void>();
  private readonly requests = new Map<ServerRequest["id"], PendingRequest>();
  private readonly replying = new Set<string>();
  private transport: StdioTransport | undefined;
  private initialization: Promise<InitializeResponse> | undefined;
  private disposed = false;
  private readonly onAbort = (): void => {
    void this.close();
  };

  /** 保存并校验启动参数；直到 connect/request 才启动进程。 */
  constructor(options: CodexClientOptions) {
    this.options = optionsSchema.parse(options);
    if (this.options.signal?.aborted) this.disposed = true;
    else this.options.signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  /** 加载包配置和共享规则，准备原生请求；只启动通信进程，不启动任务或 MCP。 */
  async prepareD2C(options: D2COptions): Promise<PreparedD2C> {
    const prepared = await prepareD2C(this.options.cwd, options, () =>
      this.request("config/read", { cwd: bundleDirectory, includeLayers: true }),
    );
    await this.registerD2CSkills();
    return prepared;
  }

  /** 恢复会话仅重载工具配置与 skill，不读取当前规则或生成新的模型输入。 */
  async prepareD2CRuntime(options: D2CRuntimeOptions = {}): Promise<PreparedD2CRuntime> {
    const prepared = await prepareD2CRuntime(this.options.cwd, options, () =>
      this.request("config/read", { cwd: bundleDirectory, includeLayers: true }),
    );
    await this.registerD2CSkills();
    return prepared;
  }

  /** 新建和恢复均向当前原生进程注册包内 skill 根目录。 */
  private async registerD2CSkills(): Promise<void> {
    await this.request("skills/extraRoots/set", {
      extraRoots: [join(bundleDirectory, ".agents/skills")],
    });
  }

  /** 启动进程并完成一次握手；并发调用共享同一次初始化。关闭后请创建新实例。 */
  connect(): Promise<InitializeResponse> {
    if (this.disposed) return Promise.reject(new Error("Codex client is closed"));
    if (!this.initialization) {
      const transport = new StdioTransport(
        this.options,
        (message) => {
          if (message.id !== undefined) {
            if (!Object.hasOwn(nativeSchemas.serverReplies, message.method)) {
              void transport
                .send({
                  id: message.id,
                  error: { code: -32601, message: "Unsupported Codex server request" },
                })
                .catch((error: Error) => transport.close(error));
              this.emit({
                type: "unsupportedRequest",
                requestId: message.id,
                method: message.method,
              });
              return;
            }
            validateNative("ServerRequest", message);
            const request = message as ServerRequest;
            if (this.requests.has(request.id)) throw new Error("Duplicate Codex server request ID");
            const pending = { token: randomUUID(), request };
            this.requests.set(request.id, pending);
            this.emit({ type: "request", ...pending });
          } else {
            if (!nativeNotificationMethods.has(message.method)) {
              this.emit({ type: "unknownNotification", notification: message });
              return;
            }
            validateNative("ServerNotification", message);
            const notification = message as ServerNotification;
            if (notification.method === "serverRequest/resolved")
              this.requests.delete(notification.params.requestId);
            this.emit({ type: "notification", notification });
          }
        },
        (error) => {
          this.disposed = true;
          this.options.signal?.removeEventListener("abort", this.onAbort);
          this.requests.clear();
          this.replying.clear();
          this.emit({ type: "close", error });
        },
        (late) => {
          const schema = nativeSchemas.clientMethods[late.method as keyof NativeMethods];
          if ("result" in late.response) validateNative(schema.result, late.response.result);
          this.emit({ type: "lateResponse", ...late });
        },
      );
      this.transport = transport;
      this.initialization = (async () => {
        try {
          const result = await transport.request("initialize", {
            clientInfo: { name: "ui_forge", title: "ui-forge", version: "0.1.0" },
            capabilities: { experimentalApi: true, requestAttestation: false },
          } satisfies NativeMethods["initialize"]["params"]);
          validateNative(nativeSchemas.clientMethods.initialize.result, result);
          await transport.send({ method: "initialized" });
          return result as InitializeResponse;
        } catch (error) {
          await transport.close(
            error instanceof Error ? error : new Error("Codex initialization failed"),
          );
          throw error;
        }
      })();
    }
    return this.initialization;
  }

  /** 直接调用原生方法并校验边界；不合成任务状态、汇总结果或自动重试。 */
  async request<M extends CodexMethod>(
    method: M,
    params: NativeMethods[M]["params"],
  ): Promise<NativeMethods[M]["result"]> {
    if (!Object.hasOwn(nativeSchemas.clientMethods, method) || String(method) === "initialize") {
      throw new Error(`Unsupported Codex method: ${String(method)}`);
    }
    const schema = nativeSchemas.clientMethods[method];
    validateNative(schema.params, params);
    await this.connect();
    const result = await this.transport!.request(method, params);
    validateNative(schema.result, result);
    return result as NativeMethods[M]["result"];
  }

  /** 订阅后续原生事件，返回取消订阅函数；订阅者异常不会影响连接。 */
  subscribe(listener: (event: CodexEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 返回尚未回复的交互，供页面重连后重新展示；历史从 thread/read 等原生方法获取。 */
  pendingRequests(): readonly PendingRequest[] {
    return [...this.requests.values()];
  }

  /** 按请求对应的原生响应 Schema 校验并转发用户决定，不自动接受或更改决定。 */
  async respond(token: string, result: unknown): Promise<void> {
    const pending = [...this.requests.values()].find((value) => value.token === token);
    if (!pending || this.replying.has(token)) throw new Error("Codex request is no longer pending");
    validateNative(nativeSchemas.serverReplies[pending.request.method], result);
    this.replying.add(token);
    try {
      await this.transport!.send({ id: pending.request.id, result });
      if (this.requests.get(pending.request.id) === pending)
        this.requests.delete(pending.request.id);
    } finally {
      this.replying.delete(token);
    }
  }

  /** 释放进程并拒绝等待中的请求；宿主退出、IPC 断开或 signal 取消时也会清理。 */
  async close(): Promise<void> {
    this.disposed = true;
    this.options.signal?.removeEventListener("abort", this.onAbort);
    await this.transport?.close();
  }

  private emit(event: CodexEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* UI subscriber failures do not terminate Codex. */
      }
    }
  }
}
