/** 定义独立 Plan Review Subagent 的结构化结论和确定性停止策略。 */

import { z } from "zod";
import type { EvolvingPlanningResult } from "./evolvingPlan.js";

/** 校验 Plan Review Subagent 只能返回可审计的结构化结论。 */
export const planReviewResultSchema = z.object({
  verdict: z.enum(["pass", "revise", "blocked"]),
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning"]),
    category: z.enum([
      "design-coverage",
      "component-selection",
      "interaction",
      "file-impact",
      "step-quality",
      "acceptance-criteria",
    ]),
    targetId: z.string().min(1).optional(),
    evidence: z.array(z.string().min(1)).min(1),
    problem: z.string().min(1),
    recommendation: z.string().min(1),
  })),
}).superRefine((review, context) => {
  const errors = review.issues.filter((issue) => issue.severity === "error");
  if (review.verdict === "pass" && errors.length > 0) {
    context.addIssue({ code: "custom", path: ["verdict"], message: "存在 error 时审核结论不能为 pass。" });
  }
});

/** 独立 Plan Review Subagent 的结构化结论。 */
export type PlanReviewResult = z.infer<typeof planReviewResultSchema>;

/** Plan 修订循环的确定性控制结论。 */
export type PlanReviewLoopDecision = "pass" | "revise" | "blocked";

/** Review Subagent 只能消费受控摘要，不直接读取仓库或改写 Plan。 */
export interface PlanReviewInput {
  plan: EvolvingPlanningResult;
  evidence: {
    design: string[];
    repository: string[];
    designSystem: string[];
  };
  previousReviews: PlanReviewResult[];
}

/** 隔离未来 Review Subagent 实现与确定性 Plan 领域逻辑。 */
export interface PlanReviewSubagent {
  /** 审核候选 Plan 并返回结构化结论，不得直接修改输入。 */
  review(input: PlanReviewInput): Promise<PlanReviewResult>;
}

/** 校验并复制未知审核输出。 */
export function parsePlanReviewResult(input: unknown): PlanReviewResult {
  return structuredClone(planReviewResultSchema.parse(input));
}

/** 最多允许三次无改善修订；通过、明确阻塞或连续无改善时停止。 */
export function decidePlanReviewLoop(
  reviews: readonly PlanReviewResult[],
  maximumNoImprovementRounds = 3,
): PlanReviewLoopDecision {
  if (!Number.isInteger(maximumNoImprovementRounds) || maximumNoImprovementRounds < 1) {
    throw new Error("无改善轮数上限必须是正整数。");
  }
  const latest = reviews.at(-1);
  if (!latest) return "revise";
  if (latest.verdict === "pass") return "pass";
  if (latest.verdict === "blocked") return "blocked";
  if (reviews.length < maximumNoImprovementRounds) return "revise";
  const recent = reviews.slice(-maximumNoImprovementRounds);
  const improved = recent.some((review, index) => index > 0 && review.score > recent[index - 1]!.score);
  return improved ? "revise" : "blocked";
}
