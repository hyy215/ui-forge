/** 暴露目标项目识别以及后续组件索引所需的公共能力。 */

export { FileSystemProjectInspector } from "./project-inspection/fileSystemProjectInspector.js";
export { FileSystemProjectContextAnalyzer } from "./project-analysis/fileSystemProjectContextAnalyzer.js";
export { FileSystemProjectCodeContextReader } from "./project-code/fileSystemProjectCodeContextReader.js";

/** 描述可被规划流程检索和复用的目标项目组件。 */
export interface ComponentRecord {
  id: string;
  name: string;
  importPath: string;
  description?: string;
  designAliases: string[];
  examples: Array<{ title: string; code: string; sourcePath: string }>;
  updatedAt: string;
}

/** 表示组件检索得到的候选记录、相关度和匹配依据。 */
export interface ComponentSearchResult {
  record: ComponentRecord;
  score: number;
  matchedBy: Array<"exact" | "keyword" | "vector">;
}

/** 为规划能力提供受控的目标项目组件检索端口。 */
export interface ComponentIndex {
  /** 按查询文本返回不超过指定数量的相关组件。 */
  search(query: string, topK: number): Promise<ComponentSearchResult[]>;
}
