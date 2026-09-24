import { describe, expect, it } from "vitest";
import { deliveryManifestSchema, taskDeliverySchema } from "./taskDelivery.js";

const report = {
  version: 1,
  taskId: "task-1",
  generatedAt: "2026-09-23T00:00:00.000Z",
  summary: "真实构建结果，视觉受阻",
  sourceFiles: [{ path: "src/app.ts", sha256: "a".repeat(64) }],
  checks: [
    {
      id: "build",
      category: "build",
      title: "构建",
      declaredStatus: "passed",
      details: "测试命令输出",
      evidence: [],
    },
  ],
};

describe("delivery manifest", () => {
  it("normalizes legacy path evidence without treating it as verified", () => {
    const parsed = deliveryManifestSchema.parse({
      ...report,
      checks: [
        {
          ...report.checks[0],
          category: "performance",
          evidence: ["/tmp/validation/performance.json"],
        },
      ],
    });
    expect(parsed.checks[0]).toMatchObject({
      category: "performance",
      evidence: [{ kind: "legacy", path: "/tmp/validation/performance.json" }],
    });
  });

  it("normalizes the old path-description evidence shape as unsupported", () => {
    const parsed = deliveryManifestSchema.parse({
      ...report,
      checks: [
        {
          ...report.checks[0],
          evidence: [{ path: "/tmp/validation/build.log", description: "旧格式输出" }],
        },
      ],
    });
    expect(parsed.checks[0]?.evidence).toEqual([
      { kind: "legacy", path: "/tmp/validation/build.log" },
    ]);
  });

  it("keeps an unsupported pass a declaration, without manufacturing evidence", () => {
    expect(deliveryManifestSchema.parse(report).checks[0]).toMatchObject({
      declaredStatus: "passed",
      evidence: [],
    });
    expect(deliveryManifestSchema.safeParse({ ...report, accepted: true }).success).toBe(false);
  });
  it.each([
    { ...report, checks: [...report.checks, ...report.checks] },
    { ...report, sourceFiles: [...report.sourceFiles, ...report.sourceFiles] },
    { ...report, sourceFiles: [{ path: "a", sha256: "fake" }] },
    { ...report, checks: [] },
    { ...report, generatedAt: "yesterday" },
    { ...report, summary: "a".repeat(4001) },
    {
      ...report,
      sourceFiles: Array.from({ length: 257 }, (_, i) => ({
        path: `${i}`,
        sha256: "a".repeat(64),
      })),
    },
    {
      ...report,
      checks: [
        {
          ...report.checks[0],
          evidence: [{ kind: "file", path: "/tmp/report", sha256: "a".repeat(64), execute: true }],
        },
      ],
    },
  ])("rejects malformed, unbounded or duplicated records", (value) => {
    expect(deliveryManifestSchema.safeParse(value).success).toBe(false);
  });
  it("does not add acceptance or execution state to the query result", () => {
    const result = taskDeliverySchema.parse({
      version: 1,
      taskId: report.taskId,
      checkedAt: report.generatedAt,
      availability: "missing",
      issue: null,
      report: null,
      reportSha256: null,
      source: { state: "unverifiable", manifestFingerprint: null, files: [] },
      evidence: [],
      history: "not-requested",
    });
    expect(result).not.toHaveProperty("accepted");
    expect(result).not.toHaveProperty("taskStatus");
  });
});
