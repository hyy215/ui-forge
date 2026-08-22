/** 定义设计来源适配器输出的平台无关节点结构证据。 */

/** 归一化设计节点类型，避免领域识别器依赖具体设计平台枚举。 */
export type DesignNodeKind = "container" | "text" | "vector" | "component" | "instance" | "unknown";

/** 描述节点在所属容器内的可选几何信息。 */
export interface DesignNodeBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** 保存组件识别所需的最小结构证据，不包含供应商原始载荷。 */
export interface DesignNodeEvidence {
  id: string;
  name: string;
  kind: DesignNodeKind;
  sourceComponentId?: string;
  text?: string;
  bounds?: DesignNodeBounds;
  children: DesignNodeEvidence[];
}

/** 汇总一个设计 Artifact 中可供确定性识别消费的根节点。 */
export interface DesignStructureEvidence {
  roots: DesignNodeEvidence[];
  truncated: boolean;
}
