/** 验证 Artifact 清理 Worker 的截止时间、权威引用对账和错误隔离。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { describe, expect, it, vi } from "vitest";
import { ArtifactCleanupWorker } from "./artifactCleanupWorker.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const artifactId = "22222222-2222-4222-8222-222222222222";

const referencedTask: D2CAgent.Task = {
  taskId,
  workspaceId: "git:demo",
  revision: 3,
  status: "svg_ready",
  projectPath: "/workspace",
  taskGoal: "实现客户列表",
  inspectedDesign: {
    context: {
      source: { provider: "mastergo", reference: "design-1" },
      name: "客户列表",
      nodeCount: 1,
      tokens: {},
      regions: [],
      warnings: [],
    },
    provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
    artifact: { artifactId, sectionCount: 0, byteSize: 1 },
    durationMs: 1,
  },
};

describe("ArtifactCleanupWorker", () => {
  it("passes the configured cutoff and retains the current task artifact", async () => {
    const deleteDiscardedBefore = vi.fn(async (
      _cutoff: Date,
      isCurrentReference: Parameters<
        D2CAgent.DesignArtifactGarbageCollector["deleteDiscardedBefore"]
      >[1],
    ) => Number(!await isCurrentReference({
      artifactId,
      owner: { taskId, workspaceId: "git:demo", revision: 1 },
    })));
    const getTask = vi.fn(async () => referencedTask);
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore },
      service: { getTask },
      retentionMs: 24 * 60 * 60_000,
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });

    await expect(worker.runOnce()).resolves.toBe(0);
    expect(deleteDiscardedBefore).toHaveBeenCalledWith(
      new Date("2026-08-17T12:00:00.000Z"),
      expect.any(Function),
    );
    expect(getTask).toHaveBeenCalledWith(taskId);
  });

  it("marks an attached artifact as unreferenced when the task points elsewhere", async () => {
    const deleteDiscardedBefore = vi.fn(async (
      _cutoff: Date,
      isCurrentReference: Parameters<
        D2CAgent.DesignArtifactGarbageCollector["deleteDiscardedBefore"]
      >[1],
    ) => Number(!await isCurrentReference({
      artifactId,
      owner: { taskId, workspaceId: "git:demo", revision: 1 },
    })));
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore },
      service: {
        getTask: async () => ({
          ...referencedTask,
          inspectedDesign: {
            ...referencedTask.inspectedDesign!,
            artifact: {
              artifactId: "33333333-3333-4333-8333-333333333333",
              sectionCount: 0,
              byteSize: 1,
            },
          },
        }),
      },
      retentionMs: 1,
    });

    await expect(worker.runOnce()).resolves.toBe(1);
  });

  it("retains attached artifacts when the authoritative task query fails", async () => {
    const deleteDiscardedBefore = vi.fn(async (
      _cutoff: Date,
      isCurrentReference: Parameters<
        D2CAgent.DesignArtifactGarbageCollector["deleteDiscardedBefore"]
      >[1],
    ) => Number(!await isCurrentReference({
      artifactId,
      owner: { taskId, workspaceId: "git:demo", revision: 1 },
    })));
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore },
      service: { getTask: async () => { throw new Error("checkpoint unavailable"); } },
      retentionMs: 1,
    });

    await expect(worker.runOnce()).resolves.toBe(0);
  });

  it("reports startup cleanup failures without rejecting server startup", async () => {
    const failure = new Error("storage unavailable");
    const onError = vi.fn();
    const worker = new ArtifactCleanupWorker({
      store: { deleteDiscardedBefore: async () => { throw failure; } },
      service: { getTask: async () => referencedTask },
      retentionMs: 1,
      onError,
    });

    await expect(worker.start()).resolves.toBeUndefined();
    worker.stop();
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
