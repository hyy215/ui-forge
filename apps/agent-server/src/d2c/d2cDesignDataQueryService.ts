/** 按任务授权读取设计 Artifact，并投影为共享协议查询结果。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { DesignDataIndex, DesignDataSection } from "@ui-forge/shared-protocol";

/** 配置设计数据查询所需的权威任务 Service 与可选 Artifact Reader。 */
export interface D2CDesignDataQueryServiceOptions {
  service: Pick<D2CAgent.Service, "getTask">;
  designArtifactReader?: D2CAgent.DesignArtifactReader;
}

/** 负责 Artifact 所有权校验和客户端查询结构投影。 */
export class D2CDesignDataQueryService {
  private readonly service: Pick<D2CAgent.Service, "getTask">;
  private readonly designArtifactReader: D2CAgent.DesignArtifactReader | undefined;

  constructor(options: D2CDesignDataQueryServiceOptions) {
    this.service = options.service;
    this.designArtifactReader = options.designArtifactReader;
  }

  /** 返回不包含原始 Section 数据的 Artifact 索引。 */
  async getIndex(taskId: string, artifactId: string): Promise<DesignDataIndex> {
    await this.requireTaskArtifact(taskId, artifactId);
    const artifact = await this.requireArtifactReader().read(artifactId);
    return {
      artifactId,
      provider: artifact.content.source.provider,
      reference: artifact.content.source.reference,
      name: artifact.content.name,
      nodeCount: artifact.content.nodeCount,
      byteSize: artifact.reference.byteSize,
      regions: structuredClone(artifact.content.regions),
      tokens: structuredClone(artifact.content.tokens),
      sections: artifact.content.sections.map((section, index) => ({
        index,
        id: section.id,
        label: section.label,
        byteSize: jsonByteSize(section.data),
      })),
    };
  }

  /** 返回指定 Artifact 分段及其通信元数据。 */
  async getSection(
    taskId: string,
    artifactId: string,
    sectionIndex: number,
  ): Promise<DesignDataSection> {
    await this.requireTaskArtifact(taskId, artifactId);
    const section = await this.requireArtifactReader().readSection(artifactId, sectionIndex);
    return {
      artifactId,
      index: sectionIndex,
      id: section.id,
      label: section.label,
      byteSize: jsonByteSize(section.data),
      data: structuredClone(section.data),
    };
  }

  /** 确认请求任务实际拥有指定 Artifact，防止跨任务枚举设计数据。 */
  private async requireTaskArtifact(taskId: string, artifactId: string): Promise<void> {
    const task = await this.service.getTask(taskId);
    if (task.inspectedDesign?.artifact?.artifactId !== artifactId) {
      throw new Error("设计数据 Artifact 不属于当前任务或已失效。");
    }
  }

  /** 返回已配置的 Artifact Reader；未启用存储时拒绝数据读取。 */
  private requireArtifactReader(): D2CAgent.DesignArtifactReader {
    if (!this.designArtifactReader) throw new Error("设计数据 Artifact Store 未启用。");
    return this.designArtifactReader;
  }
}

/** 计算单个通信分段的 JSON UTF-8 字节数。 */
function jsonByteSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("设计 Artifact 包含不可序列化数据。");
  return Buffer.byteLength(serialized, "utf8");
}
