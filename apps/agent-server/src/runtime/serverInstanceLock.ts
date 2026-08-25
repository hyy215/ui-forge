/** 通过原子目录替换限制同一运行目录只能启动一个 Agent Server。 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface ServerLockOwner {
  pid: number;
  instanceId: string;
  createdAt: string;
}

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
    await writeFile(join(candidateDirectory, "owner.json"), JSON.stringify(owner), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    let acquired = false;
    try {
      for (;;) {
        try {
          await rename(candidateDirectory, this.lockDirectory);
          acquired = true;
          this.owner = owner;
          return;
        } catch (error: unknown) {
          if (!await pathExists(this.lockDirectory)) throw error;
          const existing = await readLockOwner(this.lockDirectory);
          if (!existing || this.isProcessRunning(existing.pid)) {
            throw new Error(
              `Agent Server 已由进程 ${existing?.pid ?? "unknown"} 占用运行目录。`,
            );
          }
          const staleDirectory = join(
            this.rootDirectory,
            `.agent-server-lock.${existing.instanceId}.stale.${randomUUID()}`,
          );
          try {
            await rename(this.lockDirectory, staleDirectory);
          } catch {
            // 另一个启动者已先处理旧锁，重新竞争完整锁目录。
            continue;
          }
          await rm(staleDirectory, { recursive: true, force: true });
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
    this.owner = undefined;
    const current = await readLockOwner(this.lockDirectory);
    if (current?.instanceId !== owner.instanceId) return;
    await rm(this.lockDirectory, { recursive: true, force: true });
  }
}

/** 读取并校验原子锁目录中的所有者记录。 */
async function readLockOwner(lockDirectory: string): Promise<ServerLockOwner | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8"));
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<ServerLockOwner>;
    if (!Number.isInteger(candidate.pid) || (candidate.pid ?? 0) <= 0) return undefined;
    if (typeof candidate.instanceId !== "string" || !candidate.instanceId) return undefined;
    if (typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))) {
      return undefined;
    }
    return {
      pid: candidate.pid!,
      instanceId: candidate.instanceId,
      createdAt: candidate.createdAt,
    };
  } catch {
    return undefined;
  }
}

/** 判断指定路径当前是否存在。 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
