/** 验证 Agent Server 单实例锁拒绝活动进程并接管崩溃遗留锁。 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ServerInstanceLock } from "./serverInstanceLock.js";

describe("ServerInstanceLock", () => {
  it("allows only one active Server in the same runtime directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-runtime-"));
    const first = new ServerInstanceLock(directory, {
      isProcessRunning: (pid) => pid === process.pid,
    });
    const second = new ServerInstanceLock(directory, {
      isProcessRunning: (pid) => pid === process.pid,
    });

    await first.acquire();
    await expect(second.acquire()).rejects.toThrow("已由进程");
    await first.release();
    await expect(second.acquire()).resolves.toBeUndefined();
    await second.release();
  });

  it("atomically replaces a lock whose owning process is no longer running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-runtime-"));
    const lockDirectory = join(directory, "agent-server.lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(join(lockDirectory, "owner.json"), JSON.stringify({
      pid: 999_999,
      instanceId: "stale-instance",
      createdAt: "2026-08-20T00:00:00.000Z",
    }), "utf8");
    const lock = new ServerInstanceLock(directory, {
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      isProcessRunning: () => false,
    });

    await expect(lock.acquire()).resolves.toBeUndefined();
    const owner = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8")) as {
      pid: number;
      instanceId: string;
    };
    expect(owner.pid).toBe(process.pid);
    expect(owner.instanceId).not.toBe("stale-instance");
    await lock.release();
  });

  it("treats acquire and release as idempotent for the owning instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-runtime-"));
    const lock = new ServerInstanceLock(directory);

    await lock.acquire();
    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
