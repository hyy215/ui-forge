import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CodexEvent,
  CodexMethod,
  NativeMethods,
  PendingRequest as CodexPending,
} from "@ui-forge/codex-client";
import {
  readInstructions,
  saveInstructions,
  prepareTemporaryWorkspace,
} from "@ui-forge/codex-client";
import { z } from "zod";
import {
  createCommunicationRequestMessage,
  communicationResponseMessageSchema,
  sessionMethods,
  instructionMethods,
  type NativeThread,
} from "@ui-forge/shared-protocol";
import { SessionService } from "./sessionService.js";
import { CodexConnections, type CodexConnection } from "../runtime/codexConnections.js";
import { InstructionService } from "../instructions/instructionService.js";
import { buildApp } from "../http/buildApp.js";

const directories: string[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeCodex implements CodexConnection {
  inheritedServers: unknown = {
    node_repl: { command: "node-repl", enabled: true },
    cua_repl: { command: "cua", enabled: true },
    "computer-use": { command: "computer-use", enabled: true },
    playwright: { command: "playwright" },
    mastergo: { url: "https://example.com/mcp" },
    docs: { url: "https://example.com/docs" },
  };
  listeners = new Set<(event: CodexEvent) => void>();
  pending: CodexPending[] = [];
  calls: { method: string; params: unknown }[] = [];
  closeCount = 0;
  prepareD2C = vi.fn(async () => ({
    thread: {
      developerInstructions: "shared rules",
      cwd: this.cwd,
      config: {
        mcp_servers: { playwright: { command: "playwright-fixture" } },
        features: { browser_use: true },
      },
    },
    input: [{ type: "text" as const, text: "Build", text_elements: [] }],
  }));
  prepareD2CRuntime = vi.fn(async () => ({
    cwd: this.cwd,
    config: {
      mcp_servers: { playwright: { command: "playwright-fixture" } },
      features: { browser_use: true },
    },
    skillPath: "/fixture/SKILL.md",
    temporaryDirectory: this.cwd,
  }));
  constructor(
    readonly cwd: string,
    readonly threads: Map<string, NativeThread>,
  ) {}
  subscribe(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(method: string, params: unknown) {
    for (const listener of this.listeners)
      listener({ type: "unknownNotification", notification: { method, params } });
  }
  pendingRequests() {
    return this.pending;
  }
  async respond(token: string, result: unknown) {
    z.object({ decision: z.enum(["accept", "decline", "cancel"]) }).parse(result);
    if (!this.pending.some((entry) => entry.token === token)) throw new Error("stale token");
    this.calls.push({ method: "respond", params: { token, result } });
    this.pending = this.pending.filter((entry) => entry.token !== token);
  }
  async close() {
    this.closeCount++;
    this.pending = [];
    for (const listener of this.listeners) listener({ type: "close", error: new Error("closed") });
  }
  async request<M extends CodexMethod>(
    method: M,
    params: NativeMethods[M]["params"],
  ): Promise<NativeMethods[M]["result"]> {
    this.calls.push({ method, params });
    const object = z.record(z.string(), z.unknown()).parse(params);
    let result: unknown;
    if (method === "config/read") result = { config: { mcp_servers: this.inheritedServers } };
    else if (method === "thread/start") {
      const id = `task-${this.threads.size}`;
      const thread = {
        id,
        cwd: this.cwd,
        name: null,
        preview: "Build",
        createdAt: 1,
        updatedAt: 1,
        status: { type: "idle" },
        turns: [],
      };
      this.threads.set(id, thread);
      result = { thread: structuredClone(thread) };
    } else {
      const id = String(object.threadId);
      const thread = this.threads.get(id);
      if (!thread) throw new Error("missing native thread");
      if (method === "thread/read" || method === "thread/resume")
        result = { thread: structuredClone(thread) };
      else if (method === "turn/start") {
        const turn = {
          id: `${id}-turn-${thread.turns.length}`,
          status: "inProgress",
          error: null,
          items: [],
        };
        thread.turns.push(turn);
        thread.status = { type: "active" };
        this.emit("turn/started", { threadId: id, turn });
        result = { turn };
      } else if (method === "turn/steer") result = { turnId: object.expectedTurnId };
      else if (method === "turn/interrupt") {
        const turn = thread.turns.find((entry) => entry.id === object.turnId);
        if (!turn) throw new Error("missing turn");
        turn.status = "interrupted";
        thread.status = { type: "idle" };
        this.emit("turn/completed", { threadId: id, turn });
        result = {};
      } else throw new Error(`unexpected ${method}`);
    }
    return result as NativeMethods[M]["result"];
  }
  ask(taskId: string, token: string) {
    const pending: CodexPending = {
      token,
      request: {
        id: token,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: taskId,
          turnId: `${taskId}-turn-0`,
          itemId: "cmd",
          kind: "command",
          startedAtMs: 1,
          environmentId: null,
          command: "npm test",
        },
      },
    };
    this.pending.push(pending);
    for (const listener of this.listeners) listener({ type: "request", ...pending });
  }
}
async function setup(inheritedServers?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-server-"));
  directories.push(directory);
  const threads = new Map<string, NativeThread>();
  const clients: FakeCodex[] = [];
  const probes: FakeCodex[] = [];
  const launches: Record<string, string | number | boolean>[] = [];
  const factory = (cwd: string, overrides: Record<string, string | number | boolean> = {}) => {
    launches.push(overrides);
    const client = new FakeCodex(cwd, threads);
    if (inheritedServers !== undefined) client.inheritedServers = inheritedServers;
    probes.push(client);
    const subscribe = client.subscribe.bind(client);
    client.subscribe = (listener) => {
      if (!clients.includes(client)) clients.push(client);
      return subscribe(listener);
    };
    return client;
  };
  const service = new SessionService({ directory, connectionFactory: factory });
  await service.initialize();
  cleanup.push(() => service.close());
  return { directory, threads, clients, probes, launches, factory, service };
}

describe("native session service", () => {
  it("shares concurrent configuration discovery and disables desktop tools before launching the real connection", async () => {
    const { directory, factory, probes, launches } = await setup();
    const onEvent = vi.fn();
    const connections = new CodexConnections(onEvent, factory);
    cleanup.push(() => connections.close());
    const [first, second] = await Promise.all([
      connections.get(directory),
      connections.get(directory),
    ]);
    expect(first).toBe(second);
    expect(probes).toHaveLength(2);
    expect(probes[0]?.closeCount).toBe(1);
    expect(probes[0]?.calls.map((call) => call.method)).toEqual(["config/read"]);
    expect(probes[1]?.calls).toEqual([]);
    expect(launches[1]).toMatchObject({
      "features.computer_use": false,
      "plugins.unified-computer-use@openai-bundled.enabled": false,
      "plugins.computer-use@openai-bundled.enabled": false,
      "mcp_servers.node_repl.enabled": false,
      "mcp_servers.cua_repl.enabled": false,
      "mcp_servers.computer-use.enabled": false,
    });
    expect(onEvent).not.toHaveBeenCalled();
  });
  it("does not invent desktop MCP entries on installations without those servers", async () => {
    const { service, clients, directory } = await setup({
      playwright: { command: "playwright" },
      mastergo: { url: "https://example.com/mcp" },
    });
    await service.create({ projectPath: directory, prompt: "one", images: [] });
    const { config } = z
      .object({ config: z.record(z.string(), z.unknown()) })
      .parse(clients[0]?.calls.find((call) => call.method === "thread/start")?.params);
    expect(Object.keys(config).filter((key) => key.startsWith("mcp_servers."))).toEqual([]);
    expect(config).toMatchObject({
      "features.computer_use": false,
      "plugins.unified-computer-use@openai-bundled.enabled": false,
    });
  });
  it("fails before creating a task if the inherited MCP configuration cannot be inspected", async () => {
    const { service, probes, directory } = await setup([]);
    await expect(
      service.create({ projectPath: directory, prompt: "one", images: [] }),
    ).rejects.toThrow();
    expect(probes[0]?.calls.map((call) => call.method)).toEqual(["config/read"]);
  });
  it.each(["active", "idle"])(
    "forwards stored images with %s conversation input through HTTP",
    async (status) => {
      const { service, clients, directory } = await setup();
      const { taskId } = await service.create({
        projectPath: directory,
        prompt: "one",
        images: [],
      });
      if (status === "idle") await service.stop(taskId, `${taskId}-turn-0`);
      const app = buildApp({ sessionService: service, instanceLock: false });
      cleanup.push(() => app.close());
      const data = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
        "base64",
      );
      const response = communicationResponseMessageSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/communication",
            payload: createCommunicationRequestMessage("image-input", sessionMethods.send, {
              taskId,
              text: status === "active" ? "follow this screenshot" : "",
              images: [
                {
                  name: "../../design.png",
                  dataUrl: `data:image/png;base64,${data.toString("base64")}`,
                },
              ],
            }),
          })
        ).json(),
      );
      expect(response).toMatchObject({ success: true, requestId: "image-input" });
      const call = clients[0]!.calls.at(-1)!;
      expect(call.method).toBe(status === "active" ? "turn/steer" : "turn/start");
      const params = z
        .object({
          threadId: z.string(),
          expectedTurnId: z.string().optional(),
          additionalContext: z.record(
            z.string(),
            z.object({ kind: z.string(), value: z.string() }),
          ),
          input: z.array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("text"),
                text: z.string(),
                text_elements: z.array(z.unknown()),
              }),
              z.object({ type: z.literal("localImage"), path: z.string() }),
            ]),
          ),
        })
        .parse(call.params);
      expect(params.threadId).toBe(taskId);
      expect(params.additionalContext.ui_forge_artifacts?.value).toContain(
        await prepareTemporaryWorkspace(directory, directory),
      );
      expect(params.input).toHaveLength(status === "active" ? 2 : 1);
      if (status === "active") {
        expect(params.expectedTurnId).toBe(`${taskId}-turn-0`);
        expect(params.input[0]).toEqual({
          type: "text",
          text: "follow this screenshot",
          text_elements: [],
        });
      }
      const image = params.input.find((part) => part.type === "localImage")!;
      expect(dirname(image.path)).toBe(join(directory, "attachments"));
      expect(await readFile(image.path)).toEqual(data);
    },
  );
  it("rejects invalid supplemental files before writing attachments or starting a model operation", async () => {
    const { service, clients, directory } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const app = buildApp({ sessionService: service, instanceLock: false });
    cleanup.push(() => app.close());
    const before = clients[0]!.calls.length;
    const invalidImage = { name: "design.png", dataUrl: "data:image/png;base64,YQ==" };
    for (const images of [[invalidImage], Array.from({ length: 5 }, () => invalidImage)]) {
      const response = communicationResponseMessageSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/communication",
            payload: createCommunicationRequestMessage("invalid-image", sessionMethods.send, {
              taskId,
              text: "change",
              images,
            }),
          })
        ).json(),
      );
      expect(response).toMatchObject({ success: false, requestId: "invalid-image" });
    }
    expect(clients[0]!.calls).toHaveLength(before);
    expect(await readdir(directory)).not.toContain("attachments");
  });
  it("shares one connection across tasks, forwards steer and interrupts only the requested turn", async () => {
    const { service, clients, directory, threads } = await setup();
    const a = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const b = await service.create({ projectPath: directory, prompt: "two", images: [] });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.calls.find((call) => call.method === "thread/start")?.params).toMatchObject({
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      developerInstructions: "shared rules",
      config: {
        mcp_servers: { playwright: { command: "playwright-fixture" } },
        features: { browser_use: true },
        "features.computer_use": false,
      },
    });
    const config = z
      .object({ config: z.record(z.string(), z.unknown()) })
      .parse(clients[0]?.calls.find((call) => call.method === "thread/start")?.params).config;
    expect(config).toMatchObject({
      "plugins.unified-computer-use@openai-bundled.enabled": false,
      "plugins.computer-use@openai-bundled.enabled": false,
      "mcp_servers.node_repl.enabled": false,
      "mcp_servers.cua_repl.enabled": false,
      "mcp_servers.computer-use.enabled": false,
    });
    for (const name of ["mastergo", "playwright", "docs"])
      expect(config).not.toHaveProperty(`mcp_servers.${name}.enabled`);
    await service.send(a.taskId, "change layout");
    expect(clients[0]?.calls.at(-1)).toMatchObject({
      method: "turn/steer",
      params: { threadId: a.taskId },
    });
    await service.stop(a.taskId, `${a.taskId}-turn-0`);
    expect(threads.get(b.taskId)?.turns[0]?.status).toBe("inProgress");
    await expect(service.stop(a.taskId, `${a.taskId}-turn-0`)).rejects.toThrow("失效");
    await service.send(a.taskId, "continue");
    expect(threads.get(a.taskId)?.turns).toHaveLength(2);
    expect(clients[0]?.closeCount).toBe(0);
  });
  it("recovers pending requests on reconnect and rejects reused, cross-task and malformed decisions", async () => {
    const { service, clients, directory } = await setup();
    const a = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const b = await service.create({ projectPath: directory, prompt: "two", images: [] });
    clients[0]!.ask(a.taskId, "token");
    const signal = new AbortController();
    const stream = service.subscribe(a.taskId, signal.signal)[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.value).toMatchObject({
      type: "snapshot",
      snapshot: { pendingRequests: [{ token: "token" }] },
    });
    signal.abort();
    await stream.return?.();
    expect(clients[0]?.closeCount).toBe(0);
    expect((await service.read(a.taskId)).pendingRequests).toHaveLength(1);
    expect(clients[0]?.calls.some((call) => call.method === "respond")).toBe(false);
    await expect(service.respond(b.taskId, "token", { decision: "accept" })).rejects.toThrow(
      "不属于",
    );
    await expect(service.respond(a.taskId, "token", { decision: "approved" })).rejects.toThrow();
    await service.respond(a.taskId, "token", { decision: "decline" });
    expect(clients[0]?.calls.at(-1)).toMatchObject({
      method: "respond",
      params: { result: { decision: "decline" } },
    });
    await expect(service.respond(a.taskId, "token", { decision: "accept" })).rejects.toThrow(
      "失效",
    );
  });
  it("takes a synchronous stream snapshot and never repeats a previously received delta on reconnect", async () => {
    const { service, clients, directory } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    clients[0]!.emit("item/started", {
      threadId: taskId,
      turnId: `${taskId}-turn-0`,
      item: { type: "agentMessage", id: "m", text: "" },
    });
    clients[0]!.emit("item/agentMessage/delta", {
      threadId: taskId,
      turnId: `${taskId}-turn-0`,
      itemId: "m",
      delta: "hello",
    });
    const signal = new AbortController();
    const stream = service.subscribe(taskId, signal.signal)[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.value).toMatchObject({
      type: "snapshot",
      snapshot: { thread: { turns: [{ items: [{ text: "hello" }] }] } },
    });
    clients[0]!.emit("item/agentMessage/delta", {
      threadId: taskId,
      turnId: `${taskId}-turn-0`,
      itemId: "m",
      delta: " world",
    });
    expect((await stream.next()).value).toMatchObject({
      type: "notification",
      notification: { params: { delta: " world" } },
    });
    signal.abort();
    await stream.return?.();
  });
  it("restarts from the durable index and native history without starting another turn or replaying approval", async () => {
    const { directory, service, clients, factory } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    clients[0]!.ask(taskId, "old-token");
    await service.close();
    const restarted = new SessionService({ directory, connectionFactory: factory });
    cleanup.push(() => restarted.close());
    await restarted.initialize();
    expect(restarted.index.list(0).tasks[0]?.taskId).toBe(taskId);
    expect((await restarted.read(taskId)).pendingRequests).toEqual([]);
    expect(clients[1]?.calls.map((call) => call.method)).toEqual([
      "config/read",
      "thread/resume",
      "thread/read",
    ]);
    const temporary = await prepareTemporaryWorkspace(directory, directory);
    const resumed = clients[1]?.calls.find((call) => call.method === "thread/resume")?.params;
    expect(resumed).toMatchObject({
      threadId: taskId,
      cwd: clients[1]?.cwd,
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      config: {
        "features.computer_use": false,
        "sandbox_workspace_write.writable_roots": [temporary],
        "plugins.unified-computer-use@openai-bundled.enabled": false,
        "plugins.computer-use@openai-bundled.enabled": false,
        "mcp_servers.node_repl.enabled": false,
        "mcp_servers.cua_repl.enabled": false,
        "mcp_servers.computer-use.enabled": false,
        mcp_servers: { playwright: { command: "playwright-fixture" } },
      },
    });
    expect(resumed).not.toHaveProperty("developerInstructions");
    expect(clients[1]?.prepareD2C).not.toHaveBeenCalled();
    expect(clients[1]?.prepareD2CRuntime).toHaveBeenCalledExactlyOnceWith({
      temporaryDirectory: temporary,
    });
    await expect(restarted.respond(taskId, "old-token", { decision: "accept" })).rejects.toThrow(
      "失效",
    );
  });
  it("routes child-thread approvals to the parent task without changing their native identity", async () => {
    const { directory, service, clients, threads } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const parent = threads.get(taskId)!;
    const child = {
      ...parent,
      id: "child",
      parentThreadId: taskId,
    } as NativeMethods["thread/start"]["result"]["thread"];
    for (const listener of clients[0]!.listeners)
      listener({
        type: "notification",
        notification: { method: "thread/started", params: { thread: child } },
      });
    clients[0]!.ask("child", "child-token");
    expect((await service.read(taskId)).pendingRequests[0]?.request.params.threadId).toBe("child");
    await service.respond(taskId, "child-token", { decision: "cancel" });
    expect(clients[0]?.calls.at(-1)).toMatchObject({
      method: "respond",
      params: { token: "child-token", result: { decision: "cancel" } },
    });
  });
  it("shares one recovery operation when multiple clients reopen the same task concurrently", async () => {
    const { service, directory, factory, clients } = await setup();
    const { taskId } = await service.create({
      projectPath: directory,
      prompt: "Build",
      images: [],
    });
    await service.close();
    const restarted = new SessionService({ directory, connectionFactory: factory });
    cleanup.push(() => restarted.close());
    await restarted.initialize();
    const snapshots = await Promise.all([restarted.read(taskId), restarted.read(taskId)]);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(clients).toHaveLength(2);
    expect(clients[1]?.prepareD2CRuntime).toHaveBeenCalledOnce();
    expect(clients[1]?.calls.filter((call) => call.method === "thread/resume")).toHaveLength(1);
    expect(clients[1]?.calls.some((call) => call.method === "turn/start")).toBe(false);
  });
  it("ends active subscriptions when the server closes its Codex connection", async () => {
    const { directory, service, clients } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const stream = service.subscribe(taskId, new AbortController().signal)[Symbol.asyncIterator]();
    await stream.next();
    const next = stream.next();
    await service.close();
    expect((await next).value).toMatchObject({ type: "close" });
    expect((await stream.next()).done).toBe(true);
    expect(clients[0]?.closeCount).toBe(1);
  });
  it("exposes validated HTTP routes and writes real Markdown through codex-client", async () => {
    const { directory, service } = await setup();
    const paths = { design: join(directory, "design.md"), project: join(directory, "project.md") };
    await writeFile(paths.design, "# Original design\n");
    await writeFile(paths.project, "# Original project\n");
    const instructions = new InstructionService({
      path: (kind) => paths[kind],
      read: (kind) => readInstructions(kind, paths[kind]),
      save: (kind, content) => saveInstructions(kind, content, paths[kind]),
    });
    const app = buildApp({
      sessionService: service,
      instructionService: instructions,
      instanceLock: false,
    });
    cleanup.push(() => app.close());
    const request = async (method: string, params: unknown) =>
      communicationResponseMessageSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/communication",
            payload: createCommunicationRequestMessage("request", method, params),
          })
        ).json(),
      );
    const loaded = await request(instructionMethods.read, { kind: "design" });
    if (!loaded.success) throw new Error("load failed");
    const revision = z.object({ revision: z.string() }).parse(loaded.data).revision;
    expect(
      await request(instructionMethods.save, { kind: "design", content: "# Updated\n", revision }),
    ).toMatchObject({ success: true });
    expect(await readFile(paths.design, "utf8")).toBe("# Updated\n");
    expect(
      await request(instructionMethods.save, { kind: "design", content: "# stale", revision }),
    ).toMatchObject({ success: false, requestId: "request" });
    expect(
      await request(instructionMethods.read, { kind: "design", path: "/etc/passwd" }),
    ).toMatchObject({ success: false });
    expect(
      await request(sessionMethods.create, {
        projectPath: directory,
        prompt: "test",
        images: [],
        sandbox: "danger-full-access",
      }),
    ).toMatchObject({ success: false });
    expect(
      await request(sessionMethods.create, {
        projectPath: directory,
        prompt: "test",
        images: [{ name: "../../evil", dataUrl: "data:image/png;base64,YQ==" }],
      }),
    ).toMatchObject({ success: false });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/communication",
          headers: { origin: "https://external.example" },
          payload: createCommunicationRequestMessage("r", instructionMethods.read, {
            kind: "project",
          }),
        })
      ).statusCode,
    ).toBe(403);
  });
});
