/** 定义 D2C 工作流消费的版本化设计系统知识端口与审计证据。 */

import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";

/** Ant Design MCP 当前允许规划阶段查询的只读知识类别。 */
export type DesignSystemKnowledgeSection = "info" | "semantic" | "token" | "demo";

/** 描述一次由设计系统 Adapter 返回的只读工具证据。 */
export interface DesignSystemKnowledgeRecord {
  toolName: string;
  componentName: string;
  data: unknown;
}

/** 汇总版本化组件目录解析结果以及显式降级警告。 */
export interface DesignSystemCatalogResolution {
  catalog: ComponentCatalog;
  warnings: string[];
}

/** 隔离 D2C Graph 与 Ant Design MCP、stdio 和具体 SDK。 */
export interface DesignSystemKnowledgeProvider {
  /** 根据目标项目版本扩充人工目录；失败时返回带警告的安全目录。 */
  resolveCatalog(input: {
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    baseCatalog: ComponentCatalog;
    signal?: AbortSignal;
  }): Promise<DesignSystemCatalogResolution>;

  /** 查询单个目录实现对应的官方组件知识。 */
  queryComponent(input: {
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    componentName: string;
    sections: readonly DesignSystemKnowledgeSection[];
    signal?: AbortSignal;
  }): Promise<DesignSystemKnowledgeRecord[]>;
}
