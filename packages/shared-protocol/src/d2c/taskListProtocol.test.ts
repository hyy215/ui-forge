/** 验证任务列表分页、分类与修改命令的公共协议边界。 */

import { describe, expect, it } from "vitest";
import {
  changeD2CTaskArchiveInputSchema,
  deleteD2CTaskInputSchema,
  deleteD2CTaskResultSchema,
  d2cTaskSummaryPageSchema,
  listD2CTasksInputSchema,
  renameD2CTaskInputSchema,
} from "./taskListProtocol.js";

const taskId = "11111111-1111-4111-8111-111111111111";

describe("task list protocol", () => {
  it("accepts a workspace-scoped paginated task summary", () => {
    expect(listD2CTasksInputSchema.parse({ projectPath: "/workspace", limit: 20 })).toEqual({
      projectPath: "/workspace",
      limit: 20,
    });
    expect(d2cTaskSummaryPageSchema.safeParse({
      items: [{
        taskId,
        displayName: "客户列表",
        status: "analysis_ready",
        revision: 3,
        stage: "planning",
        attention: "required",
        nextAction: "审阅并批准方案",
        updatedAt: "2026-08-28T00:00:00.000Z",
      }],
      nextCursor: null,
    }).success).toBe(true);
  });

  it("rejects oversized names and invalid pagination limits", () => {
    expect(listD2CTasksInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(renameD2CTaskInputSchema.safeParse({
      taskId,
      expectedRevision: 1,
      displayName: "x".repeat(121),
    }).success).toBe(false);
  });

  it("keeps archive commands revision-bound", () => {
    expect(changeD2CTaskArchiveInputSchema.safeParse({
      taskId,
      expectedRevision: 2,
      projectPath: "/workspace",
    }).success).toBe(true);
  });

  it("keeps permanent deletion revision-bound and returns no task snapshot", () => {
    expect(deleteD2CTaskInputSchema.safeParse({
      taskId,
      expectedRevision: 2,
      projectPath: "/workspace",
    }).success).toBe(true);
    expect(deleteD2CTaskResultSchema.parse({ taskId, deleted: true })).toEqual({
      taskId,
      deleted: true,
    });
  });
});
