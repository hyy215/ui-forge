/** 定义设计来源 Resolver 与单个平台 Adapter 之间的领域端口。 */

import type { DesignInspection } from "./designInspection.js";
import type { DesignSource } from "./designSource.js";

/** 为确定性工作流节点提供按来源路由后的标准化设计读取能力。 */
export interface DesignContextResolver {
  inspect(source: DesignSource): Promise<DesignInspection>;
}

/** 约束单个设计平台 Adapter 的稳定标识和标准化读取能力。 */
export interface DesignSourceAdapter {
  readonly id: string;
  inspect(reference: string): Promise<DesignInspection>;
}
