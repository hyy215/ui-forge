import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CodexEvent, NativeMethods, ServerNotification } from "@ui-forge/codex-client";
import {
  createCommunicationRequestMessage,
  diagnosticMethods,
  taskDiagnosticsSchema,
} from "@ui-forge/shared-protocol";
import {
  thread,
  turn,
  startResponse,
} from "../../../../packages/codex-client/src/testing/payloads.js";
import type { CodexConnection } from "../runtime/codexConnections.js";
import { SessionService } from "../sessions/sessionService.js";
import { buildApp } from "../http/buildApp.js";

const directories: string[] = [];
const cleanup: Array<() => Promise<unknown>> = [];
const rules = { design: "a".repeat(64), project: "b".repeat(64) };
async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "session-diagnostics-")));
  directories.push(directory);
  const current: NativeMethods["thread/read"]["result"]["thread"] = { ...thread, cwd: directory };
  const listeners = new Set<(event: CodexEvent) => void>();
  const request = vi.fn(async (method: string) => {
    if (method === "config/read") return { config: {} };
    if (method === "thread/start") return { ...startResponse, thread: current, cwd: directory };
    if (method === "turn/start") {
      current.turns = [{ ...turn }];
      return { turn: current.turns[0] };
    }
    if (method === "thread/read") return { thread: structuredClone(current) };
    if (method === "thread/list") return { data: [], nextCursor: null, backwardsCursor: null };
    throw new Error(`Unexpected request: ${method}`);
  });
  const client = {
    request,
    prepareD2C: vi.fn(async () => ({
      thread: { config: { agents: { max_concurrent_threads_per_session: 1 } } },
      input: [{ type: "text", text: "private-prompt", text_elements: [] }],
      ruleFingerprints: rules,
    })),
    prepareD2CRuntime: vi.fn(),
    pendingRequests: () => [],
    respond: vi.fn(),
    subscribe: (listener: (event: CodexEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: vi.fn(async () => undefined),
  };
  const factory = () => client as unknown as CodexConnection;
  const service = new SessionService({ directory, connectionFactory: factory });
  cleanup.push(() => service.close());
  await service.initialize();
  const emitTokens = (threadId: string, totalTokens: number) => {
    const total = {
      totalTokens,
      inputTokens: totalTokens,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    for (const listener of listeners)
      listener({
        type: "notification",
        notification: {
          method: "thread/tokenUsage/updated",
          params: {
            threadId,
            turnId: turn.id,
            tokenUsage: { total, last: total, modelContextWindow: null },
          },
        },
      });
  };
  const emitNotification = (notification: ServerNotification) => {
    for (const listener of listeners) listener({ type: "notification", notification });
  };
  return { directory, current, service, client, request, emitTokens, emitNotification, factory };
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("authorizes an indexed task and reads history without preparing or resuming it", async () => {
  const { directory, service, request, client } = await setup();
  await expect(service.readDiagnostics(thread.id)).rejects.toThrow("任务不存在");
  expect(request).not.toHaveBeenCalled();
  await service.index.put({
    taskId: thread.id,
    projectPath: directory,
    title: "private-title",
    updatedAt: new Date().toISOString(),
  });
  const result = await service.readDiagnostics(thread.id);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "config/read",
    "thread/read",
    "thread/list",
  ]);
  expect(client.prepareD2C).not.toHaveBeenCalled();
  expect(client.prepareD2CRuntime).not.toHaveBeenCalled();
  expect(result.ruleFingerprints).toBeNull();
  expect(result.tokenUsage).toBeNull();
  expect(result.warnings).toEqual([
    "rulesUnavailable",
    "tokenUsageUnavailable",
    "runtimeUnavailable",
  ]);
});

it("persists creation fingerprints and only the parent's latest cumulative usage across restart", async () => {
  const { directory, service, emitTokens, factory } = await setup();
  await service.create({ projectPath: directory, prompt: "Build", images: [] });
  emitTokens(thread.id, 10);
  emitTokens(thread.id, 20);
  emitTokens(thread.id, 20);
  emitTokens("child", 900);
  await service.close();
  const restarted = new SessionService({ directory, connectionFactory: factory });
  cleanup.push(() => restarted.close());
  await restarted.initialize();
  const result = await restarted.readDiagnostics(thread.id);
  expect(result.ruleFingerprints).toEqual(rules);
  expect(result.tokenUsage?.total.totalTokens).toBe(20);
  expect(result.warnings).toEqual([]);
});

it("continues creation when diagnostic storage fails and reports the missing durability", async () => {
  const { directory, service, request, emitTokens } = await setup();
  await writeFile(join(directory, "diagnostics"), "blocked");
  const created = await service.create({ projectPath: directory, prompt: "Build", images: [] });
  expect(created.warning).toContain("诊断元数据保存不完整");
  expect(request.mock.calls.map(([method]) => method)).toContain("turn/start");
  emitTokens(thread.id, 10);
  const result = await service.readDiagnostics(thread.id);
  expect(result.ruleFingerprints).toEqual(rules);
  expect(result.tokenUsage?.total.totalTokens).toBe(10);
  expect(result.warnings).toEqual(["metadataReadFailed", "metadataWriteFailed"]);
});

it("never recovers a failed history read or exposes its private error text", async () => {
  const { directory, service, request } = await setup();
  await service.index.put({
    taskId: thread.id,
    projectPath: directory,
    title: "private",
    updatedAt: new Date().toISOString(),
  });
  request.mockImplementation(async (method) => {
    if (method === "config/read") return { config: {} };
    throw new Error("private-history-path /private/project and sensitive-output");
  });
  await expect(service.readDiagnostics(thread.id)).rejects.toThrow(
    "原生任务历史读取失败，诊断暂不可用。",
  );
  expect(request.mock.calls.map(([method]) => method)).toEqual(["config/read", "thread/read"]);
});

it("exposes the strict diagnostic report through the existing RPC boundary", async () => {
  const { directory, service, request } = await setup();
  await service.index.put({
    taskId: thread.id,
    projectPath: directory,
    title: "private",
    updatedAt: new Date().toISOString(),
  });
  const app = buildApp({
    sessionService: service,
    runtimeDirectory: directory,
    instanceLock: false,
  });
  cleanup.push(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/communication",
    payload: createCommunicationRequestMessage("report", diagnosticMethods.read, {
      taskId: thread.id,
    }),
  });
  expect(response.statusCode).toBe(200);
  const body: unknown = response.json();
  expect(body).toMatchObject({ requestId: "report", success: true });
  if (!body || typeof body !== "object" || !("data" in body)) throw new Error("Missing report");
  expect(taskDiagnosticsSchema.parse(body.data).taskId).toBe(thread.id);
  expect(request.mock.calls.map(([method]) => method)).toEqual([
    "config/read",
    "thread/read",
    "thread/list",
  ]);
});

it("projects runtime metadata and a child thread without exporting its private history", async () => {
  const { directory, service, request, emitNotification } = await setup();
  await service.create({ projectPath: directory, prompt: "Build", images: [] });
  const child = {
    ...thread,
    id: "child-1",
    parentThreadId: thread.id,
    cwd: directory,
    model: "child-model",
    threadSource: "subAgent",
    status: { type: "active", activeFlags: [] },
    turns: [],
  } satisfies NativeMethods["thread/list"]["result"]["data"][number];
  const reviewChild = {
    ...child,
    id: "child-2",
    model: "review-model",
    threadSource: "subAgentReview",
  } satisfies NativeMethods["thread/list"]["result"]["data"][number];
  const requiredSources = [
    "subAgent",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "subAgentOther",
  ] as const;
  request.mockImplementation(async (method, params) => {
    if (method === "config/read") return { config: {} };
    if (method === "thread/start")
      return { ...startResponse, thread: { ...thread, cwd: directory } };
    if (method === "thread/read") return { thread: { ...thread, cwd: directory } };
    if (method === "thread/list") {
      const listParams = params as NativeMethods["thread/list"]["params"];
      const includesAllChildSources = requiredSources.every((source) =>
        listParams.sourceKinds?.includes(source),
      );
      const page = listParams.cursor ? [reviewChild] : [child];
      return {
        data: includesAllChildSources ? page : [],
        nextCursor: listParams.cursor ? null : "child-page-2",
        backwardsCursor: null,
      };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  emitNotification({ method: "thread/started", params: { thread: child } });
  const report = await service.readDiagnostics(thread.id);
  expect(report.runtime).toMatchObject({
    configuredConcurrency: 1,
    currentConcurrency: 2,
    peakConcurrency: 2,
  });
  expect(report.agents.map((agent) => agent.threadId)).toEqual([
    thread.id,
    "child-1",
    "child-2",
  ]);
  expect(report.agents[1]).toMatchObject({
    parentThreadId: thread.id,
    model: "child-model",
    source: "subAgent",
    status: "active",
  });
  expect(report.agents[2]).toMatchObject({
    parentThreadId: thread.id,
    model: "review-model",
    source: "subAgentReview",
    status: "active",
  });
  const listCalls = request.mock.calls.filter(([method]) => method === "thread/list");
  expect(listCalls).toHaveLength(2);
  expect(listCalls[0]?.[1]).toMatchObject({
    ancestorThreadId: thread.id,
    sourceKinds: requiredSources,
  });
  expect(listCalls[1]?.[1]).toMatchObject({ cursor: "child-page-2" });

  emitNotification({
    method: "thread/settings/updated",
    params: {
      threadId: child.id,
      threadSettings: {
        cwd: directory,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: startResponse.sandbox,
        activePermissionProfile: null,
        model: "child-model-updated",
        modelProvider: "openai",
        serviceTier: "child-tier",
        effort: null,
        summary: null,
        collaborationMode: {
          mode: "default",
          settings: {
            model: "child-model-updated",
            reasoning_effort: null,
            developer_instructions: null,
          },
        },
        multiAgentMode: "explicitRequestOnly",
        personality: null,
      },
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const updated = await service.readDiagnostics(thread.id);
  expect(updated.runtime?.serviceTier).toBeNull();
  expect(updated.agents.find((agent) => agent.threadId === child.id)).toMatchObject({
    serviceTier: "child-tier",
  });
  expect(JSON.stringify(report)).not.toContain("private-prompt");
});
