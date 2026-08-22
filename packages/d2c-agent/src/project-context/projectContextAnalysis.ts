/** 定义主规划阶段可消费的受控目标仓库结构、组件候选和依赖证据。 */

import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { ProjectInspection } from "./projectInspection.js";

/** 描述仓库中一个可被复用判断引用的组件实现。 */
export interface RepositoryComponentEvidence {
  id: string;
  name: string;
  sourcePath: string;
  exportName: string;
  props: string[];
  composition: string[];
  styleFiles: string[];
  tokens: string[];
  consumers: string[];
}

/** 描述一个设计候选与仓库组件之间的确定性检索结果。 */
export interface RepositoryComponentMatch {
  designCandidateId: string;
  component: RepositoryComponentEvidence;
  score: number;
  matchedBy: Array<"name" | "keyword" | "composition">;
}

/** 汇总一次有界仓库扫描可安全交给规划模型的证据。 */
export interface ProjectContextAnalysis {
  kind: "empty" | "react_antd";
  files: string[];
  filesComplete: boolean;
  matches: RepositoryComponentMatch[];
  warnings: string[];
}

/** 隔离 D2C Graph 与具体文件系统、AST 和索引实现。 */
export interface ProjectContextAnalyzer {
  /** 根据已通过门禁的项目和设计候选返回有界仓库证据。 */
  analyze(input: {
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    recognition: DesignComponentRecognition;
    signal?: AbortSignal;
  }): Promise<ProjectContextAnalysis>;
}
