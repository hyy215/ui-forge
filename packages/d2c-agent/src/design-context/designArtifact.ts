/** 定义设计来源原始数据的通用 Artifact 元数据、内容和写入端口。 */

import type { DesignRegion } from "./designContext.js";
import type { DesignSource } from "./designSource.js";
import type { DesignStructureEvidence } from "./designStructure.js";

/** 描述一段可按需读取的原始设计数据。 */
export interface DesignArtifactSection {
  id: string;
  label: string;
  data: unknown;
}

/** 保存标准化索引和供应商原始分段，避免把大对象放入任务状态。 */
export interface DesignArtifactContent {
  source: DesignSource;
  name: string;
  nodeCount: number;
  regions: DesignRegion[];
  tokens: Record<string, string | number>;
  structure?: DesignStructureEvidence;
  sections: DesignArtifactSection[];
}

/** D2C 权威状态中允许保存的轻量 Artifact 引用。 */
export interface DesignArtifactReference {
  artifactId: string;
  sectionCount: number;
  byteSize: number;
}

/** 由具体设计 Adapter 调用、由组合入口实现的 Artifact 写入端口。 */
export interface DesignArtifactWriter {
  write(content: DesignArtifactContent): Promise<DesignArtifactReference>;
}

/** 由 SVG Agent 的受限工具调用，按当前任务绑定读取设计 Artifact。 */
export interface DesignArtifactReader {
  read(artifactId: string): Promise<{
    content: DesignArtifactContent;
    reference: DesignArtifactReference;
  }>;
  readSection(artifactId: string, sectionIndex: number): Promise<DesignArtifactSection>;
}

/** 在任务状态提交前后维护 Artifact 的绑定与废弃生命周期。 */
export interface DesignArtifactLifecycle {
  attach(
    artifactId: string,
    owner: { taskId: string; workspaceId: string; revision: number },
  ): Promise<void>;
  supersede(artifactId: string): Promise<void>;
  abandon(artifactId: string): Promise<void>;
}

/** 清理不再被当前任务引用或始终未绑定的过期 Artifact 的领域端口。 */
export interface DesignArtifactGarbageCollector {
  deleteDiscardedBefore(cutoff: Date): Promise<number>;
}
