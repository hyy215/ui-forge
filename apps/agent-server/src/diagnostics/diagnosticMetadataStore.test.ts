import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagnosticMetadataStore } from "./diagnosticMetadataStore.js";
import type { DiagnosticTokenUsage } from "@ui-forge/shared-protocol";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "ui-forge-diagnostics-"));
  directories.push(path);
  return path;
}
const rules = { design: "a".repeat(64), project: "b".repeat(64) };
const usage = (tokens: number): DiagnosticTokenUsage => ({
  observedAt: "2026-09-20T00:00:00.000Z",
  total: {
    totalTokens: tokens,
    inputTokens: tokens,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  },
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("keeps older rules, serializes cumulative updates and restores only white-listed metadata", async () => {
  const path = await directory();
  const store = new DiagnosticMetadataStore(path);
  const taskId = "../../private/task";
  await Promise.all([
    store.recordRules(taskId, rules),
    store.recordTokenUsage(taskId, usage(10)),
    store.recordTokenUsage(taskId, usage(20)),
    store.recordTokenUsage(taskId, usage(20)),
    store.recordRules(taskId, { design: "c".repeat(64), project: "d".repeat(64) }),
  ]);
  await store.flush();
  const expected = {
    ruleFingerprints: rules,
    tokenUsage: usage(20),
    runtime: null,
    agents: [],
    warnings: [],
  };
  expect(await store.read(taskId)).toEqual(expected);
  expect(await new DiagnosticMetadataStore(path).read(taskId)).toEqual(expected);
  const name = `${createHash("sha256").update(taskId).digest("hex")}.json`;
  expect(await readdir(join(path, "diagnostics"))).toEqual([name]);
  expect(JSON.parse(await readFile(join(path, "diagnostics", name), "utf8"))).toEqual({
    version: 2,
    ruleFingerprints: rules,
    tokenUsage: usage(20),
    runtime: null,
    agents: [],
  });
  expect((await stat(join(path, "diagnostics", name))).mode & 0o777).toBe(0o600);
});

it("leaves legacy metadata unknown and rejects unknown persisted fields", async () => {
  const path = await directory();
  const store = new DiagnosticMetadataStore(path);
  expect(await store.read("legacy")).toEqual({
    ruleFingerprints: null,
    tokenUsage: null,
    runtime: null,
    agents: [],
    warnings: [],
  });
  await mkdir(join(path, "diagnostics"));
  const file = join(
    path,
    "diagnostics",
    `${createHash("sha256").update("corrupt").digest("hex")}.json`,
  );
  const content = JSON.stringify({
    version: 1,
    ruleFingerprints: rules,
    tokenUsage: usage(10),
    secret: "do-not-export",
  });
  await writeFile(file, content);
  expect(await store.read("corrupt")).toEqual({
    ruleFingerprints: null,
    tokenUsage: null,
    runtime: null,
    agents: [],
    warnings: ["metadataReadFailed"],
  });
  await store.recordTokenUsage("corrupt", usage(20));
  expect((await store.read("corrupt")).warnings).toEqual([
    "metadataReadFailed",
    "metadataWriteFailed",
  ]);
  expect(await readFile(file, "utf8")).toBe(content);
});

it("reports IO failure without rejecting updates or discarding current observations", async () => {
  const path = await directory();
  await writeFile(join(path, "diagnostics"), "blocked");
  const store = new DiagnosticMetadataStore(path);
  await expect(store.recordRules("task", rules)).resolves.toBeUndefined();
  await expect(store.recordTokenUsage("task", usage(11))).resolves.toBeUndefined();
  await expect(store.flush()).resolves.toBeUndefined();
  expect(await store.read("task")).toEqual({
    ruleFingerprints: rules,
    tokenUsage: usage(11),
    runtime: null,
    agents: [],
    warnings: ["metadataReadFailed", "metadataWriteFailed"],
  });
});

it("reports a write-only failure after an initially missing metadata file", async () => {
  const path = await directory();
  const store = new DiagnosticMetadataStore(path);
  expect(await store.read("task")).toEqual({
    ruleFingerprints: null,
    tokenUsage: null,
    runtime: null,
    agents: [],
    warnings: [],
  });
  await writeFile(join(path, "diagnostics"), "blocked after initial read");
  await expect(store.recordRules("task", rules)).resolves.toBeUndefined();
  await expect(store.recordTokenUsage("task", usage(21))).resolves.toBeUndefined();
  await store.flush();
  expect(await store.read("task")).toEqual({
    ruleFingerprints: rules,
    tokenUsage: usage(21),
    runtime: null,
    agents: [],
    warnings: ["metadataWriteFailed"],
  });
});

it("persists runtime, agent and concurrency observations without private fields", async () => {
  const path = await directory();
  const store = new DiagnosticMetadataStore(path);
  await store.recordRuntime("task", {
    executablePath: "/opt/codex",
    codexHome: "/tmp/codex",
    serviceTier: "pro",
    configuredConcurrency: 1,
    currentConcurrency: null,
    peakConcurrency: null,
    platform: "darwin",
    arch: "arm64",
  });
  await store.recordAgent("task", {
    threadId: "root",
    parentThreadId: null,
    source: "appServer",
    model: "fixture",
    modelProvider: "openai",
    reasoningEffort: "high",
    serviceTier: "pro",
    status: "active",
    errorCodes: [],
  });
  await store.recordConcurrency("task", 1);
  await store.recordConcurrency("task", 0);
  expect(await store.read("task")).toMatchObject({
    runtime: {
      configuredConcurrency: 1,
      currentConcurrency: 0,
      peakConcurrency: 1,
    },
    agents: [{ threadId: "root", status: "active" }],
  });
  const persisted = JSON.stringify(await store.read("task"));
  expect(persisted).not.toContain("prompt");
  expect(persisted).not.toContain("command");
});
