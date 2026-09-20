/** 原子创建锁目录，以实例专属记录安全接管失效锁，限制同一运行目录的 Server 数量。 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const ownerSchema = z.object({
  pid: z.number().int().positive(),
  instanceId: z.string().min(1),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});
type ServerLockOwner = z.infer<typeof ownerSchema>;

/** 配置单实例锁名称、时间源和可测试进程探测器。 */
export interface ServerInstanceLockOptions {
  lockName?: string;
  now?: () => Date;
  isProcessRunning?: (pid: number) => boolean;
}

/** 在一个共享运行目录内提供可恢复的单进程所有权。 */
export class ServerInstanceLock {
  private readonly rootDirectory: string;
  private readonly lockDirectory: string;
  private readonly now: () => Date;
  private readonly isProcessRunning: (pid: number) => boolean;
  private owner: ServerLockOwner | undefined;

  /** 保存固定运行目录；锁路径不接受通信客户端输入。 */
  constructor(rootDirectory: string, options: ServerInstanceLockOptions = {}) {
    this.rootDirectory = resolve(rootDirectory);
    this.lockDirectory = join(this.rootDirectory, options.lockName ?? "agent-server.lock");
    this.now = options.now ?? (() => new Date());
    this.isProcessRunning = options.isProcessRunning ?? isLocalProcessRunning;
  }

  /** 原子取得 Server 所有权；活动实例存在时拒绝启动，失效实例会被接管。 */
  async acquire(): Promise<void> {
    if (this.owner) return;
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const owner: ServerLockOwner = {
      pid: process.pid,
      instanceId: randomUUID(),
      createdAt: this.now().toISOString(),
    };
    const candidateDirectory = join(
      this.rootDirectory,
      `.agent-server-lock.${owner.instanceId}.candidate`,
    );
    await mkdir(candidateDirectory, { mode: 0o700 });
    let acquired = false;
    try {
      await writeFile(
        join(candidateDirectory, `owner.${owner.instanceId}.json`),
        JSON.stringify(owner),
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      for (;;) {
        try {
          await rename(candidateDirectory, this.lockDirectory);
          acquired = true;
          this.owner = owner;
          return;
        } catch (error: unknown) {
          if (!hasCode(error, "EEXIST", "ENOTEMPTY", "EPERM")) throw error;
          const existing = await readLockOwner(this.lockDirectory);
          if (!existing) {
            // 接管者可能已移走所有者记录；只删除空壳，不触碰后来者的文件。
            await removeEmptyDirectory(this.lockDirectory);
            continue;
          }
          if (this.isProcessRunning(existing.owner.pid))
            throw new Error(`Agent Server 已由进程 ${existing.owner.pid} 占用运行目录。`);
          await this.removeOwner(existing.filename);
        }
      }
    } finally {
      if (!acquired) {
        await rm(candidateDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** 仅在当前实例仍拥有锁时释放目录，避免删除后来者的锁。 */
  async release(): Promise<void> {
    const owner = this.owner;
    if (!owner) return;
    await this.removeOwner(`owner.${owner.instanceId}.json`);
    if (this.owner === owner) this.owner = undefined;
  }

  /** 原子移走具备实例身份的记录；旧读取不能移走后来者的锁目录。 */
  private async removeOwner(filename: string): Promise<void> {
    const retired = join(this.rootDirectory, `.agent-server-lock.${randomUUID()}.retired`);
    try {
      await rename(join(this.lockDirectory, filename), retired);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }
    try {
      await removeEmptyDirectory(this.lockDirectory);
    } finally {
      await rm(retired, { force: true });
    }
  }
}

/** 兼容旧版 owner.json；新记录以实例 ID 命名，损坏记录明确拒绝接管。 */
async function readLockOwner(
  lockDirectory: string,
): Promise<{ owner: ServerLockOwner; filename: string } | undefined> {
  try {
    const files = await readdir(lockDirectory);
    if (!files.length) return undefined;
    const filename = files[0]!;
    if (files.length !== 1 || !/^owner(?:\.[\w-]+)?\.json$/.test(filename))
      throw new Error("运行目录锁包含未知文件，无法安全接管。");
    const owner = ownerSchema.parse(
      JSON.parse(await readFile(join(lockDirectory, filename), "utf8")),
    );
    if (filename !== "owner.json" && filename !== `owner.${owner.instanceId}.json`)
      throw new Error("运行目录锁身份不一致，无法安全接管。");
    return { owner, filename };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** 后来者的锁包含所有者文件，rmdir 无法删除它。 */
async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT", "ENOTEMPTY", "EEXIST")) throw error;
  }
}

/** 仅将明确的文件系统竞争结果视为可恢复情况。 */
function hasCode(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

/** 使用操作系统 PID 探测当前主机上的进程是否仍然存活。 */
function isLocalProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
