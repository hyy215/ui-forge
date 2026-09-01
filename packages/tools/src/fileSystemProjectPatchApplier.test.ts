/** 验证受控 Patch 应用拒绝漂移与逃逸，并在提交失败时恢复全部文件。 */

import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemProjectPatchApplier } from "./fileSystemProjectPatchApplier.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FileSystemProjectPatchApplier", () => {
  it("creates, modifies and deletes files, then recognizes an idempotent retry", async () => {
    const root = await createTemporaryProject();
    await mkdir(join(root, "src"));
    const appPath = join(root, "src/App.tsx");
    const oldPath = join(root, "src/Old.tsx");
    await writeFile(appPath, "export const value = 1;\n", "utf8");
    await chmod(appPath, 0o744);
    await writeFile(oldPath, "export const old = true;\n", "utf8");
    const nextApp = "export const value = 2;\n";
    const newPage = "export function Page() { return null; }\n";
    const patchSet = createPatchSet([
      operation("src/App.tsx", "modify", hash("export const value = 1;\n"), nextApp),
      operation("src/New.tsx", "create", null, newPage),
      operation("src/Old.tsx", "delete", hash("export const old = true;\n"), null),
    ]);
    const applier = new FileSystemProjectPatchApplier();

    const applied = await applier.apply({ inspection: { kind: "empty", projectRoot: root }, patchSet });
    const repeated = await applier.apply({ inspection: { kind: "empty", projectRoot: root }, patchSet });

    expect(applied).toMatchObject({ status: "applied", alreadyApplied: false });
    expect(repeated).toMatchObject({ status: "applied", alreadyApplied: true });
    await expect(readFile(appPath, "utf8")).resolves.toBe(nextApp);
    await expect(readFile(join(root, "src/New.tsx"), "utf8")).resolves.toBe(newPage);
    await expect(readFile(oldPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(appPath)).mode & 0o777).toBe(0o744);
    expect((await readdir(root)).filter((entry) => entry.startsWith(".ui-forge-apply-"))).toEqual([]);
  });

  it("rejects file drift before changing any matching target", async () => {
    const root = await createTemporaryProject();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/A.ts"), "export const a = 1;\n", "utf8");
    await writeFile(join(root, "src/B.ts"), "export const b = 9;\n", "utf8");
    const patchSet = createPatchSet([
      operation("src/A.ts", "modify", hash("export const a = 1;\n"), "export const a = 2;\n"),
      operation("src/B.ts", "modify", hash("export const b = 1;\n"), "export const b = 2;\n"),
    ]);

    const result = await new FileSystemProjectPatchApplier().apply({
      inspection: { kind: "empty", projectRoot: root },
      patchSet,
    });

    expect(result).toMatchObject({ status: "blocked", manualActionRequired: true });
    await expect(readFile(join(root, "src/A.ts"), "utf8")).resolves.toBe("export const a = 1;\n");
    await expect(readFile(join(root, "src/B.ts"), "utf8")).resolves.toBe("export const b = 9;\n");
  });

  it("rejects traversal and symbolic-link targets without touching outside files", async () => {
    const root = await createTemporaryProject();
    const outside = await createTemporaryProject();
    await mkdir(join(root, "src"));
    const outsidePath = join(outside, "secret.ts");
    await writeFile(outsidePath, "export const secret = 1;\n", "utf8");
    await symlink(outsidePath, join(root, "src/linked.ts"));
    const applier = new FileSystemProjectPatchApplier();

    const traversal = await applier.apply({
      inspection: { kind: "empty", projectRoot: root },
      patchSet: createPatchSet([operation("../secret.ts", "create", null, "changed\n")]),
    });
    const linked = await applier.apply({
      inspection: { kind: "empty", projectRoot: root },
      patchSet: createPatchSet([
        operation("src/linked.ts", "modify", hash("export const secret = 1;\n"), "changed\n"),
      ]),
    });

    expect(traversal.status).toBe("blocked");
    expect(linked.status).toBe("blocked");
    await expect(readFile(outsidePath, "utf8")).resolves.toBe("export const secret = 1;\n");
  });

  it("rolls back an earlier committed file when a later commit fails", async () => {
    const root = await createTemporaryProject();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/A.ts"), "export const a = 1;\n", "utf8");
    await writeFile(join(root, "src/B.ts"), "export const b = 1;\n", "utf8");
    const patchSet = createPatchSet([
      operation("src/A.ts", "modify", hash("export const a = 1;\n"), "export const a = 2;\n"),
      operation("src/B.ts", "modify", hash("export const b = 1;\n"), "export const b = 2;\n"),
    ]);
    const applier = new FailingSecondCommitPatchApplier();

    const result = await applier.apply({ inspection: { kind: "empty", projectRoot: root }, patchSet });

    expect(result).toMatchObject({ status: "blocked" });
    await expect(readFile(join(root, "src/A.ts"), "utf8")).resolves.toBe("export const a = 1;\n");
    await expect(readFile(join(root, "src/B.ts"), "utf8")).resolves.toBe("export const b = 1;\n");
    expect((await readdir(root)).filter((entry) => entry.startsWith(".ui-forge-apply-"))).toEqual([]);
  });
});

/** 在第二个文件提交前注入失败以验证跨文件回滚。 */
class FailingSecondCommitPatchApplier extends FileSystemProjectPatchApplier {
  /** 只在第二个文件提交前抛出可预测错误。 */
  protected override async beforeCommitFile(_path: string, index: number): Promise<void> {
    if (index === 1) throw new Error("injected commit failure");
  }
}

/** 创建并登记测试完成后回收的空项目目录。 */
async function createTemporaryProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ui-forge-patch-apply-"));
  temporaryDirectories.push(root);
  return root;
}

/** 创建只包含应用器测试所需字段的 Patch 集合。 */
function createPatchSet(operations: D2CAgent.CodePatchOperation[]): D2CAgent.CodePatchSet {
  return {
    patchSetHash: "a".repeat(64),
    planVersion: 1,
    planHash: "b".repeat(64),
    summary: "测试 Patch",
    patches: [{ stepId: "step", patchHash: "c".repeat(64), operations }],
    warnings: [],
  };
}

/** 创建带正确前后内容哈希的文件操作。 */
function operation(
  path: string,
  action: D2CAgent.CodePatchOperation["action"],
  beforeHash: string | null,
  content: string | null,
): D2CAgent.CodePatchOperation {
  return {
    path,
    action,
    beforeHash,
    afterHash: content === null ? null : hash(content),
    ...(content === null ? {} : { content }),
    reviewDiff: `--- ${path}\n+++ ${path}`,
  };
}

/** 计算测试文本的 UTF-8 SHA-256。 */
function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
