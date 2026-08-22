/** 验证文件 Artifact Store 的跨实例恢复、输入校验和幂等清理。 */

import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileDesignArtifactStore } from "./fileDesignArtifactStore.js";

const content = {
  source: { provider: "mastergo", reference: "table-filter" },
  name: "客户列表",
  nodeCount: 1,
  regions: [{ id: "1:1", name: "表格" }],
  tokens: { colorPrimary: "#1677ff" },
  structure: {
    truncated: false,
    roots: [{ id: "1:1", name: "表格", kind: "container" as const, children: [] }],
  },
  sections: [{ id: "section-1", label: "Section List", data: { type: "FRAME" } }],
};

describe("FileDesignArtifactStore", () => {
  it("restores an artifact from a new store instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-artifacts-"));
    const reference = await new FileDesignArtifactStore(directory).write(content);

    const restored = await new FileDesignArtifactStore(directory).read(reference.artifactId);

    expect(restored).toEqual({ content, reference });
    expect(await new FileDesignArtifactStore(directory).readSection(reference.artifactId, 0))
      .toEqual(content.sections[0]);
  });

  it("rejects corrupt persisted data and unknown identifiers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-artifacts-"));
    const store = new FileDesignArtifactStore(directory);
    const reference = await store.write(content);
    await writeFile(join(directory, `${reference.artifactId}.json`), "{}", "utf8");

    await expect(store.read(reference.artifactId)).rejects.toThrow();
    await expect(store.read("../escape")).rejects.toThrow();
  });

  it("keeps superseded artifacts until the discarded-artifact cutoff", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-artifacts-"));
    const store = new FileDesignArtifactStore(directory, {
      now: () => new Date("2026-08-18T00:00:00.000Z"),
    });
    const taskId = randomUUID();
    const reference = await store.write(content);

    expect(await store.readLifecycle(reference.artifactId)).toMatchObject({ status: "pending" });
    await store.attach(reference.artifactId, { taskId, workspaceId: "git:demo", revision: 1 });
    await store.supersede(reference.artifactId);

    expect(await store.readLifecycle(reference.artifactId)).toMatchObject({
      status: "superseded",
      taskId,
      revision: 1,
    });
    expect(await store.read(reference.artifactId)).toEqual({ content, reference });
    expect(await store.deleteDiscardedBefore(new Date("2026-08-18T00:00:00.000Z"))).toBe(1);
    await expect(store.read(reference.artifactId)).rejects.toThrow("不存在或已失效");
  });

  it("collects only stale pending or abandoned artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-artifacts-"));
    let now = new Date("2026-08-18T00:00:00.000Z");
    const store = new FileDesignArtifactStore(directory, { now: () => now });
    const stale = await store.write(content);
    const attached = await store.write(content);
    await store.abandon(stale.artifactId);
    await store.attach(attached.artifactId, {
      taskId: randomUUID(),
      workspaceId: "git:demo",
      revision: 1,
    });
    now = new Date("2026-08-20T00:00:00.000Z");

    expect(await store.deleteDiscardedBefore(new Date("2026-08-19T00:00:00.000Z"))).toBe(1);
    await expect(store.read(stale.artifactId)).rejects.toThrow("不存在或已失效");
    await expect(store.read(attached.artifactId)).resolves.toBeDefined();
  });

  it("serializes garbage collection with an overlapping lifecycle transition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ui-forge-artifacts-"));
    const store = new FileDesignArtifactStore(directory, {
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const reference = await store.write(content);
    const internalStore = store as unknown as {
      readStoredArtifact(artifactId: string): Promise<unknown>;
    };
    const originalRead = internalStore.readStoredArtifact.bind(store);
    let releaseGarbageCollection = (): void => {};
    let markGarbageCollectionRead = (): void => {};
    const garbageCollectionGate = new Promise<void>((resolve) => {
      releaseGarbageCollection = resolve;
    });
    const garbageCollectionRead = new Promise<void>((resolve) => {
      markGarbageCollectionRead = resolve;
    });
    let pauseFirstRead = true;
    internalStore.readStoredArtifact = async (artifactId) => {
      const artifact = await originalRead(artifactId);
      if (pauseFirstRead) {
        pauseFirstRead = false;
        markGarbageCollectionRead();
        await garbageCollectionGate;
      }
      return artifact;
    };

    const garbageCollection = store.deleteDiscardedBefore(
      new Date("2026-08-20T00:00:00.000Z"),
    );
    await garbageCollectionRead;
    const attach = store.attach(reference.artifactId, {
      taskId: randomUUID(),
      workspaceId: "git:demo",
      revision: 1,
    });
    let attachSettled = false;
    void attach.finally(() => { attachSettled = true; }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attachSettled).toBe(false);

    releaseGarbageCollection();
    await expect(garbageCollection).resolves.toBe(1);
    await expect(attach).rejects.toThrow("不存在或已失效");
  });
});
