/** 从原生历史概括已记录工作；不检查磁盘、不推断完成率或验收状态。 */
import type { NativeTurn } from "@ui-forge/shared-protocol";

/** 仅统计确定成功退出的命令和非空的已完成文件变更，按轮次与工具标识去重。 */
export function summarizeRecordedWork(turns: readonly NativeTurn[]): string {
  const items = new Map<string, NativeTurn["items"][number]>();
  for (const turn of turns) {
    for (const item of turn.items) items.set(JSON.stringify([turn.id, item.id]), item);
  }
  let commands = 0;
  let changes = 0;
  for (const item of items.values()) {
    if (item.type === "commandExecution" && item.status === "completed" && item.exitCode === 0)
      commands += 1;
    if (
      item.type === "fileChange" &&
      item.status === "completed" &&
      Array.isArray(item.changes) &&
      item.changes.length > 0
    )
      changes += 1;
  }
  return commands || changes
    ? `当前历史已记录：${commands} 条命令成功退出，${changes} 条已完成文件变更。记录不代表当前文件状态或验收通过，继续前仍需核对。`
    : "当前历史未记录成功退出的命令或已完成文件变更，不代表工作区没有改动。";
}
