/** 定义主 Plan Agent 可持久化的设计理解、复用决策和文件级审阅方案。 */

import type { DesignUnderstanding } from "../design-understanding/designUnderstanding.js";

/** 方案中一个有明确来源的组件选择。 */
export interface PlanningComponent {
  typeId: string;
  name: string;
  description: string;
}

/** 主 Agent 对一个设计组件采用何种实现来源与复用策略的最终判断。 */
export interface PlanningComponentDecision {
  candidateId: string;
  action: "reuse-directly" | "reuse-configured" | "reuse-with-wrapper" | "extend-existing" | "create-new" | "unresolved";
  source: "catalog" | "repository" | "new" | "unresolved";
  catalogComponentId?: string;
  repositoryComponentId?: string;
  reason: string;
  evidence: string[];
}

/** 描述方案预计对一个仓库文件产生的影响。 */
export interface PlanningFileImpact {
  path: string;
  action: "create" | "modify" | "delete";
  reason: string;
  affectedSymbols: string[];
  downstreamConsumers: string[];
  risk: "low" | "medium" | "high";
  evidence: string[];
}

/** 描述单个计划步骤内与同一目标紧密相关的文件操作。 */
export interface PlanningFileOperation {
  path: string;
  action: "create" | "modify" | "delete";
}

/** 方案中一个可独立验收的实施步骤。 */
export interface PlanningStep {
  id: string;
  kind: "initialize" | "layout" | "component" | "interaction" | "cross-cutting" | "validation";
  targetId: string;
  title: string;
  description: string;
  decision: "create" | "reuse" | "configure" | "wrap" | "extend" | "modify" | "validate";
  dependsOn: string[];
  files: PlanningFileOperation[];
  designElementIds?: string[];
  evidence: string[];
  acceptanceCriteria: string[];
  risks: string[];
}

/** 主 Agent 基于现有证据生成、但不能直接触发写入的审阅型方案。 */
export interface PlanningResult {
  status: "reviewable" | "blocked";
  summary: string;
  designUnderstanding: DesignUnderstanding;
  reusableComponents: PlanningComponent[];
  newComponents: PlanningComponent[];
  componentDecisions: PlanningComponentDecision[];
  fileImpacts: PlanningFileImpact[];
  steps: PlanningStep[];
  files: string[];
  contextGaps: string[];
  stopConditions: string[];
}
