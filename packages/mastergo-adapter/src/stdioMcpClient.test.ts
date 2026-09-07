/** 验证共享 MCP 连接终止时不会遗留并发请求或继续写入已关闭传输。 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StdioMcpClient } from "./stdioMcpClient.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => vi.clearAllMocks());

/** 使用内存管道模拟握手和悬而未决的工具请求，不启动外部 MCP。 */
function createClient(initialize = true) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: Array<{ id?: number; method: string }> = [];
  const child = Object.assign(new EventEmitter(), {
    stdin, stdout, stderr, exitCode: null, signalCode: null,
    kill: vi.fn(() => { stdout.end(); stderr.end(); return true; }),
  });
  stdin.on("data", (chunk: Buffer) => {
    const message = JSON.parse(chunk.toString()) as { id?: number; method: string };
    requests.push(message);
    if (initialize && message.method === "initialize") queueMicrotask(() => {
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
    });
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  return { client: new StdioMcpClient({ command: "mock-mcp", args: [] }), stdin, requests };
}

describe("StdioMcpClient terminal lifecycle", () => {
  it("rejects all pending calls and sends no requests after close", async () => {
    const { client, requests } = createClient();
    const pending = Promise.allSettled([client.callTool("dsl", {}), client.callTool("svg", {})]);
    await vi.waitFor(() => expect(requests.filter((request) => request.method === "tools/call")).toHaveLength(2));
    await client.close();
    expect((await pending).every((result) => result.status === "rejected")).toBe(true);
    const count = requests.length;
    await expect(client.callTool("later", {})).rejects.toThrow("连接已关闭");
    await client.close();
    expect(requests).toHaveLength(count);
  });

  it("handles closing before initialization without leaving a handshake timeout", async () => {
    const { client, requests } = createClient(false);
    await client.close();
    await expect(client.callTool("later", {})).rejects.toThrow("连接已关闭");
    expect(requests).toHaveLength(1);
  });

  it("terminates pending work on stdin failure and rejects future calls", async () => {
    const { client, stdin, requests } = createClient();
    const pending = client.callTool("dsl", {});
    const rejected = expect(pending).rejects.toThrow("写入连接失败");
    await vi.waitFor(() => expect(requests.some((request) => request.method === "tools/call")).toBe(true));
    stdin.emit("error", new Error("simulated transport failure"));
    await rejected;
    await expect(client.callTool("later", {})).rejects.toThrow("连接已关闭");
    await client.close();
  });
});
