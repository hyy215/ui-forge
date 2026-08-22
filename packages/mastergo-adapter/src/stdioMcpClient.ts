/** 通过受控子进程实现最小 MCP stdio 客户端，不向模型暴露 Shell。 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
});

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

/** 提供 MCP 工具调用和资源释放所需的最小客户端契约。 */
export interface McpClient {
  callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** 配置受控 MCP stdio 子进程的命令、环境和超时。 */
export interface StdioMcpClientOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

/** 管理 MCP 初始化握手、JSON-RPC 请求关联和子进程生命周期。 */
export class StdioMcpClient implements McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private nextRequestId = 1;
  private initialized: Promise<void>;

  /** 启动指定的固定 MCP 命令，并立即准备初始化握手。 */
  constructor(options: StdioMcpClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.child = spawn(options.command, options.args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.resume();
    this.child.once("error", () => this.rejectAll(new Error("MasterGo MCP 进程启动失败。")));
    this.child.once("exit", (code, signal) => {
      if (this.pending.size === 0) return;
      const reason = code === 0 && signal === null ? "连接已关闭" : "进程异常退出";
      this.rejectAll(new Error(`MasterGo MCP ${reason}。`));
    });

    this.initialized = this.initialize();
  }

  /** 完成 MCP initialize/initialized 握手。 */
  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ui-forge", version: "0.1.0" },
    });
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** 调用 MCP Server 已注册的一个结构化工具。 */
  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> {
    await this.initialized;
    return this.request("tools/call", { name, arguments: argumentsValue });
  }

  /** 关闭 stdin 并终止仅由当前客户端创建的 MCP 子进程。 */
  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }

  /** 发送带超时和响应关联的 JSON-RPC 请求。 */
  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MasterGo MCP 请求超时：${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** 将单条 JSON-RPC 消息写入 stdio 传输。 */
  private write(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** 校验并分派 MCP Server 的单行 JSON-RPC 响应。 */
  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const responseResult = jsonRpcResponseSchema.safeParse(parsed);
    if (!responseResult.success || typeof responseResult.data.id !== "number") return;
    const pending = this.pending.get(responseResult.data.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(responseResult.data.id);
    if (responseResult.data.error) {
      pending.reject(new Error("MasterGo MCP 调用失败。"));
      return;
    }
    pending.resolve(responseResult.data.result);
  }

  /** 让所有等待中的请求以同一进程错误结束。 */
  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
