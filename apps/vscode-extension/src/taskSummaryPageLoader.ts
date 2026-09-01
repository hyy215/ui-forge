/** 分页读取 Workspace 任务摘要，并允许宿主在刷新或切换项目后丢弃过期请求。 */

import type { D2CTaskSummary } from "@ui-forge/shared-protocol";
import type { UiForgeTaskClient } from "./UiForgeServerTaskClient.js";

const maximumTaskPages = 100;

/**
 * 读取全部任务摘要；当调用方 generation 已失效时停止翻页且不返回旧结果。
 */
export async function loadTaskSummaryPages(
  taskClient: Pick<UiForgeTaskClient, "listTasks">,
  isCurrent: () => boolean,
): Promise<D2CTaskSummary[] | undefined> {
  const tasks: D2CTaskSummary[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maximumTaskPages; pageNumber += 1) {
    if (!isCurrent()) return undefined;
    const page = await taskClient.listTasks({
      includeArchived: true,
      ...(cursor ? { cursor } : {}),
    });
    if (!isCurrent()) return undefined;
    tasks.push(...page.items);
    if (!page.nextCursor) return tasks;
    cursor = page.nextCursor;
  }
  throw new Error("任务数量过多，请缩小 Workspace 范围。");
}
