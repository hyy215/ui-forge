/** 定义设计系统 Token 适配端口与内置 Ant Design 组件目录。 */

export { AntDesignMcpKnowledgeProvider } from "./antDesignMcpKnowledgeProvider.js";

export type StyleRepairLevel = "theme" | "business-component" | "layout" | "local";

export interface DesignSystemPlan {
  globalTokens: Record<string, string | number>;
  componentTokens: Record<string, Record<string, string | number>>;
  allowedRepairLevels: StyleRepairLevel[];
  unmappedTokens: string[];
}

export interface DesignSystemAdapter {
  resolve(tokens: Record<string, string | number>): Promise<DesignSystemPlan>;
}

/** 供 D2C 组合入口使用的目录条目结构，避免设计系统包依赖领域包。 */
export interface DesignSystemComponentCatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  implementation?: { packageName: string; exportName: string } | undefined;
}

/** 默认 Ant Design 组件目录，可由 Server 配置整体替换。 */
export const antDesignComponentCatalog: {
  components: DesignSystemComponentCatalogEntry[];
} = {
  components: [
    { id: "tabs", name: "Tabs", aliases: ["tab", "页签", "标签栏"], implementation: { packageName: "antd", exportName: "Tabs" } },
    { id: "table", name: "Table", aliases: ["表格", "数据表", "table"], implementation: { packageName: "antd", exportName: "Table" } },
    { id: "search-input", name: "Search Input", aliases: ["搜索", "search"], implementation: { packageName: "antd", exportName: "Input.Search" } },
    { id: "select", name: "Select", aliases: ["选择框", "下拉", "select"], implementation: { packageName: "antd", exportName: "Select" } },
    { id: "tree", name: "Tree", aliases: ["树", "树形", "文件树", "目录树"], implementation: { packageName: "antd", exportName: "Tree" } },
    { id: "navigation", name: "Navigation", aliases: ["导航", "菜单", "侧边栏", "sidebar", "navigation", "nav"], implementation: { packageName: "antd", exportName: "Menu" } },
  ],
};
