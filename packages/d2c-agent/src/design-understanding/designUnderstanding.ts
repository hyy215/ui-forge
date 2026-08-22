/** 定义视觉 Subagent 对页面布局和静态交互线索的可审计理解结果。 */

/** 描述页面中一个具有布局语义的视觉区域。 */
export interface DesignLayoutRegion {
  id: string;
  sourceNodeIds: string[];
  name: string;
  role: string;
  relationship: string;
  parentRegionId?: string;
  direction?: "row" | "column" | "overlay" | "unknown";
  bounds?: { x: number; y: number; width: number; height: number };
  evidence: string[];
}

/** 汇总结构数据和图片共同支持的页面布局结论。 */
export interface DesignLayoutUnderstanding {
  summary: string;
  regions: DesignLayoutRegion[];
  evidence: string[];
  warnings: string[];
}

/** 描述静态设计中可观察但未必由原型数据确认的交互候选。 */
export interface DesignInteractionCandidate {
  id: string;
  triggerNodeIds: string[];
  trigger: "click" | "change" | "submit" | "hover";
  expectedEffect: string;
  confidence: number;
  evidence: string[];
  status: "inferred" | "unresolved";
}

/** 描述设计图中必须被计划覆盖的可见元素、文本和静态状态。 */
export interface DesignVisualElement {
  id: string;
  sourceNodeIds: string[];
  regionId: string;
  kind: "text" | "input" | "select" | "button" | "icon" | "tree" | "table" | "tabs" | "feedback" | "other";
  name: string;
  text?: string;
  textStatus: "exact" | "uncertain" | "none";
  states: Array<"selected" | "active" | "expanded" | "collapsed" | "warning" | "error" | "disabled" | "default">;
  implementation: "required" | "reference-only";
  componentCandidateId?: string;
  evidence: string[];
}

/** 汇总视觉 Subagent 可供主规划 Agent 使用的非组件设计理解。 */
export interface DesignUnderstanding {
  layout: DesignLayoutUnderstanding;
  interactions: DesignInteractionCandidate[];
  elements?: DesignVisualElement[];
}
