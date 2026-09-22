/** 独立保存规则指纹、运行时摘要和最后累计 Token 观测；读写失败不参与任务执行决策。 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  diagnosticAgentSummarySchema,
  diagnosticRuntimeSchema,
  diagnosticTokenUsageSchema,
  ruleFingerprintsSchema,
  type DiagnosticTokenUsage,
  type DiagnosticAgentSummary,
  type DiagnosticRuntime,
  type DiagnosticWarning,
  type RuleFingerprints,
} from "@ui-forge/shared-protocol";

const metadataSchema = z.strictObject({
  version: z.literal(2),
  ruleFingerprints: ruleFingerprintsSchema.nullable(),
  tokenUsage: diagnosticTokenUsageSchema.nullable(),
  runtime: diagnosticRuntimeSchema.nullable(),
  agents: z.array(diagnosticAgentSummarySchema),
});
type Metadata = z.infer<typeof metadataSchema>;
const legacyMetadataSchema = z.strictObject({
  version: z.literal(1),
  ruleFingerprints: ruleFingerprintsSchema.nullable(),
  tokenUsage: diagnosticTokenUsageSchema.nullable(),
});
type Stored = { value: Metadata; warnings: Set<DiagnosticWarning> };

/** 诊断读取只返回白名单元数据和固定错误类别，不携带文件系统错误正文。 */
export interface DiagnosticMetadata {
  /** 新任务实际使用的规则；旧任务保持未知。 */
  ruleFingerprints: RuleFingerprints | null;
  /** 当前主线程最后观测的累计量，不能与历史快照重复求和。 */
  tokenUsage: DiagnosticTokenUsage | null;
  /** Codex 进程及并发观测；历史任务缺少时保持未知。 */
  runtime: DiagnosticRuntime | null;
  /** 主线程及其子代理的脱敏运行摘要。 */
  agents: DiagnosticAgentSummary[];
  /** 仅反映诊断数据缺口，不改变原生任务状态。 */
  warnings: DiagnosticWarning[];
}

/** 原子串行写入独立元数据；任务身份和执行历史仍由原有索引与 Codex 维护。 */
export class DiagnosticMetadataStore {
  private readonly loaded = new Map<string, Promise<Stored>>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly directory: string;

  /** 宿主指定运行目录，客户端不能提交元数据路径。 */
  constructor(directory: string) {
    this.directory = join(directory, "diagnostics");
  }

  /** 只为创建时的确切规则保存指纹，不覆盖已有任务的规则元数据。 */
  recordRules(taskId: string, fingerprints: unknown): Promise<void> {
    return this.update(taskId, (stored) => {
      const parsed = ruleFingerprintsSchema.safeParse(fingerprints);
      if (!parsed.success || stored.value.ruleFingerprints) return false;
      stored.value.ruleFingerprints = parsed.data;
      return true;
    });
  }

  /** 更新最后一次累计观测；不相加，不保存模型输入或输出。 */
  recordTokenUsage(taskId: string, usage: DiagnosticTokenUsage): Promise<void> {
    return this.update(taskId, (stored) => {
      const parsed = diagnosticTokenUsageSchema.safeParse(usage);
      if (!parsed.success) return false;
      stored.value.tokenUsage = parsed.data;
      return true;
    });
  }

  /** 保存当前进程运行时摘要；未知字段不覆盖已有观测。 */
  recordRuntime(taskId: string, runtime: DiagnosticRuntime): Promise<void> {
    return this.update(taskId, (stored) => {
      const parsed = diagnosticRuntimeSchema.safeParse(runtime);
      if (!parsed.success) return false;
      const previous = stored.value.runtime;
      stored.value.runtime = previous
        ? diagnosticRuntimeSchema.parse({
            ...previous,
            ...Object.fromEntries(
              Object.entries(parsed.data).map(([key, value]) => [
                key,
                value === null ? previous[key as keyof DiagnosticRuntime] : value,
              ]),
            ),
          })
        : parsed.data;
      return true;
    });
  }

  /** 按线程身份更新主线程或子代理摘要，不保存提示词、工具正文和异常正文。 */
  recordAgent(taskId: string, agent: DiagnosticAgentSummary): Promise<void> {
    return this.update(taskId, (stored) => {
      const parsed = diagnosticAgentSummarySchema.safeParse(agent);
      if (!parsed.success) return false;
      const index = stored.value.agents.findIndex((item) => item.threadId === parsed.data.threadId);
      if (index < 0) stored.value.agents.push(parsed.data);
      else stored.value.agents[index] = parsed.data;
      return true;
    });
  }

  /** 更新当前和历史峰值并保留配置并发上限。 */
  recordConcurrency(taskId: string, current: number): Promise<void> {
    return this.update(taskId, (stored) => {
      const parsed = z.number().int().nonnegative().safeParse(current);
      if (!parsed.success) return false;
      const previous = stored.value.runtime;
      if (!previous) return false;
      const peak = Math.max(previous.peakConcurrency ?? 0, parsed.data);
      stored.value.runtime = diagnosticRuntimeSchema.parse({
        ...previous,
        currentConcurrency: parsed.data,
        peakConcurrency: peak,
      });
      return true;
    });
  }

  /** 等待本任务已排队的写入后读取；缺失文件只表示没有观测过。 */
  async read(taskId: string): Promise<DiagnosticMetadata> {
    await this.pending.get(taskId);
    const stored = await this.load(taskId);
    return structuredClone({
      ruleFingerprints: stored.value.ruleFingerprints,
      tokenUsage: stored.value.tokenUsage,
      runtime: stored.value.runtime,
      agents: structuredClone(stored.value.agents),
      warnings: [...stored.warnings],
    });
  }

  /** 关闭原生连接后等待最后的元数据写入，不抛出持久化错误。 */
  async flush(): Promise<void> {
    await Promise.all(this.pending.values());
  }

  /** 标识只参与散列，永远不能成为请求控制的文件路径。 */
  private path(taskId: string): string {
    return join(this.directory, `${createHash("sha256").update(taskId).digest("hex")}.json`);
  }

  /** 合并并发加载，只有文件不存在可当作没有历史元数据。 */
  private load(taskId: string): Promise<Stored> {
    let loading = this.loaded.get(taskId);
    if (!loading) {
      loading = (async () => {
        const stored: Stored = {
          value: {
            version: 2,
            ruleFingerprints: null,
            tokenUsage: null,
            runtime: null,
            agents: [],
          },
          warnings: new Set(),
        };
        try {
          const raw: unknown = JSON.parse(await readFile(this.path(taskId), "utf8"));
          const current = metadataSchema.safeParse(raw);
          if (current.success) stored.value = current.data;
          else {
            const legacy = legacyMetadataSchema.safeParse(raw);
            if (legacy.success)
              stored.value = {
                version: 2,
                ruleFingerprints: legacy.data.ruleFingerprints,
                tokenUsage: legacy.data.tokenUsage,
                runtime: null,
                agents: [],
              };
            else throw new Error("invalid diagnostic metadata");
          }
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            stored.warnings.add("metadataReadFailed");
        }
        return stored;
      })();
      this.loaded.set(taskId, loading);
    }
    return loading;
  }

  /** 每个任务串行变更并原子替换文件，IO 错误只进入诊断警告。 */
  private update(taskId: string, change: (stored: Stored) => boolean): Promise<void> {
    const operation = (this.pending.get(taskId) ?? Promise.resolve()).then(async () => {
      const stored = await this.load(taskId);
      if (!change(stored)) return;
      // 无法读取的已有文件不覆盖；内存中的新观测仍可供本次诊断使用。
      if (stored.warnings.has("metadataReadFailed")) {
        stored.warnings.add("metadataWriteFailed");
        return;
      }
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `.metadata-${randomUUID()}.json`);
        await writeFile(temporary, JSON.stringify(metadataSchema.parse(stored.value)), {
          mode: 0o600,
        });
        await rename(temporary, this.path(taskId));
        stored.warnings.delete("metadataWriteFailed");
      } catch {
        stored.warnings.add("metadataWriteFailed");
      }
    });
    this.pending.set(taskId, operation);
    void operation.finally(() => {
      if (this.pending.get(taskId) === operation) this.pending.delete(taskId);
    });
    return operation;
  }
}
