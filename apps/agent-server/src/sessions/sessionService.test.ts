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
  CodexTimeoutError,
} from "@ui-forge/codex-client";
import { z } from "zod";
import { applySessionEvent, emptyPresentation } from "@ui-forge/client-core";
import {
  createCommunicationRequestMessage,
  communicationResponseMessageSchema,
  createdSessionSchema,
  sessionMethods,
  sessionOperationResultSchema,
  sessionSnapshotSchema,
  diagnosticMethods,
  taskDiagnosticsSchema,
  deliveryMethods,
  taskDeliverySchema,
  designMethods,
  instructionMethods,
  type NativeThread,
  type DesignSource,
  type SessionEvent,
} from "@ui-forge/shared-protocol";
import type { SessionDesignOptions } from "../design/sessionDesignBindings.js";
import type { VibeReadOnlyBridgeOptions } from "@ui-forge/codex-client";
import { SessionService } from "./sessionService.js";
import { CodexConnections, type CodexConnection } from "../runtime/codexConnections.js";
import { InstructionService } from "../instructions/instructionService.js";
import { buildApp } from "../http/buildApp.js";
import { capacityFailureScenario } from "../../../../packages/codex-client/src/testing/payloads.js";
import { LocalClient } from "../../../agent-cli/src/client.js";
import { createSessionDataSource } from "../../../agent-webview/src/data-sources/sessionDataSource.js";
import { createHttpCommunicationClient } from "../../../agent-webview/src/communication/http/createHttpCommunicationClient.js";
import { createNegotiatedCommunicationClient } from "../../../agent-webview/src/communication/createNegotiatedCommunicationClient.js";

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
  startError: Error | undefined;
  beforeClose: (() => Promise<void>) | undefined;
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
    await this.beforeClose?.();
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
    else if (method === "thread/list")
      result = { data: [], nextCursor: null, backwardsCursor: null };
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
        if (this.startError) throw this.startError;
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
async function setup(
  inheritedServers?: unknown,
  designOptions: SessionDesignOptions = {},
  configureClient?: (client: FakeCodex) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-server-"));
  directories.push(directory);
  const threads = new Map<string, NativeThread>();
  const clients: FakeCodex[] = [];
  const probes: FakeCodex[] = [];
  const launches: Record<string, string | number | boolean>[] = [];
  const factory = (cwd: string, overrides: Record<string, string | number | boolean> = {}) => {
    launches.push(overrides);
    const client = new FakeCodex(cwd, threads);
    configureClient?.(client);
    if (inheritedServers !== undefined) client.inheritedServers = inheritedServers;
    probes.push(client);
    const subscribe = client.subscribe.bind(client);
    client.subscribe = (listener) => {
      if (!clients.includes(client)) clients.push(client);
      return subscribe(listener);
    };
    return client;
  };
  const service = new SessionService({ directory, connectionFactory: factory, ...designOptions });
  await service.initialize();
  cleanup.push(() => service.close());
  return { directory, threads, clients, probes, launches, factory, service };
}

async function setupHttpEntries() {
  const fixture = await setup();
  const app = buildApp({
    sessionService: fixture.service,
    runtimeDirectory: fixture.directory,
    instanceLock: false,
  });
  const subscriptions: { controller: AbortController; done: Promise<void> }[] = [];
  const streamErrors: unknown[] = [];
  const close = async () => {
    for (const { controller } of subscriptions) controller.abort();
    await Promise.all(subscriptions.map(({ done }) => done));
    try {
      await app.close();
    } finally {
      vi.unstubAllGlobals();
    }
  };
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const cli = new LocalClient(Number(new URL(address).port));
    await cli.connect(false);
    const web = createSessionDataSource(
      createNegotiatedCommunicationClient(
        createHttpCommunicationClient({ endpoint: `${address}/api/communication` }),
      ),
    );
    const observe = (entry: "cli" | "webview", taskId: string) => {
      const controller = new AbortController();
      const events: SessionEvent[] = [];
      const receive = (event: SessionEvent) => events.push(event);
      const done = (
        entry === "cli"
          ? cli.subscribe(taskId, receive, controller.signal)
          : web.subscribe(taskId, receive, controller.signal)
      ).catch((error: unknown) => {
        if (!controller.signal.aborted) streamErrors.push(error);
      });
      subscriptions.push({ controller, done });
      return {
        controller,
        done,
        events,
        presentation: () => events.reduce(applySessionEvent, emptyPresentation()),
      };
    };
    return { ...fixture, cli, web, observe, streamErrors, close };
  } catch (error) {
    await close();
    throw error;
  }
}

describe("cross-entry CLI and Webview HTTP regression", () => {
  it.each(["decline", "cancel"] as const)(
    "shares approval snapshots and resolves %s without accepting reused or cross-task tokens",
    async (decision) => {
      const fixture = await setupHttpEntries();
      const { cli, web, observe, directory, clients, streamErrors } = fixture;
      try {
        const first = await web.create({ projectPath: directory, prompt: "one", images: [] });
        const second = await cli.request(
          sessionMethods.create,
          { projectPath: directory, prompt: "two", images: [] },
          createdSessionSchema,
        );
        const native = clients[0]!;
        native.ask(first.taskId, "pending-on-connect");
        const terminal = observe("cli", first.taskId);
        const page = observe("webview", first.taskId);
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          for (const entry of [terminal, page])
            expect(entry.events[0]).toMatchObject({
              type: "snapshot",
              snapshot: {
                thread: { id: first.taskId },
                pendingRequests: [{ token: "pending-on-connect" }],
              },
            });
        });
        expect(page.events[0]).toEqual(terminal.events[0]);

        await expect(
          cli.request(
            sessionMethods.respond,
            { taskId: second.taskId, token: "pending-on-connect", result: { decision } },
            sessionOperationResultSchema,
          ),
        ).rejects.toThrow("不属于");
        await expect(
          web.respond(second.taskId, "pending-on-connect", { decision }),
        ).rejects.toThrow("不属于");
        expect(native.calls.filter((call) => call.method === "respond")).toEqual([]);
        expect(native.pendingRequests()).toHaveLength(1);

        await cli.request(
          sessionMethods.respond,
          { taskId: first.taskId, token: "pending-on-connect", result: { decision } },
          sessionOperationResultSchema,
        );
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          for (const entry of [terminal, page]) {
            expect(entry.events).toContainEqual({ type: "resolved", token: "pending-on-connect" });
            expect(entry.presentation().snapshot?.pendingRequests).toEqual([]);
          }
        });
        await expect(
          web.respond(first.taskId, "pending-on-connect", { decision: "accept" }),
        ).rejects.toThrow("失效");
        await expect(
          cli.request(
            sessionMethods.respond,
            { taskId: first.taskId, token: "pending-on-connect", result: { decision: "accept" } },
            sessionOperationResultSchema,
          ),
        ).rejects.toThrow("失效");

        native.ask(first.taskId, "arrived-after-connect");
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          for (const entry of [terminal, page])
            expect(entry.presentation().snapshot?.pendingRequests).toMatchObject([
              { token: "arrived-after-connect" },
            ]);
        });
        await web.respond(first.taskId, "arrived-after-connect", { decision: "cancel" });
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          for (const entry of [terminal, page]) {
            expect(entry.events).toContainEqual({
              type: "resolved",
              token: "arrived-after-connect",
            });
            expect(entry.presentation().snapshot?.pendingRequests).toEqual([]);
          }
        });
        expect(native.calls.filter((call) => call.method === "respond")).toEqual([
          {
            method: "respond",
            params: { token: "pending-on-connect", result: { decision } },
          },
          {
            method: "respond",
            params: { token: "arrived-after-connect", result: { decision: "cancel" } },
          },
        ]);
        expect(await web.read(first.taskId)).toEqual(
          await cli.request(sessionMethods.read, { taskId: first.taskId }, sessionSnapshotSchema),
        );
        expect(native.calls.filter((call) => call.method === "turn/interrupt")).toEqual([]);
        expect(native.closeCount).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(["cli", "webview"] as const)(
    "keeps the shared task active when %s disconnects and scopes explicit stop to its original turn",
    async (disconnectedEntry) => {
      const fixture = await setupHttpEntries();
      const { cli, web, observe, directory, clients, threads, streamErrors } = fixture;
      try {
        const first = await web.create({ projectPath: directory, prompt: "one", images: [] });
        const second = await web.create({ projectPath: directory, prompt: "two", images: [] });
        const native = clients[0]!;
        const terminal = observe("cli", first.taskId);
        const page = observe("webview", first.taskId);
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          for (const entry of [terminal, page])
            expect(entry.presentation().snapshot?.thread.id).toBe(first.taskId);
        });
        const disconnected = disconnectedEntry === "cli" ? terminal : page;
        const remaining = disconnectedEntry === "cli" ? page : terminal;
        disconnected.controller.abort();
        await disconnected.done;
        const disconnectedEventCount = disconnected.events.length;
        expect(clients).toHaveLength(1);
        expect(native.closeCount).toBe(0);
        expect(native.calls.filter((call) => call.method === "turn/interrupt")).toEqual([]);
        expect(threads.get(first.taskId)?.turns[0]?.status).toBe("inProgress");
        expect(threads.get(second.taskId)?.turns[0]?.status).toBe("inProgress");

        native.emit("item/completed", {
          threadId: first.taskId,
          turnId: `${first.taskId}-turn-0`,
          item: { type: "agentMessage", id: "after-disconnect", text: "Still working" },
        });
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          expect(remaining.presentation().snapshot?.thread.turns[0]?.items).toMatchObject([
            { id: "after-disconnect", text: "Still working" },
          ]);
        });
        const originalTurnId = `${first.taskId}-turn-0`;
        if (disconnectedEntry === "cli") await web.stop(first.taskId, originalTurnId);
        else
          await cli.request(
            sessionMethods.stop,
            { taskId: first.taskId, turnId: originalTurnId },
            sessionOperationResultSchema,
          );
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          expect(remaining.presentation().snapshot?.thread.turns[0]?.status).toBe("interrupted");
        });
        await web.send(first.taskId, "Continue unfinished work");
        await vi.waitFor(() => {
          expect(streamErrors).toEqual([]);
          expect(remaining.presentation().snapshot?.thread.turns.at(-1)).toMatchObject({
            id: `${first.taskId}-turn-1`,
            status: "inProgress",
          });
        });
        await expect(web.stop(first.taskId, originalTurnId)).rejects.toThrow("失效");
        await expect(
          cli.request(
            sessionMethods.stop,
            { taskId: first.taskId, turnId: originalTurnId },
            sessionOperationResultSchema,
          ),
        ).rejects.toThrow("失效");
        expect(native.calls.filter((call) => call.method === "turn/interrupt")).toEqual([
          {
            method: "turn/interrupt",
            params: { threadId: first.taskId, turnId: originalTurnId },
          },
        ]);
        expect(threads.get(first.taskId)?.turns.at(-1)?.status).toBe("inProgress");
        expect(threads.get(second.taskId)?.turns[0]?.status).toBe("inProgress");
        expect(disconnected.events).toHaveLength(disconnectedEventCount);
        expect(native.closeCount).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it("returns the same read-only diagnostics and missing delivery through both entries without resuming or executing", async () => {
    const fixture = await setupHttpEntries();
    const { cli, web, directory, clients } = fixture;
    try {
      const { taskId } = await web.create({ projectPath: directory, prompt: "one", images: [] });
      const native = clients[0]!;
      const before = native.calls.length;
      const cliDiagnostics = await cli.request(
        diagnosticMethods.read,
        { taskId },
        taskDiagnosticsSchema,
      );
      const webDiagnostics = await web.readDiagnostics(taskId);
      expect({ ...webDiagnostics, generatedAt: cliDiagnostics.generatedAt }).toEqual(
        cliDiagnostics,
      );
      expect(webDiagnostics).toMatchObject({ taskId, status: "active" });
      expect(webDiagnostics.warnings).not.toContain("agentsUnavailable");
      const cliDelivery = await cli.request(deliveryMethods.read, { taskId }, taskDeliverySchema);
      const webDelivery = await web.readDelivery(taskId);
      expect({ ...webDelivery, checkedAt: cliDelivery.checkedAt }).toEqual(cliDelivery);
      expect(webDelivery).toMatchObject({ taskId, availability: "missing", report: null });
      expect(native.calls.slice(before).map((call) => call.method)).toEqual([
        "thread/read",
        "thread/list",
        "thread/read",
        "thread/list",
      ]);
      expect(native.closeCount).toBe(0);
    } finally {
      await fixture.close();
    }
  });
});

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
      expect(params.additionalContext.ui_forge_delivery?.value).toContain(
        '"taskId":' + JSON.stringify(taskId),
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
  it("continues a capacity failure only after explicit input and preserves the previous results", async () => {
    const { directory, service, clients, threads } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const nativeThread = threads.get(taskId);
    const nativeTurn = nativeThread?.turns[0];
    const client = clients[0];
    if (!nativeThread || !nativeTurn || !client) throw new Error("Missing fixture thread");
    nativeTurn.items = structuredClone(capacityFailureScenario.activeTurn.items);
    client.emit("error", {
      threadId: taskId,
      turnId: nativeTurn.id,
      error: capacityFailureScenario.failedTurn.error,
      willRetry: true,
    });
    const retryBoundary = client.calls.length;
    await service.send(taskId, "Continue only if idle", [], true);
    expect(
      client.calls
        .slice(retryBoundary)
        .filter((call) => call.method === "turn/start" || call.method === "turn/steer"),
    ).toEqual([]);
    expect((await service.read(taskId)).thread.turns[0]).toMatchObject({
      status: "inProgress",
      error: null,
      items: capacityFailureScenario.activeTurn.items,
    });

    nativeTurn.status = "failed";
    nativeTurn.error = structuredClone(capacityFailureScenario.failedTurn.error);
    nativeThread.status = { type: "idle" };
    client.emit("error", {
      threadId: taskId,
      turnId: nativeTurn.id,
      error: nativeTurn.error,
      willRetry: false,
    });
    client.emit("turn/completed", { threadId: taskId, turn: nativeTurn });
    const failedTurn = structuredClone(nativeTurn);
    expect((await service.read(taskId)).thread.turns).toEqual([failedTurn]);
    expect(client.calls.filter((call) => call.method === "turn/start")).toHaveLength(1);

    const continuationBoundary = client.calls.length;
    await service.send(taskId, "Check existing work and continue unfinished changes", [], true);
    expect(
      client.calls
        .slice(continuationBoundary)
        .filter((call) => call.method === "turn/start" || call.method === "turn/steer"),
    ).toEqual([
      expect.objectContaining({
        method: "turn/start",
        params: expect.objectContaining({ threadId: taskId }),
      }),
    ]);
    expect((await service.read(taskId)).thread.turns).toEqual([
      failedTurn,
      expect.objectContaining({ status: "inProgress", error: null, items: [] }),
    ]);
  });
  it("restarts from the durable index and native history without starting another turn or replaying approval", async () => {
    const { directory, service, clients, factory, threads } = await setup();
    const { taskId } = await service.create({ projectPath: directory, prompt: "one", images: [] });
    const nativeThread = threads.get(taskId);
    if (!nativeThread) throw new Error("Missing fixture thread");
    nativeThread.turns.unshift(
      structuredClone({
        ...capacityFailureScenario.failedTurn,
        id: "previous-capacity-failure",
      }),
    );
    const previousTurns = structuredClone(nativeThread.turns);
    clients[0]!.ask(taskId, "old-token");
    await service.close();
    const restarted = new SessionService({ directory, connectionFactory: factory });
    cleanup.push(() => restarted.close());
    await restarted.initialize();
    expect(restarted.index.list(0).tasks[0]?.taskId).toBe(taskId);
    const restored = await restarted.read(taskId);
    expect(restored.pendingRequests).toEqual([]);
    expect(restored.thread.turns).toEqual(previousTurns);
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
      designAccess: { kind: "local" },
    });
    await expect(restarted.respond(taskId, "old-token", { decision: "accept" })).rejects.toThrow(
      "失效",
    );
    expect(
      clients[1]?.calls.filter((call) =>
        ["thread/start", "turn/start", "turn/steer", "respond"].includes(call.method),
      ),
    ).toEqual([]);
    expect(clients[1]?.pendingRequests()).toEqual([]);
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
    expect(await request(designMethods.check, { source: { kind: "local" } })).toMatchObject({
      success: true,
      data: { source: { kind: "local" }, tools: [] },
    });
    expect(
      await request(designMethods.check, {
        source: {
          kind: "mastergo",
          url: "https://mastergo.com/file/design",
          connection: { kind: "vibe", endpoint: "https://external.example/mcp" },
        },
      }),
    ).toMatchObject({ success: false });
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

const vibeSource: DesignSource = {
  kind: "mastergo",
  url: "https://mastergo.com/file/document?layer_id=1%3A2&page_id=page",
  connection: {
    kind: "vibe",
    endpoint: "http://127.0.0.1:20678/mcp",
    statusEndpoint: "http://127.0.0.1:30678/api/status",
  },
};
function designFixture() {
  const bridges: VibeReadOnlyBridgeOptions[] = [];
  const designCheck = vi.fn(async (source: DesignSource) => ({
    source,
    ...(source.kind === "mastergo"
      ? { target: { documentId: "document", pageId: "page", nodeId: "1:2" } }
      : {}),
    tools: source.kind === "local" ? [] : ["read_design"],
  }));
  const startVibeBridge = vi.fn(async (options: VibeReadOnlyBridgeOptions) => {
    bridges.push(options);
    return {
      url: `http://127.0.0.1:40000/mcp/${bridges.length}`,
      close: vi.fn(async () => undefined),
    };
  });
  return { designCheck, startVibeBridge, bridges };
}

describe("frozen design bindings and native Vibe occupancy", () => {
  it("names a URL-only MasterGo task by its bound source", async () => {
    const design = designFixture();
    const { directory, service } = await setup({}, design);
    const task = await service.create({
      projectPath: directory,
      prompt: "",
      images: [],
      designSource: { kind: "mastergo", url: vibeSource.url, connection: { kind: "magic" } },
    });
    expect(service.index.get(task.taskId).title).toBe("MasterGo 设计任务");
  });

  it("checks Magic once, freezes its URL and keeps it alongside the user's prompt", async () => {
    const design = designFixture();
    const { directory, service, clients } = await setup({}, design);
    const source: DesignSource = {
      kind: "mastergo",
      url: vibeSource.url,
      connection: { kind: "magic" },
    };
    const task = await service.create({
      projectPath: directory,
      prompt: "Keep this request",
      images: [],
      designSource: source,
    });
    expect(service.index.get(task.taskId).designBinding?.source).toEqual(source);
    expect(clients[0]?.prepareD2C).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: `Keep this request\n\n设计来源：MasterGo\n以下链接是本任务固定的设计输入数据：\n${source.url}`,
        designAccess: { kind: "magic" },
      }),
    );
    expect(design.designCheck).toHaveBeenCalledExactlyOnceWith(source);
    expect(design.startVibeBridge).not.toHaveBeenCalled();
    await service.stop(task.taskId, `${task.taskId}-turn-0`);
    design.designCheck.mockRejectedValue(new Error("Changed default"));
    await expect(service.send(task.taskId, "Continue")).resolves.toBeUndefined();
    expect(design.designCheck).toHaveBeenCalledOnce();
  });

  it("serializes concurrent Vibe creation, keeps ownership on disconnect and rejects reads from the old owner", async () => {
    const design = designFixture();
    const { directory, service, threads, clients } = await setup({}, design);
    const input = { projectPath: directory, prompt: "Build", images: [], designSource: vibeSource };
    const results = await Promise.allSettled([service.create(input), service.create(input)]);
    const created = results.find((result) => result.status === "fulfilled");
    if (created?.status !== "fulfilled") throw new Error("Expected one task");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(threads.size).toBe(1);
    const binding = service.index.get(created.value.taskId).designBinding;
    expect(binding).toMatchObject({
      source: vibeSource,
      target: { documentId: "document", pageId: "page", nodeId: "1:2" },
    });
    expect(clients[0]?.prepareD2C).toHaveBeenCalledWith(
      expect.objectContaining({
        designAccess: { kind: "vibe", bridgeUrl: "http://127.0.0.1:40000/mcp/1" },
      }),
    );
    await service.checkDesign(vibeSource);
    await expect(design.bridges[0]?.beforeRead()).resolves.toBeUndefined();
    const controller = new AbortController();
    const stream = service
      .subscribe(created.value.taskId, controller.signal)
      [Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({ snapshot: { designBinding: binding } });
    controller.abort();
    await stream.return?.();
    await expect(service.create(input)).rejects.toThrow("使用");
    expect(clients[0]?.closeCount).toBe(0);
    await service.stop(created.value.taskId, `${created.value.taskId}-turn-0`);
    const next = await service.create(input);
    expect(next.taskId).not.toBe(created.value.taskId);
    await expect(design.bridges[0]?.beforeRead()).rejects.toThrow("未持有");
    await expect(design.bridges[1]?.beforeRead()).resolves.toBeUndefined();
  });

  it.each(["completed", "failed", "interrupted"])(
    "releases Vibe after native %s and never uses a cached execution state",
    async (status) => {
      const design = designFixture();
      const { directory, service, threads } = await setup({}, design);
      const input = {
        projectPath: directory,
        prompt: "Build",
        images: [],
        designSource: vibeSource,
      };
      const first = await service.create(input);
      const native = threads.get(first.taskId);
      const turn = native?.turns[0];
      if (!native || !turn) throw new Error("Missing native task");
      turn.status = status;
      native.status = { type: "idle" };
      await expect(design.bridges[0]?.beforeRead()).rejects.toThrow("失效");
      await expect(service.create(input)).resolves.toHaveProperty("taskId");
    },
  );

  it("allows only one of two idle tasks to continue on the same Vibe instance", async () => {
    const design = designFixture();
    const { directory, service, threads } = await setup({}, design);
    const input = { projectPath: directory, prompt: "Build", images: [], designSource: vibeSource };
    const first = await service.create(input);
    await service.stop(first.taskId, `${first.taskId}-turn-0`);
    const second = await service.create(input);
    await service.stop(second.taskId, `${second.taskId}-turn-0`);
    const continued = await Promise.allSettled([
      service.send(first.taskId, "Continue", [], true),
      service.send(second.taskId, "Continue", [], true),
    ]);
    expect(continued.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(continued.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      [...threads.values()].flatMap((thread) =>
        thread.turns.filter((turn) => turn.status === "inProgress"),
      ),
    ).toHaveLength(1);
  });

  it("shares the guard between a new task and a concurrent continuation", async () => {
    const design = designFixture();
    const { directory, service, threads } = await setup({}, design);
    const input = { projectPath: directory, prompt: "Build", images: [], designSource: vibeSource };
    const first = await service.create(input);
    await service.stop(first.taskId, `${first.taskId}-turn-0`);
    const results = await Promise.allSettled([
      service.create(input),
      service.send(first.taskId, "Continue", [], true),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      [...threads.values()].flatMap((thread) =>
        thread.turns.filter((turn) => turn.status === "inProgress"),
      ),
    ).toHaveLength(1);
  });

  it("rejects another MCP proxy using the same native Vibe status instance", async () => {
    const design = designFixture();
    const { directory, service, threads } = await setup({}, design);
    await service.create({
      projectPath: directory,
      prompt: "Build",
      images: [],
      designSource: vibeSource,
    });
    await expect(
      service.create({
        projectPath: directory,
        prompt: "Another proxy",
        images: [],
        designSource: {
          ...vibeSource,
          connection: {
            kind: "vibe",
            endpoint: "http://127.0.0.1:20679/mcp",
            statusEndpoint: "http://localhost:30678/api/status",
          },
        },
      }),
    ).rejects.toThrow("使用");
    expect(threads.size).toBe(1);
  });

  it.each(["create", "continue"])(
    "waits for process termination after an uncertain %s before granting the Vibe instance",
    async (mode) => {
      const design = designFixture();
      let resolveClosing!: () => void;
      const closing = new Promise<void>((resolve) => {
        resolveClosing = resolve;
      });
      let resolveTerminated!: () => void;
      const terminated = new Promise<void>((resolve) => {
        resolveTerminated = resolve;
      });
      let firstClient: FakeCodex | undefined;
      const { directory, service, threads } = await setup({}, design, (client) => {
        if (firstClient) return;
        firstClient = client;
        if (mode === "create") client.startError = new CodexTimeoutError(1, "turn/start", 1);
        client.beforeClose = async () => {
          resolveClosing();
          await terminated;
          const thread = threads.get("task-0");
          if (!thread) return;
          for (const turn of thread.turns)
            if (turn.status === "inProgress") turn.status = "interrupted";
          thread.status = { type: "idle" };
        };
      });
      const input = {
        projectPath: directory,
        prompt: "Build",
        images: [],
        designSource: vibeSource,
      };
      if (mode === "continue") {
        const first = await service.create(input);
        await service.stop(first.taskId, `${first.taskId}-turn-0`);
        firstClient!.startError = new CodexTimeoutError(2, "turn/start", 1);
      }
      const attempt =
        mode === "create"
          ? service.create(input)
          : service.send("task-0", "Continue").catch((error: unknown) => error);
      await closing;
      const native = threads.get("task-0");
      if (!native) throw new Error("Missing pending native task");
      expect(native.status.type).toBe("idle");
      let anotherSettled = false;
      const another = service.create(input).finally(() => {
        anotherSettled = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(anotherSettled).toBe(false);
        expect(threads.size).toBe(1);
        native.turns.push({ id: "late-turn", status: "inProgress", error: null, items: [] });
        native.status = { type: "active" };
      } finally {
        resolveTerminated();
      }
      const result = await attempt;
      if (mode === "create")
        expect(result).toMatchObject({ warning: expect.stringContaining("为避免并发已终止连接") });
      else expect(result).toBeInstanceOf(Error);
      await expect(another).resolves.toHaveProperty("taskId", "task-1");
      expect(firstClient?.closeCount).toBe(1);
      expect(native.turns.find((turn) => turn.id === "late-turn")?.status).toBe("interrupted");
      expect(
        [...threads.values()].flatMap((thread) =>
          thread.turns.filter((turn) => turn.status === "inProgress"),
        ),
      ).toHaveLength(1);
      await expect(design.bridges[0]?.beforeRead()).rejects.toThrow("未持有");
    },
  );

  it("closes an unpublished bridge when task identity persistence fails", async () => {
    const design = designFixture();
    const { directory, service, clients } = await setup({}, design);
    vi.spyOn(service.index, "put").mockRejectedValueOnce(new Error("Index write failed"));
    await expect(
      service.create({
        projectPath: directory,
        prompt: "Build",
        images: [],
        designSource: vibeSource,
      }),
    ).rejects.toThrow("Index write failed");
    const bridge = await design.startVibeBridge.mock.results[0]?.value;
    expect(bridge?.close).toHaveBeenCalledOnce();
    expect(service.index.list(0).tasks).toHaveLength(0);
    expect(clients[0]?.calls.some((call) => call.method === "turn/start")).toBe(false);
  });

  it("keeps local history and stop available when Vibe is unavailable, including after restart", async () => {
    const design = designFixture();
    const { directory, service, factory, threads } = await setup({}, design);
    const task = await service.create({
      projectPath: directory,
      prompt: "Build",
      images: [],
      designSource: vibeSource,
    });
    const frozen = service.index.get(task.taskId).designBinding;
    await service.close();
    design.designCheck.mockRejectedValue(new Error("Canvas unavailable"));
    design.designCheck.mockClear();
    const restarted = new SessionService({ directory, connectionFactory: factory, ...design });
    cleanup.push(() => restarted.close());
    await restarted.initialize();
    expect((await restarted.read(task.taskId)).designBinding).toEqual(frozen);
    await expect(restarted.readDiagnostics(task.taskId)).resolves.toHaveProperty(
      "taskId",
      task.taskId,
    );
    await expect(
      restarted.create({
        projectPath: directory,
        prompt: "Another",
        images: [],
        designSource: vibeSource,
      }),
    ).rejects.toThrow("使用");
    await restarted.stop(task.taskId, `${task.taskId}-turn-0`);
    expect(threads.get(task.taskId)?.turns[0]?.status).toBe("interrupted");
    expect(design.designCheck).not.toHaveBeenCalled();
    await expect(restarted.send(task.taskId, "Continue")).rejects.toThrow("Canvas unavailable");
    expect(threads.get(task.taskId)?.turns).toHaveLength(1);
  });

  it("rejects a changed Vibe page before continuing an already loaded task", async () => {
    const design = designFixture();
    const { directory, service, threads } = await setup({}, design);
    const task = await service.create({
      projectPath: directory,
      prompt: "Build",
      images: [],
      designSource: vibeSource,
    });
    await service.stop(task.taskId, `${task.taskId}-turn-0`);
    design.designCheck.mockResolvedValue({
      source: vibeSource,
      target: { documentId: "document", pageId: "other-page", nodeId: "1:2" },
      tools: [],
    });
    await expect(service.send(task.taskId, "Continue")).rejects.toThrow("绑定不一致");
    expect(threads.get(task.taskId)?.turns).toHaveLength(1);
    expect(service.index.get(task.taskId).designBinding?.target?.pageId).toBe("page");
  });

  it("isolates Vibe and local connections and keeps another connection's snapshot when one closes", async () => {
    const design = designFixture();
    const { directory, service, clients } = await setup({}, design);
    const vibe = await service.create({
      projectPath: directory,
      prompt: "Vibe",
      images: [],
      designSource: vibeSource,
    });
    const local = await service.create({
      projectPath: directory,
      prompt: "Local",
      images: [],
      designSource: { kind: "local" },
    });
    expect(clients).toHaveLength(2);
    expect(clients[1]?.prepareD2C).toHaveBeenCalledWith(
      expect.objectContaining({ designAccess: { kind: "local" } }),
    );
    expect((await service.read(local.taskId)).designBinding?.source).toEqual({ kind: "local" });
    await clients[0]?.close();
    const controller = new AbortController();
    const stream = service.subscribe(local.taskId, controller.signal)[Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({
      snapshot: { thread: { id: local.taskId } },
    });
    controller.abort();
    await stream.return?.();
    expect(clients[1]?.closeCount).toBe(0);
    expect(vibe.taskId).not.toBe(local.taskId);
  });

  it("restores legacy tasks through Magic without inventing a new binding or checking a canvas", async () => {
    const design = designFixture();
    const { directory, service, clients, factory } = await setup({}, design);
    const task = await service.create({
      projectPath: directory,
      prompt: "Legacy",
      images: [],
      designSource: { kind: "local" },
    });
    const entry = service.index.get(task.taskId);
    const { designBinding: _binding, ...legacy } = entry;
    await service.index.put(legacy);
    await service.close();
    design.designCheck.mockClear();
    const restarted = new SessionService({ directory, connectionFactory: factory, ...design });
    cleanup.push(() => restarted.close());
    await restarted.initialize();
    expect((await restarted.read(task.taskId)).designBinding).toBeUndefined();
    expect(clients.at(-1)?.prepareD2CRuntime).toHaveBeenCalledWith(
      expect.not.objectContaining({ designAccess: expect.anything() }),
    );
    expect(design.designCheck).not.toHaveBeenCalled();
    expect(design.startVibeBridge).not.toHaveBeenCalled();
  });
});
