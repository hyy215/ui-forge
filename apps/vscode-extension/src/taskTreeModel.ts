/** 将 Workspace 任务摘要确定性分类为 VS Code 侧边栏分组。 */

import type { D2CTaskSummary } from "@ui-forge/shared-protocol";

/** 侧边栏稳定分组标识。 */
export type TaskTreeGroupId = "required" | "resumable" | "completed" | "archived";

/** 一个包含相同用户处理语义的任务分组。 */
export interface TaskTreeGroup {
  id: TaskTreeGroupId;
  label: string;
  tasks: D2CTaskSummary[];
}

const groupLabels: Record<TaskTreeGroupId, string> = {
  required: "待你处理",
  resumable: "可继续",
  completed: "已完成",
  archived: "已归档",
};

/** 按归档状态和用户注意力分类，并省略空分组。 */
export function groupTaskSummaries(tasks: readonly D2CTaskSummary[]): TaskTreeGroup[] {
  const groups = new Map<TaskTreeGroupId, D2CTaskSummary[]>([
    ["required", []],
    ["resumable", []],
    ["completed", []],
    ["archived", []],
  ]);
  for (const task of tasks) {
    const groupId: TaskTreeGroupId = task.archivedAt ? "archived" : task.attention;
    groups.get(groupId)?.push(task);
  }
  return [...groups].flatMap(([id, groupedTasks]) => groupedTasks.length > 0
    ? [{ id, label: groupLabels[id], tasks: groupedTasks }]
    : []);
}
