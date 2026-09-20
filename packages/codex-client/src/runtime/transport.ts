/** 托管 Codex stdio 连接，只处理 JSONL 分帧、RPC 关联和进程释放。 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { CodexProcessError, CodexRpcError, CodexTimeoutError } from "../errors.js";
import { StderrTail } from "./diagnostics.js";
import { explainCodexStartupError, resolveCodexExecutable } from "./executable.js";
import { bindHostLifecycle } from "./hostLifecycle.js";

const idSchema = z.union([z.string(), z.number().int()]);
const messageSchema = z.looseObject({
  method: z.string(),
  params: z.unknown(),
  id: idSchema.optional(),
});
const responseSchema = z.union([
  z.object({
    id: idSchema,
    error: z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
  }),
  z.object({ id: idSchema, result: z.unknown() }).refine((value) => Object.hasOwn(value, "result")),
]);
const envelopeSchema = z.union([messageSchema, responseSchema]);
type Message = z.infer<typeof messageSchema>;
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const LATE_RETENTION_MS = 5 * 60_000;
const MAX_LATE_REQUESTS = 128;

/** 已超时请求的迟到响应；仅保留请求关联信息，不缓存用户输入。 */
export type LateResponse = {
  /** 当前连接内的请求 ID。 */
  requestId: number;
  /** 原生请求方法。 */
  method: string;
  /** 原生 JSON-RPC 响应。 */
  response: z.infer<typeof responseSchema>;
};

/** 单个进程的 RPC 连接；不维护线程、轮次或业务结果。 */
export class StdioTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private readonly late = new Map<number, { method: string; expiresAt: number }>();
  private readonly stderr = new StderrTail();
  private readonly unbindHost: () => void;
  private readonly fragments: Buffer[] = [];
  private frameBytes = 0;
  private sequence = 0;
  private failure: Error | undefined;
  private killTimer: NodeJS.Timeout | undefined;
  private readonly timeoutMs: number;
  /** 进程实际退出时完成。 */
  readonly closed: Promise<void>;

  /** 启动原生 app-server；连接错误通过 onClose 报告。 */
  constructor(
    options: {
      executable: string;
      cwd: string;
      requestTimeoutMs: number;
      configOverrides?: Record<string, string | number | boolean>;
    },
    private readonly onMessage: (message: Message) => void,
    private readonly onClose: (error: Error) => void,
    private readonly onLateResponse: (response: LateResponse) => void,
  ) {
    this.timeoutMs = options.requestTimeoutMs;
    const executable = resolveCodexExecutable(options.executable, options.cwd);
    // Codex 的点分键按原文解析；插件 ID 不额外加引号，值独立编码且不经过 shell。
    const overrides = Object.entries(options.configOverrides ?? {}).flatMap(([key, value]) => [
      "-c",
      `${key}=${JSON.stringify(value)}`,
    ]);
    this.child = spawn(executable, ["app-server", "--listen", "stdio://", ...overrides], {
      cwd: options.cwd,
      stdio: "pipe",
    });
    this.closed = new Promise((resolve) => {
      this.child.once("close", (code, signal) => {
        this.stop(new CodexProcessError(code, signal, this.stderr.read()), false);
        clearTimeout(this.killTimer);
        this.unbindHost();
        resolve();
      });
    });
    this.child.once("error", (error) =>
      this.stop(explainCodexStartupError(error, executable, options.cwd)),
    );
    this.child.stdin.on("error", (error) => this.stop(error));
    this.child.stdout.on("error", (error) => this.stop(error));
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => this.stderr.append(chunk));
    this.unbindHost = bindHostLifecycle(() => this.close(new Error("Codex host is shutting down")));
  }

  /** 发送一次 RPC，超时仅拒绝本次等待，不重试或停止 Codex 任务。 */
  request(method: string, params: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const now = Date.now();
        for (const [key, entry] of this.late) if (entry.expiresAt <= now) this.late.delete(key);
        this.late.set(id, { method, expiresAt: now + LATE_RETENTION_MS });
        while (this.late.size > MAX_LATE_REQUESTS) this.late.delete(this.late.keys().next().value!);
        reject(new CodexTimeoutError(id, method, this.timeoutMs));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ id, method, params }).catch((error: Error) => this.stop(error));
    });
  }

  /** 写入通知或交互回复；不改写载荷。 */
  send(message: unknown): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  /** 关闭宿主持有的进程，拒绝所有未完成的 RPC。 */
  close(error = new Error("Codex connection closed by host")): Promise<void> {
    this.stop(error);
    return this.closed;
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    try {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline;
        this.frameBytes += end - start;
        if (this.frameBytes > MAX_FRAME_BYTES) throw new Error("Codex JSONL frame exceeds 16 MiB");
        this.fragments.push(chunk.subarray(start, end));
        if (newline < 0) return;
        const line = Buffer.concat(this.fragments, this.frameBytes).toString("utf8");
        this.fragments.length = 0;
        this.frameBytes = 0;
        if (line.trim()) this.dispatch(JSON.parse(line) as unknown);
        if (this.failure) return;
        start = newline + 1;
      }
    } catch (error) {
      this.stop(
        error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)
          ? error
          : new Error("Invalid message from Codex app-server"),
      );
    }
  }

  private dispatch(value: unknown): void {
    const message = envelopeSchema.parse(value);
    if ("method" in message) {
      this.onMessage(message);
      return;
    }
    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!pending) {
      const id = typeof message.id === "number" ? message.id : undefined;
      const late = id === undefined ? undefined : this.late.get(id);
      if (id !== undefined) this.late.delete(id);
      if (id !== undefined && late && late.expiresAt > Date.now()) {
        this.onLateResponse({ requestId: id, method: late.method, response: message });
      }
      return;
    }
    this.pending.delete(Number(message.id));
    clearTimeout(pending.timer);
    if ("error" in message) pending.reject(new CodexRpcError(message.error));
    else pending.resolve(message.result);
  }

  private stop(error: Error, terminate = true): void {
    if (this.failure) return;
    this.failure = error;
    this.fragments.length = 0;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.late.clear();
    if (terminate) {
      this.child.kill("SIGTERM");
      this.killTimer = setTimeout(() => this.child.kill("SIGKILL"), 1_000);
      this.killTimer.unref();
    }
    this.onClose(error);
  }
}
