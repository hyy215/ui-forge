/** 定义第二步节点内部可实时观察、但不写入 Checkpoint 的短生命周期进度事件。 */

import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { PlanningResult } from "../planning/planningResult.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";
import type { ProjectContextAnalysis } from "../project-context/projectContextAnalysis.js";

/** 多模态视觉复核的有界执行结果。 */
export type VisualReviewOutcome = "completed" | "not-submitted" | "unavailable";

/** 第二步确定性项目检查、组件候选生成和可选歧义仲裁进度。 */
export type SecondStepProgressEvent =
  | { type: "project-inspection-start" }
  | { type: "project-inspection-complete"; inspection: ProjectInspection; durationMs?: number }
  | { type: "design-system-catalog-start" }
  | {
      type: "design-system-catalog-complete";
      componentCount: number;
      warnings: string[];
      durationMs: number;
    }
  | { type: "component-recognition-start" }
  | {
      type: "component-recognition-complete";
      recognition: DesignComponentRecognition;
      unknownCount: number;
      durationMs?: number;
    }
  | { type: "project-context-analysis-start" }
  | { type: "project-context-analysis-complete"; analysis: ProjectContextAnalysis; durationMs?: number }
  | { type: "visual-review-start"; candidateCount: number }
  | { type: "design-system-query-start"; queryId: string; componentId: string; sections: string[] }
  | {
      type: "design-system-query-complete";
      queryId: string;
      componentId: string;
      outcome: "completed" | "failed";
      durationMs: number;
      message?: string;
    }
  | {
      type: "visual-review-complete";
      outcome: VisualReviewOutcome;
      durationMs: number;
      tokenUsage?: import("@ui-forge/agent-core").AgentCore.AgentTokenUsage;
    }
  | { type: "planning-start" }
  | {
      type: "planning-complete";
      recognition: DesignComponentRecognition;
      plan: PlanningResult;
      durationMs: number;
      tokenUsage?: import("@ui-forge/agent-core").AgentCore.AgentTokenUsage;
    };

/** 单次第二步运行使用的同步或异步进度接收器。 */
export type SecondStepProgressReporter = (
  event: SecondStepProgressEvent,
) => void | Promise<void>;
