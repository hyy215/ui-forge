/** 定义标准化设计读取结果及其可审计来源信息。 */

import type { DesignContext } from "./designContext.js";
import type { DesignArtifactReference } from "./designArtifact.js";

/** 记录一次设计读取实际使用的提供方、传输方式和操作。 */
export interface DesignProvenance {
  provider: string;
  transport: string;
  operations: string[];
}

/** 汇总标准化设计上下文及其可审计来源。 */
export interface DesignInspection {
  context: DesignContext;
  provenance: DesignProvenance;
  artifact?: DesignArtifactReference;
}
