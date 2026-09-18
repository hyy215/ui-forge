import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { CodexEvent, PendingRequest } from "@ui-forge/codex-client";
import type { NativeThread } from "@ui-forge/shared-protocol";
import type { CodexConnection } from "../runtime/codexConnections.js";
import { SessionService } from "./sessionService.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** 只模拟 SessionService 在本测试中实际使用的原生调用。 */
class FakeCodex {
  readonly calls: { method: string; params: unknown }[] = [];
  readonly threads = new Map<string, NativeThread>();
  private readonly listeners = new Set<(event: CodexEvent) => void>();

  constructor(private readonly cwd: string) {}

  async prepareD2C() {
    return {
      thread: { cwd: this.cwd, config: {} },
      input: [{ type: "text" as const, text: "Build", text_elements: [] }],
    };
  }

  async prepareD2CRuntime() {
    return {
      cwd: this.cwd,
      config: {},
      skillPath: "/fixture/SKILL.md",
      temporaryDirectory: this.cwd,
    };
  }

  subscribe(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  pendingRequests(): readonly PendingRequest[] {
    return [];
  }

  async respond(_token: string, _result: unknown): Promise<void> {}

  async close(): Promise<void> {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const input = z.record(z.string(), z.unknown()).parse(params);
    if (method === "config/read") return { config: { mcp_servers: {} } };
    if (method === "thread/start") {
      const thread: NativeThread = {
        id: "task",
        cwd: this.cwd,
        preview: "Build",
        name: null,
        createdAt: 1,
        updatedAt: 1,
        status: { type: "idle" },
        turns: [],
      };
      this.threads.set(thread.id, thread);
      return { thread: structuredClone(thread) };
    }
    const threadId = String(input.threadId);
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("missing thread");
    if (method === "thread/read" || method === "thread/resume")
      return { thread: structuredClone(thread) };
    if (method === "turn/start") {
      const turn: NativeThread["turns"][number] = {
        id: `${threadId}-turn-${thread.turns.length}`,
        status: "inProgress",
        items: [],
        error: null,
      };
      thread.turns.push(turn);
      thread.status = { type: "active" };
      this.emit("turn/started", { threadId, turn });
      return { turn };
    }
    if (method === "turn/steer") return { turnId: String(input.expectedTurnId) };
    if (method === "turn/interrupt") {
      const turn = thread.turns.find((entry) => entry.id === input.turnId);
      if (!turn) throw new Error("missing turn");
      turn.status = "interrupted";
      thread.status = { type: "idle" };
      this.emit("turn/completed", { threadId, turn });
      return {};
    }
    throw new Error(`unexpected ${method}`);
  }

  private emit(method: string, params: unknown): void {
    for (const listener of this.listeners)
      listener({ type: "unknownNotification", notification: { method, params } });
  }
}

it("never steers an idle-only continuation into a turn started by another client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-resume-race-"));
  directories.push(directory);
  const client = new FakeCodex(directory);
  const service = new SessionService({
    directory,
    connectionFactory: () => client as unknown as CodexConnection,
  });
  await service.initialize();
  try {
    const { taskId } = await service.create({ projectPath: directory, prompt: "Build", images: [] });

    const activeStart = client.calls.length;
    await service.send(taskId, "automatic continuation", [], true);
    expect(
      client.calls
        .slice(activeStart)
        .filter((call) => call.method === "turn/start" || call.method === "turn/steer"),
    ).toEqual([]);

    await service.stop(taskId, `${taskId}-turn-0`);
    const concurrentStart = client.calls.length;
    await Promise.all([
      service.send(taskId, "explicit user change"),
      service.send(taskId, "automatic continuation", [], true),
    ]);
    const turnCalls = client.calls
      .slice(concurrentStart)
      .filter((call) => call.method === "turn/start" || call.method === "turn/steer");
    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]).toMatchObject({
      method: "turn/start",
      params: {
        input: [{ type: "text", text: "explicit user change", text_elements: [] }],
      },
    });
    expect(client.threads.get(taskId)?.turns).toHaveLength(2);
  } finally {
    await service.close();
  }
});
