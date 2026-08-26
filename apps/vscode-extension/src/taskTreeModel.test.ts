/** 验证任务摘要按用户下一步和归档状态稳定分类。 */

import { describe, expect, it } from "vitest";
import type { D2CTaskSummary } from "@ui-forge/shared-protocol";
import { groupTaskSummaries } from "./taskTreeModel.js";

describe("groupTaskSummaries", () => {
  it("puts archived tasks in their own group regardless of prior attention", () => {
    const required = createTask("required", "1");
    const resumable = createTask("resumable", "2");
    const archived = { ...createTask("required", "3"), archivedAt: "2026-08-28T01:00:00.000Z" };

    expect(groupTaskSummaries([required, resumable, archived]).map((group) => ({
      id: group.id,
      taskIds: group.tasks.map((task) => task.taskId),
    }))).toEqual([
      { id: "required", taskIds: [required.taskId] },
      { id: "resumable", taskIds: [resumable.taskId] },
      { id: "archived", taskIds: [archived.taskId] },
    ]);
  });
});

/** 创建侧边栏分类测试所需的最小任务摘要。 */
function createTask(attention: D2CTaskSummary["attention"], suffix: string): D2CTaskSummary {
  return {
    taskId: `11111111-1111-4111-8111-11111111111${suffix}`,
    displayName: `任务 ${suffix}`,
    status: attention === "completed" ? "delivery_ready" : "draft",
    revision: 0,
    stage: "design",
    attention,
    nextAction: "继续",
    updatedAt: "2026-08-28T01:00:00.000Z",
  };
}
