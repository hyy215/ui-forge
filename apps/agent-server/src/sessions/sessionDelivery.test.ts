import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { deliveryReportPath, temporaryWorkspacePath } from "@ui-forge/codex-client";
import {
  createCommunicationRequestMessage,
  deliveryManifestSchema,
  deliveryMethods,
  taskDeliverySchema,
} from "@ui-forge/shared-protocol";
import {
  capacityFailureScenario,
  thread,
  startResponse,
  turn,
} from "../../../../packages/codex-client/src/testing/payloads.js";
import type { CodexConnection } from "../runtime/codexConnections.js";
import { SessionService } from "./sessionService.js";
import { buildApp } from "../http/buildApp.js";

const directories: string[] = [];
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "session-delivery-")));
  directories.push(directory);
  const current = { ...thread, cwd: directory, turns: [capacityFailureScenario.failedTurn] };
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config/read") return { config: {} };
    if (method === "thread/read") return { thread: current };
    if (method === "thread/start") return { ...startResponse, thread: current };
    if (method === "turn/start") return { turn };
    throw new Error(`Unexpected request: ${method}`);
  });
  const client = {
    request,
    prepareD2C: vi.fn(async () => ({
      thread: {},
      input: [],
      ruleFingerprints: { design: "a".repeat(64), project: "b".repeat(64) },
    })),
    prepareD2CRuntime: vi.fn(),
    pendingRequests: () => [],
    respond: vi.fn(),
    subscribe: () => () => undefined,
    close: vi.fn(async () => undefined),
  };
  const service = new SessionService({
    directory,
    connectionFactory: () => client as unknown as CodexConnection,
  });
  cleanup.push(() => service.close());
  await service.initialize();
  return { directory, current, service, client, request };
}

it("queries a missing report without starting even a Codex connection", async () => {
  const { directory, service, request } = await setup();
  await expect(service.readDelivery(thread.id)).rejects.toThrow("任务不存在");
  await service.index.put({
    taskId: thread.id,
    projectPath: directory,
    title: "private",
    updatedAt: new Date().toISOString(),
  });
  expect(await service.readDelivery(thread.id)).toMatchObject({
    availability: "missing",
    report: null,
  });
  expect(request).not.toHaveBeenCalled();
});

it("reads native evidence through RPC without restoring a task or requiring its Vibe canvas", async () => {
  const { directory, service, request, client } = await setup();
  await service.index.put({
    taskId: thread.id,
    projectPath: directory,
    title: "private",
    updatedAt: new Date().toISOString(),
    designBinding: {
      bindingId: "00000000-0000-4000-8000-000000000001",
      source: {
        kind: "mastergo",
        url: "https://mastergo.com/file/doc?layer_id=1:2",
        connection: {
          kind: "vibe",
          endpoint: "http://127.0.0.1:1/mcp",
          statusEndpoint: "http://127.0.0.1:1/api/status",
        },
      },
      target: { documentId: "doc", pageId: "page", nodeId: "1:2" },
    },
  });
  const path = deliveryReportPath(await temporaryWorkspacePath(directory, directory), thread.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      taskId: thread.id,
      generatedAt: new Date().toISOString(),
      summary: "",
      sourceFiles: [],
      checks: [
        {
          id: "build",
          category: "build",
          title: "build",
          declaredStatus: "passed",
          details: "",
          evidence: [{ kind: "native", turnId: turn.id, itemId: "capacity-command" }],
        },
      ],
    }),
  );
  const app = buildApp({
    sessionService: service,
    runtimeDirectory: directory,
    instanceLock: false,
  });
  cleanup.unshift(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/communication",
    payload: createCommunicationRequestMessage("delivery", deliveryMethods.read, {
      taskId: thread.id,
    }),
  });
  expect(response.json()).toMatchObject({ requestId: "delivery", success: true });
  const result = taskDeliverySchema.parse(response.json().data);
  expect(result.evidence[0]).toMatchObject({ state: "succeeded", exitCode: 0 });
  expect(result.source.state).toBe("unverifiable");
  expect(request.mock.calls.map(([method]) => method)).toEqual(["config/read", "thread/read"]);
  expect(client.prepareD2CRuntime).not.toHaveBeenCalled();
  expect(client.prepareD2C).not.toHaveBeenCalled();
  const invalid = await app.inject({
    method: "POST",
    url: "/api/communication",
    payload: createCommunicationRequestMessage("invalid", deliveryMethods.read, {
      taskId: thread.id,
      path: "/private/secret",
    }),
  });
  expect(invalid.json()).toMatchObject({ requestId: "invalid", success: false });
});

it.each(["renamed", "deleted"])(
  "serves the historical report over RPC when the workspace is %s without starting Codex",
  async (change) => {
    const { directory, service, request, client } = await setup();
    const workspace = join(directory, "project");
    await mkdir(workspace);
    await service.index.put({
      taskId: thread.id,
      projectPath: workspace,
      title: "historical report",
      updatedAt: new Date().toISOString(),
    });
    const path = deliveryReportPath(await temporaryWorkspacePath(workspace, directory), thread.id);
    await mkdir(dirname(path), { recursive: true });
    const report = deliveryManifestSchema.parse({
      version: 1,
      taskId: thread.id,
      generatedAt: new Date().toISOString(),
      summary: "历史报告仍保留",
      sourceFiles: [{ path: "App.tsx", sha256: "a".repeat(64) }],
      checks: [
        {
          id: "build",
          category: "build",
          title: "build",
          declaredStatus: "passed",
          details: "",
          evidence: [{ kind: "native", turnId: turn.id, itemId: "capacity-command" }],
        },
      ],
    });
    await writeFile(path, JSON.stringify(report));
    if (change === "renamed") await rename(workspace, join(directory, "renamed-project"));
    else await rm(workspace, { recursive: true });
    const app = buildApp({
      sessionService: service,
      runtimeDirectory: directory,
      instanceLock: false,
    });
    cleanup.unshift(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("historical-delivery", deliveryMethods.read, {
        taskId: thread.id,
      }),
    });
    expect(response.json()).toMatchObject({ requestId: "historical-delivery", success: true });
    expect(taskDeliverySchema.parse(response.json().data)).toMatchObject({
      availability: "available",
      report,
      source: { state: "unverifiable", files: [{ path: "App.tsx", state: "unavailable" }] },
      history: "unavailable",
      evidence: [{ state: "unavailable" }],
    });
    expect(await readFile(path, "utf8")).toBe(JSON.stringify(report));
    expect(service.index.get(thread.id).projectPath).toBe(workspace);
    expect(request).not.toHaveBeenCalled();
    expect(client.prepareD2C).not.toHaveBeenCalled();
    expect(client.prepareD2CRuntime).not.toHaveBeenCalled();
  },
);

it("injects a valid unverified delivery template when starting a task", async () => {
  const { directory, service, request } = await setup();
  await service.create({ projectPath: directory, prompt: "build", images: [] });
  const input = request.mock.calls.find(([method]) => method === "turn/start")?.[1];
  expect(input).toMatchObject({
    additionalContext: { ui_forge_delivery: { kind: "application" } },
  });
  if (!input || typeof input !== "object" || !("additionalContext" in input))
    throw new Error("Missing context");
  const serialized = JSON.stringify(input.additionalContext);
  expect(serialized).toContain(
    deliveryReportPath(await temporaryWorkspacePath(directory, directory), thread.id),
  );
  const context = input.additionalContext as { ui_forge_delivery: { value: string } };
  const template: unknown = JSON.parse(
    context.ui_forge_delivery.value.split("\n").at(-1) ?? "null",
  );
  const report = deliveryManifestSchema.parse(template);
  expect(report.taskId).toBe(thread.id);
  expect(report.sourceFiles).toEqual([]);
  expect(report.checks.map((check) => check.category)).toEqual([
    "build",
    "interaction",
    "visual",
    "performance",
    "review",
  ]);
  for (const check of report.checks) {
    expect(check.declaredStatus).toBe("not-verified");
    expect(check.evidence).toEqual([]);
    expect(check.details.length).toBeGreaterThan(0);
  }
});
