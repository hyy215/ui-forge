/** 定义平台无关的设计组件候选、最终语义决策与提取端口。 */

import type { DesignStructureEvidence } from "../design-context/designStructure.js";
import type { ComponentCatalog, ComponentTypeId } from "./componentCatalog.js";

/** 描述规则层依据目录别名产生的非权威类型提示。 */
export interface ComponentTypeHint {
  typeId: ComponentTypeId;
  matchedAlias: string;
}

/** 描述视觉 Subagent 对候选给出的模型建议。 */
export interface VisualComponentSuggestion {
  suggestedTypeId?: ComponentTypeId;
  confidence: number;
  evidence: string[];
}

/** 描述单个候选从客观证据到主 Agent 最终判断的完整审计结果。 */
export interface RecognizedDesignComponent {
  id: string;
  name: string;
  sourceNodeIds: string[];
  instanceCount: number;
  evidence: string[];
  evidenceStrength: "explicit" | "structural" | "weak";
  typeHint?: ComponentTypeHint;
  visualSuggestion?: VisualComponentSuggestion;
  effectiveTypeId?: ComponentTypeId;
  resolvedBy?: "catalog" | "model" | "unresolved";
  resolutionReason?: string;
}

/** 汇总一次组件分析的确定性候选、歧义仲裁结果和降级信息。 */
export interface DesignComponentRecognition {
  status: "recognized" | "unavailable";
  components: RecognizedDesignComponent[];
  warnings: string[];
}

/** 隔离 Graph 节点与具体确定性规则实现。 */
export interface DesignComponentRecognizer {
  /** 从平台无关结构证据提取候选，并只附加可审计的目录提示。 */
  recognize(structure: DesignStructureEvidence, catalog: ComponentCatalog): DesignComponentRecognition;
}

/** 创建能够消费任务级版本化目录的候选提取器。 */
export type DesignComponentRecognizerFactory = () => DesignComponentRecognizer;
