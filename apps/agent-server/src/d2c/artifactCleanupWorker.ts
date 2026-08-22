/** 定期回收 D2C 流程未绑定、已放弃或已被替代的设计 Artifact。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";

/** 配置 Artifact 清理端口、保留时长、调度周期与可测试时间源。 */
export interface ArtifactCleanupWorkerOptions {
  store: D2CAgent.DesignArtifactGarbageCollector;
  retentionMs: number;
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

/** 在 Server 生命周期内按固定周期执行非当前 Artifact 清理。 */
export class ArtifactCleanupWorker {
  private readonly store: D2CAgent.DesignArtifactGarbageCollector;
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

  /** 根据当前时间和保留时长执行一次确定性清理。 */
  async runOnce(): Promise<number> {
    return this.store.deleteDiscardedBefore(new Date(this.now().getTime() - this.retentionMs));
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
