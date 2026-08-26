/** 定义代码生成阶段可读取的受控目标仓库文本快照端口。 */

import type { ProjectInspection } from "../project-context/projectInspection.js";

/** 单个计划文件或复用参考文件在生成前的确定性文本快照。 */
export interface ProjectCodeFileSnapshot {
  path: string;
  role: "planned" | "reference";
  status: "existing" | "missing";
  byteSize: number;
  sha256?: string;
  content?: string;
}

/** 代码生成模型唯一可见的目标仓库文件上下文。 */
export interface ProjectCodeContext {
  files: ProjectCodeFileSnapshot[];
  warnings: string[];
}

/** 隔离 D2C Graph 与目标仓库文件系统读取实现。 */
export interface ProjectCodeContextReader {
  /** 读取计划文件和受控参考文件，并为现有文本生成内容指纹。 */
  read(input: {
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    plannedPaths: readonly string[];
    referencePaths: readonly string[];
    signal?: AbortSignal;
  }): Promise<ProjectCodeContext>;
}
