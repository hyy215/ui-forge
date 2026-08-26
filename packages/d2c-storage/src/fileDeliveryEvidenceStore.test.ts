/** 验证交付验收证据存储的任务所有权、哈希校验和精确清理边界。 */

import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileDeliveryEvidenceStore } from "./fileDeliveryEvidenceStore.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const otherTaskId = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FileDeliveryEvidenceStore", () => {
  it("round-trips a PNG only for its owning task and discards the exact task", async () => {
    const root = await createTemporaryRoot();
    const store = new FileDeliveryEvidenceStore(root);
    const reference = await store.write({
      taskId,
      patchSetHash: "a".repeat(64),
      kind: "actual",
      data: png,
      width: 1,
      height: 1,
    });

    await expect(store.read(taskId, reference.evidenceId)).resolves.toMatchObject({
      reference: { evidenceId: reference.evidenceId, kind: "actual" },
    });
    await expect(store.read(otherTaskId, reference.evidenceId)).rejects.toThrow();
    await store.discardTask(taskId);
    await expect(store.read(taskId, reference.evidenceId)).rejects.toThrow();
  });

  it("rejects a PNG whose bytes drift after the metadata is written", async () => {
    const root = await createTemporaryRoot();
    const store = new FileDeliveryEvidenceStore(root);
    const reference = await store.write({
      taskId,
      patchSetHash: "b".repeat(64),
      kind: "difference",
      data: png,
      width: 1,
      height: 1,
    });
    await writeFile(
      join(root, "delivery-evidence", taskId, `${reference.evidenceId}.png`),
      Buffer.concat([png, Buffer.from("drift")]),
    );

    await expect(store.read(taskId, reference.evidenceId)).rejects.toThrow("大小与元数据不一致");
  });

  it("rejects a pre-positioned symbolic-link evidence root", async () => {
    const root = await createTemporaryRoot();
    const outside = await createTemporaryRoot();
    await symlink(outside, join(root, "delivery-evidence"));

    await expect(new FileDeliveryEvidenceStore(root).write({
      taskId,
      patchSetHash: "c".repeat(64),
      kind: "actual",
      data: png,
      width: 1,
      height: 1,
    })).rejects.toThrow("目录不安全");
  });

  it("uses no-follow and a size limit when reading evidence metadata", async () => {
    const root = await createTemporaryRoot();
    const store = new FileDeliveryEvidenceStore(root);
    const reference = await store.write({
      taskId,
      patchSetHash: "d".repeat(64),
      kind: "actual",
      data: png,
      width: 1,
      height: 1,
    });
    const metadataPath = join(root, "delivery-evidence", taskId, `${reference.evidenceId}.json`);
    await rm(metadataPath);
    const outsideMetadata = join(root, "outside.json");
    await writeFile(outsideMetadata, "{}", "utf8");
    await symlink(outsideMetadata, metadataPath);

    await expect(store.read(taskId, reference.evidenceId)).rejects.toMatchObject({ code: "ELOOP" });

    await rm(metadataPath);
    await writeFile(metadataPath, Buffer.alloc(16 * 1024 + 1));
    await expect(store.read(taskId, reference.evidenceId)).rejects.toThrow("大小受限");
  });
});

/** 创建并登记一个可在测试后精确清理的临时 Artifact 根目录。 */
async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ui-forge-delivery-evidence-"));
  temporaryRoots.push(root);
  return root;
}
