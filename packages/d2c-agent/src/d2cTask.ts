/** 定义设计读取、人工确认与方案分析流程的权威任务状态。 */

import type { DesignInspection } from "./design-context/designInspection.js";
import type { DesignSource } from "./design-context/designSource.js";
import type { DesignComponentRecognition } from "./design-components/designComponentRecognition.js";
import type { ProjectInspection } from "./project-context/projectInspection.js";
import type { PlanningResult } from "./planning/planningResult.js";
import type { EvolvingPlanningResult } from "./planning/evolvingPlan.js";
import type { CodeGenerationOutcome } from "./code-generation/codePatch.js";

/** 当前 D2C 工作流允许持久化的显式业务状态。 */
export type D2CTaskStatus =
  | "draft"
  | "svg_ready"
  | "design_confirmed"
  | "analysis_ready"
  | "patch_ready";

/** D2C Service 保存的当前权威任务。 */
export interface D2CTask {
  taskId: string;
  workspaceId: string;
  revision: number;
  status: D2CTaskStatus;
  projectPath: string;
  taskGoal: string;
  designSource?: DesignSource;
  inspectedDesign?: DesignInspection & { durationMs: number };
  projectInspection?: ProjectInspection;
  componentRecognition?: DesignComponentRecognition;
  plan?: PlanningResult;
  evolvingPlan?: EvolvingPlanningResult;
  codeGeneration?: CodeGenerationOutcome;
}
