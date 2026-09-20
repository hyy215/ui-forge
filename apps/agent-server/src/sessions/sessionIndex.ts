/** 保存 ui-forge 创建的会话身份和导航信息；执行历史留在 Codex。 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  taskHistoryEntrySchema,
  type TaskHistoryEntry,
  type TaskHistoryPage,
} from "@ui-forge/shared-protocol";

/** 单实例服务内串行、原子更新任务索引。 */
export class SessionIndex {
  private entries: TaskHistoryEntry[] = [];
  private writing: Promise<void> = Promise.resolve();
  /** 目录来自宿主配置，不能由 HTTP 请求指定。 */
  constructor(private readonly directory: string) {}
  /** 仅缺失索引可视为空；损坏或读取失败必须报告。 */
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.entries = z
        .array(taskHistoryEntrySchema)
        .parse(JSON.parse(await readFile(join(this.directory, "sessions.json"), "utf8")));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  /** 查找指定任务，拒绝访问不属于 ui-forge 索引的线程。 */
  get(taskId: string): TaskHistoryEntry {
    const entry = this.entries.find((value) => value.taskId === taskId);
    if (!entry) throw new Error("任务不存在；旧工作流任务需使用其 Codex 会话历史恢复。");
    return entry;
  }
  /** 返回按最近操作时间排序的轻量导航页。 */
  list(offset: number, projectPath?: string): TaskHistoryPage {
    const entries = this.entries
      .filter((entry) => !projectPath || entry.projectPath === projectPath)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      tasks: entries.slice(offset, offset + 30),
      nextOffset: entries.length > offset + 30 ? offset + 30 : null,
    };
  }
  /** 只有落盘成功才更新内存索引。 */
  put(entry: TaskHistoryEntry): Promise<void> {
    const operation = this.writing.then(async () => {
      const entries = [
        taskHistoryEntrySchema.parse(entry),
        ...this.entries.filter((value) => value.taskId !== entry.taskId),
      ];
      const temporary = join(this.directory, `.sessions-${randomUUID()}.json`);
      await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
      await rename(temporary, join(this.directory, "sessions.json"));
      this.entries = entries;
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
}
