import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { z } from "zod";
import type {
  CodexEvent,
  CodexMethod,
  NativeMethods,
  PendingRequest,
} from "@ui-forge/codex-client";
import type { NativeThread, NativeTurn, SessionEvent } from "@ui-forge/shared-protocol";
import { StdioTransport } from "../../../../packages/codex-client/src/runtime/transport.js";
import type { CodexConnection } from "../runtime/codexConnections.js";
import { SessionService } from "./sessionService.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

type Mode = "completed" | "failed" | "interrupted" | "inProgress" | "silent";
const modes: Mode[] = ["completed", "failed", "interrupted", "inProgress", "silent"];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});

/** Keep the real JSONL/RPC transport; only the process and unrelated Codex calls are fixtures. */
class OrderedCodex implements CodexConnection {
  readonly thread: NativeThread;
  mode: Mode = "completed";
  reads = 0;
  private readonly listeners = new Set<(event: CodexEvent) => void>();
  private readonly requestIds: number[] = [];
  private readonly child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (): boolean => {
      queueMicrotask(() => this.child.emit("close", 0, null));
      return true;
    },
  });
  private readonly transport: StdioTransport;

  constructor(private readonly cwd: string) {
    this.thread = {
      id: "task",
      cwd,
      preview: "test",
      name: null,
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      turns: [],
    };
    this.child.stdin.on("data", (chunk: Buffer) => {
      const request = z.object({ id: z.number() }).parse(JSON.parse(chunk.toString("utf8")));
      this.requestIds.push(request.id);
    });
    vi.mocked(spawn).mockReturnValue(this.child as unknown as ReturnType<typeof spawn>);
    this.transport = new StdioTransport(
      { executable: process.execPath, cwd, requestTimeoutMs: 2_000 },
      (message) => this.emit(message.method, message.params),
      (error) => {
        for (const listener of this.listeners) listener({ type: "close", error });
      },
      () => {
        throw new Error("unexpected late response");
      },
    );
  }

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

  async respond(_token: string, _result: unknown): Promise<void> {
    throw new Error("unexpected reply");
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners)
      listener({ type: "unknownNotification", notification: { method, params } });
  }

  async request<M extends CodexMethod>(
    method: M,
    params: NativeMethods[M]["params"],
  ): Promise<NativeMethods[M]["result"]> {
    let result: unknown;
    if (method === "config/read") result = { config: { mcp_servers: {} } };
    else if (method === "thread/start") result = { thread: structuredClone(this.thread) };
    else if (method === "thread/read") {
      this.reads++;
      result = { thread: structuredClone(this.thread) };
    } else if (method === "turn/start") {
      const turn: NativeTurn = {
        id: `turn-${this.thread.turns.length}`,
        status: "inProgress",
        error: null,
        items: [{ id: `user-${this.thread.turns.length}`, type: "userMessage", content: [] }],
      };
      this.thread.turns.push(turn);
      const waiting = this.transport.request(method, params);
      const frames: unknown[] = [
        { id: this.requestIds.at(-1), result: { turn: structuredClone(turn) } },
      ];
      if (this.mode !== "silent") {
        frames.push({
          method: "turn/started",
          params: { threadId: this.thread.id, turn: structuredClone(turn) },
        });
        const item = { id: `answer-${turn.id}`, type: "agentMessage", text: "latest output" };
        turn.items.push(item);
        frames.push({
          method: "item/completed",
          params: { threadId: this.thread.id, turnId: turn.id, item },
        });
        if (this.mode !== "inProgress") {
          turn.status = this.mode;
          turn.error = this.mode === "failed" ? { message: "model failed" } : null;
          frames.push({
            method: "turn/completed",
            params: { threadId: this.thread.id, turn: structuredClone(turn) },
          });
        }
      }
      // One stdout chunk: resolve the RPC, then process newer notifications before await resumes.
      this.child.stdout.emit(
        "data",
        Buffer.from(frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n"),
      );
      result = await waiting;
    } else throw new Error(`unexpected ${method}`);
    return result as NativeMethods[M]["result"];
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-turn-order-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const client = new OrderedCodex(directory);
  const service = new SessionService({ directory, connectionFactory: () => client });
  cleanups.push(() => service.close());
  await service.initialize();
  return { directory, client, service };
}

async function reconnect(service: SessionService, taskId: string) {
  const controller = new AbortController();
  const stream = service.subscribe(taskId, controller.signal)[Symbol.asyncIterator]();
  try {
    const event = (await stream.next()).value;
    if (event?.type !== "snapshot") throw new Error("expected initial snapshot");
    return event.snapshot;
  } finally {
    controller.abort();
    await stream.return?.();
  }
}

describe.each(["create", "send"] as const)("%s response ordering", (operation) => {
  it.each(modes)("preserves %s state and output across subscriptions", async (mode) => {
    const { service, client, directory } = await setup();
    const input = { projectPath: directory, prompt: "Build", images: [] };
    if (operation === "create") {
      client.mode = mode;
      expect(await service.create(input)).toEqual({ taskId: client.thread.id });
    } else {
      await service.create(input);
      client.mode = mode;
      const controller = new AbortController();
      const stream = service.subscribe(client.thread.id, controller.signal)[Symbol.asyncIterator]();
      try {
        expect((await stream.next()).value?.type).toBe("snapshot");
        await service.send(client.thread.id, "Continue");
        client.emit("fixture/drained", { threadId: client.thread.id });
        const events: SessionEvent[] = [];
        for (;;) {
          const event = (await stream.next()).value;
          if (!event) throw new Error("missing fixture sentinel");
          if (event.type === "notification" && event.notification.method === "fixture/drained")
            break;
          events.push(event);
        }
        expect(
          events.filter(
            (event) =>
              event.type === "notification" && event.notification.method === "turn/started",
          ),
        ).toHaveLength(1);
      } finally {
        controller.abort();
        await stream.return?.();
      }
      expect(client.thread.turns).toHaveLength(2);
    }
    const reads = client.reads;
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await reconnect(service, client.thread.id);
      expect(snapshot.thread.turns).toEqual(client.thread.turns);
      expect(snapshot.thread.turns.at(-1)?.status).toBe(mode === "silent" ? "inProgress" : mode);
    }
    // Reconnection reads the presentation cache, not thread/read as a hidden repair.
    expect(client.reads).toBe(reads);
  });
});
