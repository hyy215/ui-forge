/** CLI 传输边界：所有客户端复用本地权威服务，协议协商失败不能静默启动另一套工作流。 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readCommunicationStream } from "@ui-forge/client-core";
import { z } from "zod";
import {
  communicationResponseMessageSchema,
  createCommunicationRequestMessage,
  createCommunicationProtocolNegotiationInput,
  communicationTransportMethods,
  negotiateCommunicationProtocolResultSchema,
  createCommunicationStreamRequestMessage,
  sessionEventSchema,
  sessionMethods,
  type SessionEvent,
} from "@ui-forge/shared-protocol";

/** 只访问当前机器上的明确服务地址，不向远端提交项目路径和设计。 */
export class LocalClient {
  readonly address: string;
  /** 校验可配置端口；服务固定监听 IPv4 loopback。 */
  constructor(port = Number(process.env.UI_FORGE_PORT ?? 4310)) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
      throw new Error("UI_FORGE_PORT 必须是有效端口。");
    this.address = `http://127.0.0.1:${port}`;
  }
  /** 请求和响应均使用 shared-protocol，结果还需由调用方的领域 Schema 校验。 */
  async request<T>(method: string, params: unknown, schema: z.ZodType<T>): Promise<T> {
    const id = randomUUID();
    const response = await fetch(`${this.address}/api/communication`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createCommunicationRequestMessage(id, method, params)),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`本地服务返回 HTTP ${response.status}。`);
    const result = communicationResponseMessageSchema.parse(await response.json());
    if (result.requestId !== id) throw new Error("本地服务返回错误的请求身份。");
    if (!result.success) throw new Error(result.error.message);
    return schema.parse(result.data);
  }
  /** 逐条校验原生事件流；取消只断开当前 HTTP 连接。 */
  async subscribe(
    taskId: string,
    receive: (event: SessionEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const requestId = randomUUID();
    try {
      const response = await fetch(`${this.address}/api/communication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createCommunicationStreamRequestMessage(requestId, sessionMethods.subscribe, { taskId }),
        ),
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`会话流不可用：HTTP ${response.status}`);
      for await (const message of readCommunicationStream(response.body, requestId, signal)) {
        if (message.kind === "stream-error") throw new Error(message.error.message);
        if (message.kind === "stream-event") receive(sessionEventSchema.parse(message.event));
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
  /** 已有服务必须通过协议协商；仅连接被拒绝时启动同一 CLI 的后台服务。 */
  async connect(autoStart = true): Promise<void> {
    let reachable = false;
    try {
      await fetch(`${this.address}/health`, { signal: AbortSignal.timeout(1500) });
      reachable = true;
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        !error.cause ||
        typeof error.cause !== "object" ||
        !("code" in error.cause) ||
        error.cause.code !== "ECONNREFUSED"
      )
        throw new Error("本地服务不可达；请检查 ui-forge serve。");
    }
    if (!reachable) {
      if (!autoStart) throw new Error("本地服务未启动，请运行 ui-forge serve。");
      const root = fileURLToPath(new URL("../../../", import.meta.url));
      await mkdir(join(root, ".ui-forge"), { recursive: true, mode: 0o700 });
      const log = await open(join(root, ".ui-forge", "server.log"), "a", 0o600);
      try {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./main.js", import.meta.url)), "serve"],
          {
            cwd: root,
            detached: true,
            stdio: ["ignore", log.fd, log.fd],
            env: { ...process.env, UI_FORGE_PORT: new URL(this.address).port },
            shell: false,
          },
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } finally {
        await log.close();
      }
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try {
          await fetch(`${this.address}/health`, { signal: AbortSignal.timeout(1000) });
          reachable = true;
          break;
        } catch {
          /* 等待同一实例取得锁并监听。 */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!reachable)
        throw new Error("本地服务启动失败，请查看 .ui-forge/server.log 或运行 ui-forge serve。");
    }
    await this.request(
      communicationTransportMethods.negotiateProtocol,
      createCommunicationProtocolNegotiationInput(),
      negotiateCommunicationProtocolResultSchema,
    );
  }
}
