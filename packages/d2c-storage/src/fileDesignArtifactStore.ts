/** 提供独立于 Agent Server 的持久化设计 Artifact 文件存储适配器。 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { z } from "zod";

const maxArtifactBytes = 25 * 1024 * 1024;
const artifactIdSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime({ offset: true });
const designRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
const designNodeBoundsSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
});
interface StoredDesignNodeEvidence {
  id: string;
  name: string;
  kind: D2CAgent.DesignNodeKind;
  sourceComponentId?: string | undefined;
  text?: string | undefined;
  bounds?: {
    x?: number | undefined;
    y?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
  } | undefined;
  children: StoredDesignNodeEvidence[];
}
const designNodeEvidenceSchema: z.ZodType<StoredDesignNodeEvidence> = z.lazy(() => z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["container", "text", "vector", "component", "instance", "unknown"]),
  sourceComponentId: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  bounds: designNodeBoundsSchema.optional(),
  children: z.array(designNodeEvidenceSchema),
}));
const designStructureEvidenceSchema = z.object({
  roots: z.array(designNodeEvidenceSchema),
  truncated: z.boolean(),
});
const storedArtifactSchema = z.object({
  reference: z.object({
    artifactId: artifactIdSchema,
    sectionCount: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative(),
  }),
  content: z.object({
    source: z.object({ provider: z.string(), reference: z.string() }),
    name: z.string(),
    nodeCount: z.number().int().nonnegative(),
    regions: z.array(designRegionSchema),
    tokens: z.record(z.string(), z.union([z.string(), z.number()])),
    structure: designStructureEvidenceSchema.optional(),
    sections: z.array(z.object({ id: z.string(), label: z.string(), data: z.unknown() })),
  }),
  lifecycle: z.object({
    status: z.enum(["pending", "attached", "superseded", "abandoned"]),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    taskId: artifactIdSchema.optional(),
    workspaceId: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
  }),
});

type StoredArtifact = z.infer<typeof storedArtifactSchema>;

/** 暴露给清理协调器和测试的 Artifact 生命周期摘要。 */
export interface DesignArtifactLifecycleMetadata {
  status: "pending" | "attached" | "superseded" | "abandoned";
  createdAt: string;
  updatedAt: string;
  taskId?: string | undefined;
  workspaceId?: string | undefined;
  revision?: number | undefined;
}

/** 配置文件 Artifact Store 的可重复时间来源。 */
export interface FileDesignArtifactStoreOptions {
  now?: () => Date;
}

/** 使用受控 UUID 文件名原子保存并恢复设计原始数据。 */
export class FileDesignArtifactStore implements
  D2CAgent.DesignArtifactWriter,
  D2CAgent.DesignArtifactReader,
  D2CAgent.DesignArtifactLifecycle,
  D2CAgent.DesignArtifactGarbageCollector {
  private readonly rootDirectory: string;
  private readonly now: () => Date;
  private readonly lifecycleLocks = new Map<string, Promise<void>>();

  /** 创建固定根目录的 Artifact Store，不接受客户端提供存储路径。 */
  constructor(rootDirectory: string, options: FileDesignArtifactStoreOptions = {}) {
    this.rootDirectory = resolve(rootDirectory);
    this.now = options.now ?? (() => new Date());
  }

  /** 原子保存不超过 25 MB 的 JSON Artifact，并返回轻量引用。 */
  async write(content: D2CAgent.DesignArtifactContent): Promise<D2CAgent.DesignArtifactReference> {
    const artifactId = randomUUID();
    const serializedContent = serializeJson(content);
    const byteSize = Buffer.byteLength(serializedContent, "utf8");
    if (byteSize > maxArtifactBytes) throw new Error("设计原始数据超过 25 MB Artifact 上限。");
    const reference = { artifactId, sectionCount: content.sections.length, byteSize };
    const timestamp = this.now().toISOString();
    const artifact = {
      content,
      reference,
      lifecycle: { status: "pending", createdAt: timestamp, updatedAt: timestamp },
    } satisfies StoredArtifact;
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const destination = this.artifactPath(artifactId);
    await this.writeAtomically(destination, artifact);
    return reference;
  }

  /** 读取并校验完整 Artifact，防止损坏文件污染任务或模型输入。 */
  async read(artifactId: string): Promise<{
    content: D2CAgent.DesignArtifactContent;
    reference: D2CAgent.DesignArtifactReference;
  }> {
    const value = await this.readStoredArtifact(artifactId);
    return toDesignArtifact(value);
  }

  /** 读取不包含 Artifact 正文的生命周期元数据。 */
  async readLifecycle(artifactId: string): Promise<DesignArtifactLifecycleMetadata> {
    return structuredClone((await this.readStoredArtifact(artifactId)).lifecycle);
  }

  /** 在任务 checkpoint 提交前把 pending Artifact 绑定到确定的任务版本。 */
  async attach(
    artifactId: string,
    owner: { taskId: string; workspaceId: string; revision: number },
  ): Promise<void> {
    const taskId = artifactIdSchema.parse(owner.taskId);
    if (!Number.isInteger(owner.revision) || owner.revision < 0) {
      throw new Error("Artifact 绑定版本必须是非负整数。");
    }
    await this.updateLifecycle(artifactId, (current) => {
      if (current.status === "attached"
        && current.taskId === taskId
        && current.workspaceId === owner.workspaceId
        && current.revision === owner.revision) return current;
      if (current.status !== "pending") throw new Error("Artifact 当前状态不允许绑定任务。");
      return {
        ...current,
        status: "attached",
        taskId,
        workspaceId: owner.workspaceId,
        revision: owner.revision,
        updatedAt: this.now().toISOString(),
      };
    });
  }

  /** 将仍被历史 checkpoint 引用的旧 Artifact 标记为 superseded。 */
  async supersede(artifactId: string): Promise<void> {
    await this.updateLifecycle(artifactId, (current) => {
      if (current.status === "superseded") return current;
      if (current.status !== "attached") throw new Error("只有已绑定 Artifact 可以标记为历史版本。");
      return { ...current, status: "superseded", updatedAt: this.now().toISOString() };
    });
  }

  /** 标记未能进入权威任务状态的新 Artifact，允许短期 GC。 */
  async abandon(artifactId: string): Promise<void> {
    await this.updateLifecycle(artifactId, (current) => {
      if (current.status === "abandoned") return current;
      if (current.status !== "pending" && current.status !== "attached") {
        throw new Error("Artifact 当前状态不允许放弃。");
      }
      return { ...current, status: "abandoned", updatedAt: this.now().toISOString() };
    });
  }

  /** 按索引读取一个隔离的原始设计分段。 */
  async readSection(
    artifactId: string,
    sectionIndex: number,
  ): Promise<D2CAgent.DesignArtifactSection> {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
      throw new Error(`设计数据 Section 不存在：${sectionIndex}`);
    }
    const artifact = await this.read(artifactId);
    const section = artifact.content.sections[sectionIndex];
    if (!section) throw new Error(`设计数据 Section 不存在：${sectionIndex}`);
    return structuredClone(section);
  }

  /** 幂等删除不再被权威任务引用的 Artifact 文件。 */
  private async delete(artifactId: string): Promise<void> {
    const parsedId = artifactIdSchema.parse(artifactId);
    await rm(this.artifactPath(parsedId), { force: true });
  }

  /** 清理超过截止时间仍未绑定、已放弃或已被新版本替代的 Artifact。 */
  async deleteDiscardedBefore(cutoff: Date): Promise<number> {
    const cutoffTime = cutoff.getTime();
    if (!Number.isFinite(cutoffTime)) throw new Error("Artifact GC 截止时间无效。");
    let deleted = 0;
    for (const artifactId of await this.listArtifactIds()) {
      await this.withLifecycleLock(artifactId, async () => {
        try {
          const artifact = await this.readStoredArtifact(artifactId);
          const { lifecycle } = artifact;
          if (lifecycle.status === "attached") return;
          if (Date.parse(lifecycle.updatedAt) > cutoffTime) return;
          await this.delete(artifactId);
          deleted += 1;
        } catch {
          // GC 跳过损坏或并发移除的文件，正常读取路径会给出明确错误。
        }
      });
    }
    return deleted;
  }

  /** 将已校验 UUID 映射为固定根目录下的单个 JSON 文件。 */
  private artifactPath(artifactId: string): string {
    return join(this.rootDirectory, `${artifactId}.json`);
  }

  /** 读取并校验存储信封，拒绝符号链接、损坏内容和文件名不匹配。 */
  private async readStoredArtifact(artifactId: string): Promise<StoredArtifact> {
    const parsedId = artifactIdSchema.parse(artifactId);
    let serialized: string;
    try {
      const handle = await open(
        this.artifactPath(parsedId),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        serialized = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      throw new Error("设计数据 Artifact 不存在或已失效。");
    }
    let value: StoredArtifact;
    try {
      value = storedArtifactSchema.parse(JSON.parse(serialized));
    } catch {
      throw new Error("设计数据 Artifact 已损坏或格式无效。");
    }
    if (value.reference.artifactId !== parsedId) throw new Error("设计数据 Artifact 标识不匹配。");
    return value;
  }

  /** 原子替换 Artifact 信封，正文保持不变且不会暴露半写文件。 */
  private async writeAtomically(destination: string, artifact: StoredArtifact): Promise<void> {
    const artifactId = artifact.reference.artifactId;
    const temporary = join(this.rootDirectory, `${artifactId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serializeJson(artifact), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, destination);
    } catch (error: unknown) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** 在不改变 Artifact 正文和引用的前提下原子更新生命周期。 */
  private async updateLifecycle(
    artifactId: string,
    transition: (current: DesignArtifactLifecycleMetadata) => DesignArtifactLifecycleMetadata,
  ): Promise<void> {
    const parsedId = artifactIdSchema.parse(artifactId);
    await this.withLifecycleLock(parsedId, async () => {
      const artifact = await this.readStoredArtifact(parsedId);
      const lifecycle = transition(structuredClone(artifact.lifecycle));
      await this.writeAtomically(this.artifactPath(artifact.reference.artifactId), {
        ...artifact,
        lifecycle,
      });
    });
  }

  /** 串行执行同一 Artifact 的生命周期迁移与清理判定，防止检查后状态被并发覆盖。 */
  private async withLifecycleLock<T>(artifactId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleLocks.get(artifactId) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    this.lifecycleLocks.set(artifactId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.lifecycleLocks.get(artifactId) === current) this.lifecycleLocks.delete(artifactId);
    }
  }

  /** 枚举固定根目录内符合 UUID 文件名约束的 Artifact。 */
  private async listArtifactIds(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.rootDirectory);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      if (!name.endsWith(".json")) return [];
      const parsed = artifactIdSchema.safeParse(name.slice(0, -5));
      return parsed.success ? [parsed.data] : [];
    });
  }
}

/** 将值序列化为 JSON，并拒绝无法表示的输入。 */
function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("设计 Artifact 包含不可序列化数据。");
  return serialized;
}

/** 将校验结果规范化为 exactOptionalPropertyTypes 兼容的 Core Artifact。 */
function toDesignArtifact(value: StoredArtifact): {
  content: D2CAgent.DesignArtifactContent;
  reference: D2CAgent.DesignArtifactReference;
} {
  return {
    reference: { ...value.reference },
    content: {
      source: { ...value.content.source },
      name: value.content.name,
      nodeCount: value.content.nodeCount,
      tokens: { ...value.content.tokens },
      regions: value.content.regions.map((region) => ({
        id: region.id,
        name: region.name,
        ...(region.role !== undefined ? { role: region.role } : {}),
        ...(region.x !== undefined ? { x: region.x } : {}),
        ...(region.y !== undefined ? { y: region.y } : {}),
        ...(region.width !== undefined ? { width: region.width } : {}),
        ...(region.height !== undefined ? { height: region.height } : {}),
      })),
      ...(value.content.structure ? {
        structure: {
          truncated: value.content.structure.truncated,
          roots: value.content.structure.roots.map(toDesignNodeEvidence),
        },
      } : {}),
      sections: value.content.sections.map((section) => structuredClone(section)),
    },
  };
}

/** 将存储 Schema 的可选字段规范化为领域结构证据。 */
function toDesignNodeEvidence(node: StoredDesignNodeEvidence): D2CAgent.DesignNodeEvidence {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    ...(node.sourceComponentId !== undefined ? { sourceComponentId: node.sourceComponentId } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.bounds ? {
      bounds: {
        ...(node.bounds.x !== undefined ? { x: node.bounds.x } : {}),
        ...(node.bounds.y !== undefined ? { y: node.bounds.y } : {}),
        ...(node.bounds.width !== undefined ? { width: node.bounds.width } : {}),
        ...(node.bounds.height !== undefined ? { height: node.bounds.height } : {}),
      },
    } : {}),
    children: node.children.map(toDesignNodeEvidence),
  };
}
