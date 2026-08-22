/** 验证 Artifact 清理 Worker 的截止时间计算、幂等启动和错误隔离。 */

import { describe, expect, it, vi } from "vitest";
import { ArtifactCleanupWorker } from "./artifactCleanupWorker.js";

describe("ArtifactCleanupWorker", () => {
  it("deletes discarded artifacts older than the configured retention", async () => {
    const deleteDiscardedBefore = vi.fn(async () => 2);
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore },
      retentionMs: 24 * 60 * 60_000,
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });

    await expect(worker.runOnce()).resolves.toBe(2);
    expect(deleteDiscardedBefore).toHaveBeenCalledWith(new Date("2026-08-17T12:00:00.000Z"));
  });

  it("reports startup cleanup failures without rejecting server startup", async () => {
    const failure = new Error("storage unavailable");
    const onError = vi.fn();
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore: async () => { throw failure; } },
      retentionMs: 1,
      onError,
    });

    await expect(worker.start()).resolves.toBeUndefined();
    worker.stop();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
