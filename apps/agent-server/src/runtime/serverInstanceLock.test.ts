/** 验证 Agent Server 单实例锁拒绝活动进程并接管崩溃遗留锁。 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ServerInstanceLock } from "./serverInstanceLock.js";

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-runtime-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ServerInstanceLock", () => {
  it("allows only one active Server in the same runtime directory", async () => {
    const directory = await temporaryDirectory();
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
    const directory = await temporaryDirectory();
    const lockDirectory = join(directory, "agent-server.lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      join(lockDirectory, "owner.json"),
      JSON.stringify({
        pid: 999_999,
        instanceId: "stale-instance",
        createdAt: "2026-08-20T00:00:00.000Z",
      }),
      "utf8",
    );
    const lock = new ServerInstanceLock(directory, {
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      isProcessRunning: () => false,
    });

    await expect(lock.acquire()).resolves.toBeUndefined();
    const [filename] = await readdir(lockDirectory);
    expect(filename).toMatch(/^owner\.[\w-]+\.json$/);
    const owner = JSON.parse(await readFile(join(lockDirectory, filename!), "utf8")) as {
      pid: number;
      instanceId: string;
    };
    expect(owner.pid).toBe(process.pid);
    expect(owner.instanceId).not.toBe("stale-instance");
    await lock.release();
  });

  it("treats acquire and release as idempotent for the owning instance", async () => {
    const directory = await temporaryDirectory();
    const lock = new ServerInstanceLock(directory);

    await lock.acquire();
    await expect(lock.acquire()).resolves.toBeUndefined();
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it.each(["owner.json", "owner.stale.json"])(
    "keeps one owner during concurrent recovery of %s",
    async (filename) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const directory = await temporaryDirectory();
        const lockDirectory = join(directory, "agent-server.lock");
        await mkdir(lockDirectory);
        await writeFile(
          join(lockDirectory, filename),
          JSON.stringify({ pid: 999999, instanceId: "stale", createdAt: new Date().toISOString() }),
        );
        const locks = Array.from(
          { length: 8 },
          () =>
            new ServerInstanceLock(directory, { isProcessRunning: (pid) => pid === process.pid }),
        );
        const results = await Promise.allSettled(locks.map((lock) => lock.acquire()));
        expect(
          results.filter((result) => result.status === "fulfilled"),
          `attempt ${attempt}`,
        ).toHaveLength(1);
        await Promise.all(locks.map((lock) => lock.release()));
        expect(await readdir(directory)).toEqual([]);
      }
    },
  );

  it("does not remove a successor when a previous owner releases", async () => {
    const directory = await temporaryDirectory();
    const previous = new ServerInstanceLock(directory);
    await previous.acquire();
    const successor = new ServerInstanceLock(directory, { isProcessRunning: () => false });
    await successor.acquire();
    const observer = new ServerInstanceLock(directory);
    await previous.release();
    await expect(observer.acquire()).rejects.toThrow("已由进程");
    await successor.release();
    await observer.acquire();
    await observer.release();
  });

  it("preserves an unrecognized lock instead of deleting it", async () => {
    const directory = await temporaryDirectory();
    const lockDirectory = join(directory, "agent-server.lock");
    await mkdir(lockDirectory);
    await writeFile(join(lockDirectory, "unknown"), "keep");
    await expect(new ServerInstanceLock(directory).acquire()).rejects.toThrow("未知文件");
    expect(await readFile(join(lockDirectory, "unknown"), "utf8")).toBe("keep");
  });
});
