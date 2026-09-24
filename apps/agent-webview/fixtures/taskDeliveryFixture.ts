/** 提供独立的交付展示样本；仅模拟声明与核对结果，不代表真实工程验收。 */
import { taskDeliverySchema, type TaskDelivery } from "@ui-forge/shared-protocol";

/** 默认缺少报告；显式场景覆盖有效、源码过期、证据缺口和无效报告。 */
export function createTaskDeliveryFixture(
  taskId: string,
  scenario = "delivery-missing",
): TaskDelivery {
  const checkedAt = "2026-09-23T08:00:00.000Z";
  const empty: TaskDelivery = {
    version: 1,
    taskId,
    checkedAt,
    availability: scenario === "delivery-invalid" ? "invalid" : "missing",
    issue: scenario === "delivery-invalid" ? "invalid-report" : null,
    report: null,
    reportSha256: null,
    source: { state: "unverifiable", manifestFingerprint: null, files: [] },
    evidence: [],
    history: "not-requested",
  };
  if (
    !["delivery", "delivery-stale", "delivery-missing-evidence", "delivery-gaps"].includes(scenario)
  )
    return taskDeliverySchema.parse(empty);
  const stale = scenario === "delivery-stale";
  const missingEvidence = scenario === "delivery-missing-evidence";
  const gaps = scenario === "delivery-gaps";
  const file = "evidence/interaction-validation-with-a-long-descriptive-file-name.md";
  return taskDeliverySchema.parse({
    ...empty,
    availability: "available",
    reportSha256: "a".repeat(64),
    report: {
      version: 1,
      taskId,
      generatedAt: "2026-09-23T07:00:00.000Z",
      summary: "开发样本：构建完成，但交互和视觉仍有未解决项。",
      sourceFiles: [{ path: "src/CustomerList.tsx", sha256: "b".repeat(64) }],
      checks: [
        {
          id: "build",
          category: "build",
          title: gaps ? "BuildVerificationEvidence".repeat(7) : "构建检查",
          declaredStatus: "passed",
          details: "报告声明构建通过。",
          evidence: gaps ? [] : [{ kind: "native", turnId: "turn-1", itemId: "cmd-1" }],
        },
        {
          id: "interaction",
          category: "interaction",
          title: "保存失败恢复",
          declaredStatus: "failed",
          details: "保存失败后编辑框关闭，草稿需要保留。",
          evidence: [{ kind: "file", path: file, sha256: "c".repeat(64) }],
        },
        {
          id: "visual",
          category: "visual",
          title: "严格视觉验收",
          declaredStatus: "blocked",
          details: "缺少同视口原始参考图。",
          evidence: [],
        },
        {
          id: "review",
          category: "review",
          title: "边界交互审查",
          declaredStatus: "not-verified",
          details: "尚未检查长文本和空数据。",
          evidence: [],
        },
      ].filter((check) => !gaps || check.category !== "review"),
    },
    source: {
      state: stale ? "stale" : "matches",
      manifestFingerprint: "d".repeat(64),
      files: [{ path: "src/CustomerList.tsx", state: stale ? "changed" : "matched" }],
    },
    evidence: [
      { checkId: "build", index: 0, state: "succeeded", resolvedPath: null, exitCode: 0 },
      {
        checkId: "interaction",
        index: 0,
        state: missingEvidence ? "missing" : "matched",
        resolvedPath: missingEvidence ? null : `/ui-forge/runtime/tmp/demo/main/${file}`,
        exitCode: null,
      },
    ].filter((evidence) => !gaps || evidence.checkId !== "build"),
    history: "available",
  });
}
