import { expect, it } from "vitest";
import type { DeliveryManifest, TaskDelivery } from "@ui-forge/shared-protocol";
import { deliveryGaps } from "./deliveryGaps.js";

const categories = ["build", "interaction", "visual", "review"] as const;
const fileEvidence = { kind: "file", path: "result.json", sha256: "a".repeat(64) } as const;

function fixture(checks?: DeliveryManifest["checks"]): TaskDelivery {
  return {
    version: 1,
    taskId: "task-1",
    checkedAt: "2026-09-23T01:00:00.000Z",
    availability: "available",
    issue: null,
    report: {
      version: 1,
      taskId: "task-1",
      generatedAt: "2026-09-23T00:00:00.000Z",
      summary: "交付声明",
      sourceFiles: [{ path: "src/App.tsx", sha256: "b".repeat(64) }],
      checks:
        checks ??
        categories.map((category) => ({
          id: category,
          category,
          title: category,
          declaredStatus: "not-verified",
          details: "尚未验证",
          evidence: [],
        })),
    },
    reportSha256: "c".repeat(64),
    source: {
      state: "matches",
      manifestFingerprint: "d".repeat(64),
      files: [{ path: "src/App.tsx", state: "matched" }],
    },
    evidence: [],
    history: "not-requested",
  };
}

function withPassedBuild(evidence: DeliveryManifest["checks"][number]["evidence"]): TaskDelivery {
  const result = fixture();
  const check = result.report?.checks[0];
  if (!check) throw new Error("Missing fixture check");
  check.declaredStatus = "passed";
  check.evidence = evidence;
  return result;
}

function allPassed(): TaskDelivery {
  const result = fixture(
    categories.map((category) => ({
      id: category,
      category,
      title: category,
      declaredStatus: "passed",
      details: "已记录结果",
      evidence: [fileEvidence],
    })),
  );
  result.evidence = categories.map((category) => ({
    checkId: category,
    index: 0,
    state: "matched",
    resolvedPath: "/project/result.json",
    exitCode: null,
  }));
  return result;
}

it.each(["missing", "invalid"] as const)(
  "leaves %s reports to the existing availability presentation",
  (availability) => {
    const result = allPassed();
    result.availability = availability;
    result.source.state = "stale";
    expect(deliveryGaps(result)).toEqual([]);
    expect(deliveryGaps({ ...fixture(), report: null })).toEqual([]);
  },
);

it("identifies each missing category without requiring the task to execute it", () => {
  const result = fixture([
    {
      id: "other",
      category: "other",
      title: "其他",
      declaredStatus: "not-verified",
      details: "",
      evidence: [],
    },
  ]);
  expect(deliveryGaps(result).map((gap) => gap.code)).toEqual([
    "missing-build-check",
    "missing-interaction-check",
    "missing-visual-check",
    "missing-review-check",
  ]);
  expect(deliveryGaps(result).every((gap) => gap.checkId === undefined)).toBe(true);
  expect(
    deliveryGaps(result).every(
      (gap) => gap.message.includes("不能据此确认已验证") && gap.message.includes("不适用"),
    ),
  ).toBe(true);
});

it("allows repeated categories and does not repeat explicit failed, blocked or unverified checks", () => {
  const result = fixture();
  if (!result.report) throw new Error("Missing fixture report");
  result.report.checks = result.report.checks.map((check, index) => ({
    ...check,
    declaredStatus: index === 0 ? "failed" : index === 1 ? "blocked" : "not-verified",
    details: index === 1 ? "静态页面无需交互检查" : "已注明当前状态",
  }));
  result.report.checks.push({
    id: "build-types",
    category: "build",
    title: "类型",
    declaredStatus: "blocked",
    details: "依赖尚未准备",
    evidence: [],
  });
  result.source.state = "unverifiable";
  expect(deliveryGaps(result)).toEqual([]);
});

it("reports a passed check without evidence exactly once, without changing its declaration", () => {
  const result = withPassedBuild([]);
  const before = structuredClone(result);
  expect(deliveryGaps(result)).toEqual([
    {
      code: "passed-without-evidence",
      checkId: "build",
      message: expect.stringContaining("未提供证据引用"),
    },
  ]);
  expect(result).toEqual(before);
});

it.each([
  "failed",
  "changed",
  "missing",
  "outside-scope",
  "unavailable",
  "unsupported",
  "incomplete",
] as const)("reports %s evidence on a declared pass", (state) => {
  const result = withPassedBuild([fileEvidence]);
  result.evidence = [{ checkId: "build", index: 0, state, resolvedPath: null, exitCode: null }];
  expect(deliveryGaps(result)).toEqual([
    {
      code: "passed-with-unconfirmed-evidence",
      checkId: "build",
      message: expect.stringContaining("证据未核对成功"),
    },
  ]);
});

it("requires an unambiguous matching check and evidence index instead of accepting unrelated results", () => {
  const result = withPassedBuild([fileEvidence]);
  const matched = {
    checkId: "build",
    index: 0,
    state: "matched",
    resolvedPath: "/project/result.json",
    exitCode: null,
  } as const;
  for (const evidence of [
    [],
    [{ ...matched, checkId: "other" }],
    [{ ...matched, index: 1 }],
    [matched, matched],
  ]) {
    result.evidence = evidence;
    expect(deliveryGaps(result).map((gap) => gap.code)).toEqual([
      "passed-with-unconfirmed-evidence",
    ]);
  }
  result.evidence = [matched];
  expect(deliveryGaps(result)).toEqual([]);
});

it("accepts only file matches or native tool successes as corresponding evidence facts", () => {
  const native = { kind: "native", turnId: "turn", itemId: "item" } as const;
  const legacy = { kind: "legacy", path: "/tmp/result.json" } as const;
  const result = withPassedBuild([fileEvidence, native, legacy]);
  result.evidence = [
    {
      checkId: "build",
      index: 0,
      state: "matched",
      resolvedPath: "/project/result.json",
      exitCode: null,
    },
    { checkId: "build", index: 1, state: "succeeded", resolvedPath: null, exitCode: 0 },
    { checkId: "build", index: 2, state: "unsupported", resolvedPath: null, exitCode: null },
  ];
  expect(deliveryGaps(result).map((gap) => gap.code)).toEqual([
    "passed-with-unconfirmed-evidence",
  ]);
  result.evidence[2] = { ...result.evidence[2], state: "matched" };
  result.evidence = result.evidence.map((entry) => ({
    ...entry,
    state: entry.index === 0 ? "succeeded" : "matched",
  }));
  expect(deliveryGaps(result).map((gap) => gap.code)).toEqual(["passed-with-unconfirmed-evidence"]);
});

it.each([
  ["empty", "all-passed-without-sources"],
  ["stale", "all-passed-with-stale-sources"],
  ["unverifiable", "all-passed-with-unverifiable-sources"],
] as const)("reports %s sources only when every recorded check declares a pass", (state, code) => {
  const result = allPassed();
  if (!result.report) throw new Error("Missing fixture report");
  if (state === "empty") result.report.sourceFiles = [];
  else result.source.state = state;
  expect(deliveryGaps(result)).toEqual([{ code, message: expect.any(String) }]);
  const first = result.report.checks[0];
  if (!first) throw new Error("Missing fixture check");
  first.declaredStatus = "blocked";
  expect(deliveryGaps(result)).toEqual([]);
});

it("keeps category, per-check and source gaps in stable order without returning an overall verdict", () => {
  const result = fixture([
    {
      id: "only-build",
      category: "build",
      title: "构建",
      declaredStatus: "passed",
      details: "",
      evidence: [],
    },
  ]);
  if (!result.report) throw new Error("Missing fixture report");
  result.report.sourceFiles = [];
  result.source.state = "unverifiable";
  expect(deliveryGaps(result).map((gap) => [gap.code, gap.checkId])).toEqual([
    ["missing-interaction-check", undefined],
    ["missing-visual-check", undefined],
    ["missing-review-check", undefined],
    ["passed-without-evidence", "only-build"],
    ["all-passed-without-sources", undefined],
  ]);
  expect(deliveryGaps(allPassed())).toEqual([]);
});
