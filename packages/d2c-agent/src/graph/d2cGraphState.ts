/** 区分 D2C Graph 的权威任务锚点与单次运行临时上下文。 */

import type { DesignInspection } from "../design-context/designInspection.js";
import type { DesignSource } from "../design-context/designSource.js";
import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { D2CTask } from "../d2cTask.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";
import type { ProjectContextAnalysis } from "../project-context/projectContextAnalysis.js";
import type { PlanningResult } from "../planning/planningResult.js";
import type { EvolvingPlanningResult } from "../planning/evolvingPlan.js";
import type { CodeGenerationOutcome } from "../code-generation/codePatch.js";

/** 只在一次 Graph 调用或暂停恢复过程中流转的节点上下文。 */
export interface D2CGraphExecutionState {
  designSource?: DesignSource;
  inspection?: DesignInspection;
  projectInspection?: ProjectInspection;
  componentCatalog?: ComponentCatalog;
  designSystemWarnings?: string[];
  projectContextAnalysis?: ProjectContextAnalysis;
  componentRecognition?: DesignComponentRecognition;
  plan?: PlanningResult;
  evolvingPlan?: EvolvingPlanningResult;
  codeGeneration?: CodeGenerationOutcome;
}

/** Graph Checkpoint 中的权威任务与可丢弃执行上下文。 */
export interface D2CGraphState {
  task?: D2CTask;
  execution?: D2CGraphExecutionState;
}

/** 创建命令边界允许持久化的最小 Graph 状态，并清除全部节点临时输出。 */
export function createPersistedD2CGraphState(task: D2CTask): D2CGraphState {
  return { task: structuredClone(task) };
}
