/** 验证 Workspace 任务摘要分类、分页和阻塞信息投影。 */

import { describe, expect, it } from "vitest";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { D2CTaskListQueryService, toTaskSummary } from "./d2cTaskListQueryService.js";

const workspaceId = "git:demo";

describe("D2CTaskListQueryService", () => {
  it("classifies stable task statuses without a second persisted category", () => {
    expect(toTaskSummary(createTask("analysis_ready", "1"))).toMatchObject({
      stage: "planning",
      attention: "required",
      nextAction: "审阅并批准方案",
    });
    expect(toTaskSummary(createTask("patch_applied", "2"))).toMatchObject({
      stage: "validation",
      attention: "resumable",
      nextAction: "继续自动验收",
    });
  });

  it("uses a stable new-task fallback when legacy metadata has no display name", () => {
    expect(toTaskSummary({
      ...createTask("draft", "6"),
      displayName: " ",
    }).displayName).toBe("新任务");
  });

  it("surfaces blocked inner delivery outcomes even when the outer task status is resumable", () => {
    expect(toTaskSummary({
      ...createTask("plan_approved", "4"),
      codeGeneration: {
        status: "blocked",
        summary: "代码生成受阻。",
        reasons: ["计划文件已经变化"],
        warnings: [],
      },
    })).toMatchObject({
      stage: "delivery",
      attention: "required",
      nextAction: "处理生成问题后继续",
      blockingReason: "计划文件已经变化",
    });

    expect(toTaskSummary({
      ...createTask("patch_ready", "5"),
      patchApplication: {
        status: "blocked",
        patchSetHash: "a".repeat(64),
        summary: "文件应用受阻。",
        reasons: ["目标文件版本已变化"],
        manualActionRequired: true,
        blockedAt: "2026-08-28T00:00:00.000Z",
      },
    })).toMatchObject({
      stage: "delivery",
      attention: "required",
      nextAction: "处理文件问题后继续",
      blockingReason: "目标文件版本已变化",
    });
  });

  it("paginates already sorted authoritative workspace tasks", async () => {
    const tasks = [
      createTask("analysis_ready", "1", "2026-08-28T03:00:00.000Z"),
      createTask("design_confirmed", "2", "2026-08-28T02:00:00.000Z"),
      createTask("delivery_ready", "3", "2026-08-28T01:00:00.000Z"),
    ];
    const service = new D2CTaskListQueryService({
      service: { listTasks: async () => tasks },
    });

    const first = await service.list({ workspaceId, limit: 2 });
    expect(first.items.map((item) => item.taskId)).toEqual([
      tasks[0]!.taskId,
      tasks[1]!.taskId,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list({ workspaceId, limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.taskId)).toEqual([tasks[2]!.taskId]);
    expect(second.nextCursor).toBeNull();
  });
});

/** 创建任务摘要测试所需的最小领域任务。 */
function createTask(
  status: D2CAgent.TaskStatus,
  suffix: string,
  updatedAt = "2026-08-28T00:00:00.000Z",
): D2CAgent.Task {
  return {
    taskId: `11111111-1111-4111-8111-11111111111${suffix}`,
    workspaceId,
    revision: 1,
    status,
    projectPath: "/workspace",
    taskGoal: "生成页面",
    displayName: `任务 ${suffix}`,
    updatedAt,
  };
}
