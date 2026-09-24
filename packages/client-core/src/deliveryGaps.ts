/** 从交付声明和现有核对结果提示证据缺口，不改写作者状态或作出执行决定。 */
import type { TaskDelivery } from "@ui-forge/shared-protocol";

/** 页面与 CLI 共用的证据缺口提示；没有提示不代表验收通过。 */
export interface DeliveryGap {
  /** 稳定的展示分类，不作为任务状态或验收结论。 */
  code:
    | "missing-build-check"
    | "missing-interaction-check"
    | "missing-visual-check"
    | "missing-review-check"
    | "passed-without-evidence"
    | "passed-with-unconfirmed-evidence"
    | "all-passed-without-sources"
    | "all-passed-with-stale-sources"
    | "all-passed-with-unverifiable-sources";
  /** 逐项提示关联原声明身份；分类或源码清单缺口没有检查项身份。 */
  checkId?: string;
  /** 仅说明现有材料不足，不要求执行不适用的检查或宣称独立验证失败。 */
  message: string;
}

const categories = [
  { category: "build", code: "missing-build-check", label: "构建" },
  { category: "interaction", code: "missing-interaction-check", label: "交互" },
  { category: "visual", code: "missing-visual-check", label: "视觉" },
  { category: "review", code: "missing-review-check", label: "审查" },
] as const;

/** 只读取已有交付事实；缺失报告交给原可用性提示，空数组不代表整体通过。 */
export function deliveryGaps(delivery: TaskDelivery): DeliveryGap[] {
  const report = delivery.report;
  if (delivery.availability !== "available" || !report) return [];
  const gaps: DeliveryGap[] = [];
  for (const { category, code, label } of categories) {
    if (!report.checks.some((check) => check.category === category)) {
      gaps.push({ code, message: `未记录${label}检查，不能据此确认已验证；不适用时可注明原因。` });
    }
  }
  for (const check of report.checks) {
    if (check.declaredStatus !== "passed") continue;
    if (check.evidence.length === 0) {
      gaps.push({
        code: "passed-without-evidence",
        checkId: check.id,
        message: `“${check.title}”声明通过，但未提供证据引用，现有记录不足以核对该结论。`,
      });
      continue;
    }
    const unconfirmed = check.evidence.some((evidence, index) => {
      const results = delivery.evidence.filter(
        (item) => item.checkId === check.id && item.index === index,
      );
      const expectedState = evidence.kind === "file" ? "matched" : "succeeded";
      return (
        results.length !== 1 ||
        evidence.kind === "legacy" ||
        results[0]?.state !== expectedState
      );
    });
    if (unconfirmed) {
      gaps.push({
        code: "passed-with-unconfirmed-evidence",
        checkId: check.id,
        message: `“${check.title}”声明通过，但有证据未核对成功，请查看对应证据状态；文件匹配或工具成功本身也不等于业务验收通过。`,
      });
    }
  }
  if (
    report.checks.length > 0 &&
    report.checks.every((check) => check.declaredStatus === "passed")
  ) {
    if (report.sourceFiles.length === 0) {
      gaps.push({
        code: "all-passed-without-sources",
        message: "所有已记录检查均声明通过，但未提供源码清单，无法核对这些声明关联的文件内容。",
      });
    } else if (delivery.source.state === "stale") {
      gaps.push({
        code: "all-passed-with-stale-sources",
        message:
          "所有已记录检查均声明通过，但所列源码已变化或缺失，请核对受影响的验证；原声明不代表当前代码已通过。",
      });
    } else if (delivery.source.state === "unverifiable") {
      gaps.push({
        code: "all-passed-with-unverifiable-sources",
        message:
          "所有已记录检查均声明通过，但源码清单无法完成核对，不能确认声明与当前所列文件一致。",
      });
    }
  }
  return gaps;
}
