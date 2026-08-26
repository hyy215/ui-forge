/** 验证代码上下文读取拒绝路径逃逸和符号链接，并为文本文件生成稳定快照。 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemProjectCodeContextReader } from "./fileSystemProjectCodeContextReader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FileSystemProjectCodeContextReader", () => {
  it("reads existing planned text and records missing create targets", async () => {
    const root = await createTemporaryProject();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/App.tsx"), "export function App() { return null; }\n", "utf8");
    const reader = new FileSystemProjectCodeContextReader();

    const context = await reader.read({
      inspection: { kind: "react_antd", projectRoot: root, packageJsonPath: join(root, "package.json") },
      plannedPaths: ["src/App.tsx", "src/NewPage.tsx"],
      referencePaths: [],
    });

    expect(context.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/App.tsx", status: "existing", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ path: "src/NewPage.tsx", status: "missing" }),
    ]));
  });

  it("rejects traversal and a symlinked planned file", async () => {
    const root = await createTemporaryProject();
    const outside = await createTemporaryProject();
    await writeFile(join(outside, "secret.ts"), "export const secret = true;\n", "utf8");
    await symlink(join(outside, "secret.ts"), join(root, "linked.ts"));
    const reader = new FileSystemProjectCodeContextReader();
    const inspection = { kind: "empty" as const, projectRoot: root };

    await expect(reader.read({ inspection, plannedPaths: ["../secret.ts"], referencePaths: [] }))
      .rejects.toThrow("不安全路径");
    await expect(reader.read({ inspection, plannedPaths: ["linked.ts"], referencePaths: [] }))
      .rejects.toThrow("普通文件");
  });
});

/** 创建并登记一个测试完成后回收的临时项目目录。 */
async function createTemporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ui-forge-code-context-"));
  temporaryDirectories.push(path);
  return path;
}
