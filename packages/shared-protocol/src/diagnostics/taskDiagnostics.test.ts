import { describe, expect, it } from "vitest";
import {
  readTaskDiagnosticsSchema,
  taskDiagnosticsSchema,
  type TaskDiagnostics,
} from "./taskDiagnostics.js";

const report: TaskDiagnostics = {
  reportVersion: 2,
  generatedAt: "2026-09-20T00:00:00.000Z",
  taskId: "task-1",
  source: "codex-thread-read",
  scope: "thread-tree",
  status: "idle",
  model: "fixture-model",
  modelProvider: "fixture",
  reasoningEffort: "medium",
  codexVersion: "fixture",
  protocolVersion: "fixture",
  runtime: {
    executablePath: "/opt/codex",
    codexHome: "/tmp/codex",
    serviceTier: "flex",
    configuredConcurrency: 1,
    currentConcurrency: 2,
    peakConcurrency: 2,
    platform: "darwin",
    arch: "arm64",
  },
  agents: [
    {
      threadId: "thread-1",
      parentThreadId: null,
      source: "appServer",
      model: "fixture-model",
      modelProvider: "fixture",
      reasoningEffort: "medium",
      serviceTier: "flex",
      status: "idle",
      errorCodes: ["serverOverloaded"],
    },
  ],
  ruleFingerprints: null,
  tokenUsage: null,
  turns: [
    {
      turnId: "turn-1",
      status: "failed",
      startedAt: null,
      completedAt: null,
      durationMs: null,
      errorCode: "serverOverloaded",
      tools: [],
    },
  ],
  warnings: ["rulesUnavailable", "tokenUsageUnavailable"],
};

describe("task diagnostic contract", () => {
  it("preserves unknown historical values without defaulting to zero", () => {
    expect(taskDiagnosticsSchema.parse(report)).toEqual(report);
  });

  it.each(["preview", "cwd", "prompt", "instructions", "rawError", "additionalDetails", "token"])(
    "rejects an extra private report field: %s",
    (key) =>
      expect(taskDiagnosticsSchema.safeParse({ ...report, [key]: "private-value" }).success).toBe(
        false,
      ),
  );

  it("rejects nested source content rather than passing it through", () => {
    expect(
      taskDiagnosticsSchema.safeParse({
        ...report,
        turns: [{ ...report.turns[0], error: { message: "secret" } }],
      }).success,
    ).toBe(false);
    expect(
      taskDiagnosticsSchema.safeParse({
        ...report,
        ruleFingerprints: {
          design: "a".repeat(64),
          project: "b".repeat(64),
          content: "private rules",
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    { reportVersion: 1 },
    { model: "model\nprivate-output" },
    { status: "accepted" },
    { warnings: ["raw private failure"] },
    { ruleFingerprints: { design: "rules", project: "rules" } },
    { turns: [{ ...report.turns[0], durationMs: -1 }] },
    { tokenUsage: { observedAt: "not-a-date", total: {} } },
    {
      runtime: {
        executablePath: "/opt/codex",
        codexHome: null,
        serviceTier: null,
        configuredConcurrency: -1,
        currentConcurrency: null,
        peakConcurrency: null,
        platform: null,
        arch: null,
      },
    },
    {
      agents: [
        {
          threadId: "thread-1",
          parentThreadId: null,
          source: "appServer",
          model: "fixture-model",
          modelProvider: "fixture",
          reasoningEffort: "medium",
          serviceTier: null,
          status: "idle",
          errorCodes: [],
          prompt: "private",
        },
      ],
    },
  ])("rejects malformed or unsupported values: %j", (fields) => {
    expect(taskDiagnosticsSchema.safeParse({ ...report, ...fields }).success).toBe(false);
  });

  it("accepts explicit unknown runtime values and empty agent summaries", () => {
    const parsed = taskDiagnosticsSchema.parse({
      ...report,
      runtime: {
        executablePath: null,
        codexHome: null,
        serviceTier: null,
        configuredConcurrency: null,
        currentConcurrency: null,
        peakConcurrency: null,
        platform: null,
        arch: null,
      },
      agents: [],
    });
    expect(parsed.runtime?.currentConcurrency).toBeNull();
    expect(parsed.agents).toEqual([]);
  });

  it("accepts real zero usage and prevents extra token payload fields", () => {
    const tokenUsage = {
      observedAt: report.generatedAt,
      total: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
    };
    expect(
      taskDiagnosticsSchema.parse({ ...report, tokenUsage }).tokenUsage?.total.totalTokens,
    ).toBe(0);
    expect(
      taskDiagnosticsSchema.safeParse({ ...report, tokenUsage: { ...tokenUsage, raw: "private" } })
        .success,
    ).toBe(false);
  });

  it("accepts only a task identity in read requests", () => {
    expect(readTaskDiagnosticsSchema.parse({ taskId: "task-1" })).toEqual({ taskId: "task-1" });
    expect(
      readTaskDiagnosticsSchema.safeParse({ taskId: "task-1", projectPath: "/private" }).success,
    ).toBe(false);
    expect(readTaskDiagnosticsSchema.safeParse({ taskId: "" }).success).toBe(false);
  });
});
