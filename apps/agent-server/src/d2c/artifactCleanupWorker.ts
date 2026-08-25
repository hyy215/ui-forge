/** 定期回收过期且未被权威任务引用的设计 Artifact。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";

type ArtifactReferenceVerifier = Parameters<
  D2CAgent.DesignArtifactGarbageCollector["deleteDiscardedBefore"]
>[1];
type ArtifactReferenceCandidate = Parameters<ArtifactReferenceVerifier>[0];

/** 配置 Artifact 清理端口、任务查询、保留时长和可测试调度依赖。 */
export interface ArtifactCleanupWorkerOptions {
  store: D2CAgent.DesignArtifactGarbageCollector;
  service: Pick<D2CAgent.Service, "getTask">;
  retentionMs: number;
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

/** 在 Server 生命周期内对账当前任务引用并清理过期 Artifact。 */
export class ArtifactCleanupWorker {
  private readonly store: D2CAgent.DesignArtifactGarbageCollector;
  private readonly service: Pick<D2CAgent.Service, "getTask">;
  private readonly retentionMs: number;
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly onError: ((error: unknown) => void) | undefined;
  private timer: NodeJS.Timeout | undefined;

  /** 保存受控清理配置并拒绝无效时长。 */
  constructor(options: ArtifactCleanupWorkerOptions) {
    if (!Number.isFinite(options.retentionMs) || options.retentionMs < 0) {
      throw new Error("Artifact 保留时长必须是非负数值。");
    }
    const intervalMs = options.intervalMs ?? 60 * 60_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("Artifact 清理周期必须是正数值。");
    }
    this.store = options.store;
    this.service = options.service;
    this.retentionMs = options.retentionMs;
    this.intervalMs = intervalMs;
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError;
  }

  /** 立即清理一次，并启动不会阻止进程退出的后续定时任务。 */
  async start(): Promise<void> {
    if (this.timer) return;
    await this.runSafely();
    this.timer = setInterval(() => { void this.runSafely(); }, this.intervalMs);
    this.timer.unref();
  }

  /** 停止后续清理，不影响已经开始的单次存储操作。 */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 根据当前时间和保留时长执行一次带权威引用对账的清理。 */
  async runOnce(): Promise<number> {
    return this.store.deleteDiscardedBefore(
      new Date(this.now().getTime() - this.retentionMs),
      (candidate) => this.isCurrentReference(candidate),
    );
  }

  /** 判断 attached Artifact 是否仍由同一 Workspace 的当前任务引用。 */
  private async isCurrentReference(candidate: ArtifactReferenceCandidate): Promise<boolean> {
    try {
      const task = await this.service.getTask(candidate.owner.taskId);
      return task.workspaceId === candidate.owner.workspaceId
        && task.inspectedDesign?.artifact?.artifactId === candidate.artifactId;
    } catch {
      // Checkpointer 暂时不可用时保守保留，避免清理故障扩大为数据丢失。
      return true;
    }
  }

  /** 隔离周期清理错误，避免后台 Promise 影响 Server 生命周期。 */
  private async runSafely(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error: unknown) {
      this.onError?.(error);
    }
  }
}
