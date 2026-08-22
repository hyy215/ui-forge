/** 验证文件系统项目检查器的空目录、依赖分类和符号链接拒绝行为。 */

import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemProjectInspector } from "./fileSystemProjectInspector.js";

const temporaryDirectories: string[] = [];

describe("FileSystemProjectInspector", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(
      (directory) => rm(directory, { recursive: true, force: true }),
    ));
  });

  it("treats a directory containing only workspace metadata as empty", async () => {
    const projectRoot = await createTemporaryProject();
    await mkdir(join(projectRoot, ".git"));
    await writeFile(join(projectRoot, ".gitignore"), "node_modules\n", "utf8");

    await expect(new FileSystemProjectInspector().inspect(projectRoot)).resolves.toEqual({
      kind: "empty",
      projectRoot,
    });
  });

  it("recognizes React and Ant Design across supported dependency sections", async () => {
    const projectRoot = await createTemporaryProject();
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      dependencies: { react: "^19.0.0" },
      devDependencies: { antd: "^6.0.0" },
    }), "utf8");

    await expect(new FileSystemProjectInspector().inspect(projectRoot)).resolves.toEqual({
      kind: "react_antd",
      projectRoot,
      packageJsonPath: join(projectRoot, "package.json"),
      reactVersion: "^19.0.0",
      antdVersion: "^6.0.0",
    });
  });

  it("reports deterministic reasons for a non-supported project", async () => {
    const projectRoot = await createTemporaryProject();
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      dependencies: { react: "^19.0.0" },
    }), "utf8");

    await expect(new FileSystemProjectInspector().inspect(projectRoot)).resolves.toEqual({
      kind: "unsupported",
      projectRoot,
      reasons: ["缺少 Ant Design 依赖"],
    });
  });

  it("rejects a symlinked package manifest", async () => {
    const projectRoot = await createTemporaryProject();
    const externalRoot = await createTemporaryProject();
    const externalManifest = join(externalRoot, "package.json");
    await writeFile(externalManifest, JSON.stringify({
      dependencies: { react: "^19.0.0", antd: "^6.0.0" },
    }), "utf8");
    await symlink(externalManifest, join(projectRoot, "package.json"));

    await expect(new FileSystemProjectInspector().inspect(projectRoot))
      .rejects.toThrow("不允许使用符号链接");
  });
});

/** 创建并登记单测结束后自动清理的真实临时目录。 */
async function createTemporaryProject(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-project-inspector-")));
  temporaryDirectories.push(directory);
  return directory;
}
