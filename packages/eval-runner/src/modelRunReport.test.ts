import { describe, expect, it } from "vitest";
import { createModelRunReport, parseModelRunEvents } from "./modelRunReport.js";

describe("model run report", () => {
  it("keeps raw numeric evidence and separates missing usage from zero", () => {
    const lines = [
      { status: "turn-started" }, { status: "turn-completed", durationMs: 100, inputTokens: 10, outputTokens: 5, reasoningTokens: 0 },
      { status: "turn-started" }, { status: "turn-completed", durationMs: 300 },
    ].map((event) => JSON.stringify({ event: "model.invocation", model: "qwen3.7-plus", stage: "plan-generation",
      taskId: "task-1", prompt: "must not appear", workspace: "/private/project", ...event })).join("\n");
    const result = createModelRunReport(parseModelRunEvents(lines));
    expect(result.stages[0]).toMatchObject({ requestCount: 2, completedCount: 2, reportedUsageCount: 1,
      latencyMs: { p50: 100, p95: 300 }, inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: null });
    expect(result.events).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("must not appear");
  });
  it("rejects invalid external JSON and numeric measurements", () => {
    expect(() => parseModelRunEvents("not json")).toThrow("有效 JSON");
    expect(() => parseModelRunEvents(JSON.stringify({ event: "model.invocation", stage: "plan", status: "turn-completed", durationMs: -1 })))
      .toThrow("无效指标");
    expect(createModelRunReport([]).stages).toEqual([]);
  });
});
