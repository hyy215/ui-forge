/** 验证 Plan Reviewer 结构化结论和连续无改善停止策略。 */

import { describe, expect, it } from "vitest";
import { decidePlanReviewLoop, parsePlanReviewResult, type PlanReviewResult } from "./planReview.js";

describe("plan review", () => {
  it("rejects pass verdicts that still contain error issues", () => {
    expect(() => parsePlanReviewResult(review("pass", 90, "error"))).toThrow("存在 error");
  });

  it("passes explicit success and blocks explicit reviewer stops", () => {
    expect(decidePlanReviewLoop([review("pass", 95)])).toBe("pass");
    expect(decidePlanReviewLoop([review("blocked", 30, "error")])).toBe("blocked");
  });

  it("blocks after three consecutive revision results without score improvement", () => {
    expect(decidePlanReviewLoop([
      review("revise", 70, "error"),
      review("revise", 70, "error"),
      review("revise", 68, "error"),
    ])).toBe("blocked");
    expect(decidePlanReviewLoop([
      review("revise", 70, "error"),
      review("revise", 75, "warning"),
      review("revise", 75, "warning"),
    ])).toBe("revise");
  });
});

function review(
  verdict: PlanReviewResult["verdict"],
  score: number,
  severity: "error" | "warning" = "warning",
): PlanReviewResult {
  return {
    verdict,
    score,
    summary: "审核结论",
    issues: verdict === "pass" && severity === "warning" ? [] : [{
      severity,
      category: "step-quality",
      evidence: ["计划步骤"],
      problem: "步骤不够明确",
      recommendation: "补充验收条件",
    }],
  };
}
