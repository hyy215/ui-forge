/** 通过受控浅层文件系统读取识别空项目或 React + Ant Design 项目。 */

import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { z } from "zod";

const ignoredEmptyProjectEntries = new Set([
  ".DS_Store",
  ".ui-forge",
  ".git",
  ".gitignore",
  ".vscode",
]);
const maximumPackageJsonBytes = 1024 * 1024;
const dependencyMapSchema = z.record(z.string(), z.string());
const packageManifestSchema = z.object({
  dependencies: dependencyMapSchema.optional(),
  devDependencies: dependencyMapSchema.optional(),
  peerDependencies: dependencyMapSchema.optional(),
});

/** 从任务绑定目录读取最小工程证据并确定性判断当前支持状态。 */
export class FileSystemProjectInspector implements D2CAgent.ProjectInspector {
  /** 校验真实目录与 package.json 后返回空、支持或不支持分类。 */
  async inspect(projectPath: string): Promise<D2CAgent.ProjectInspection> {
    const requestedPath = projectPath.trim();
    if (!requestedPath) throw new Error("目标项目路径不能为空。");
    const projectRoot = await realpath(requestedPath);
    const projectStats = await stat(projectRoot);
    if (!projectStats.isDirectory()) throw new Error("目标项目路径不是目录。");

    const entries = await readdir(projectRoot, { withFileTypes: true });
    const meaningfulEntries = entries.filter(
      (entry) => !ignoredEmptyProjectEntries.has(entry.name),
    );
    if (meaningfulEntries.length === 0) return { kind: "empty", projectRoot };

    const packageJsonEntry = meaningfulEntries.find((entry) => entry.name === "package.json");
    if (!packageJsonEntry) {
      return {
        kind: "unsupported",
        projectRoot,
        reasons: ["非空项目缺少根 package.json"],
      };
    }

    const packageJsonPath = join(projectRoot, packageJsonEntry.name);
    const packageJsonStats = await lstat(packageJsonPath);
    if (packageJsonStats.isSymbolicLink()) {
      throw new Error("目标项目 package.json 不允许使用符号链接。");
    }
    if (!packageJsonStats.isFile()) {
      return {
        kind: "unsupported",
        projectRoot,
        reasons: ["根 package.json 不是普通文件"],
      };
    }
    if (packageJsonStats.size > maximumPackageJsonBytes) {
      throw new Error("目标项目 package.json 超过允许的读取大小。");
    }

    const manifest = parsePackageManifest(await readFile(packageJsonPath, "utf8"));
    if (!manifest.success) {
      return {
        kind: "unsupported",
        projectRoot,
        reasons: [manifest.reason],
      };
    }
    const dependencies = {
      ...manifest.value.peerDependencies,
      ...manifest.value.devDependencies,
      ...manifest.value.dependencies,
    };
    const reactVersion = dependencies.react;
    const antdVersion = dependencies.antd;
    const reasons: string[] = [];
    if (!reactVersion) reasons.push("缺少 React 依赖");
    if (!antdVersion) reasons.push("缺少 Ant Design 依赖");
    if (reasons.length > 0) return { kind: "unsupported", projectRoot, reasons };
    if (!reactVersion || !antdVersion) throw new Error("项目依赖检查结果不一致。");

    return {
      kind: "react_antd",
      projectRoot,
      packageJsonPath,
      reactVersion,
      antdVersion,
    };
  }
}

/** 解析并校验外部 package.json 中项目识别所需的最小字段。 */
function parsePackageManifest(source: string):
  | { success: true; value: z.infer<typeof packageManifestSchema> }
  | { success: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { success: false, reason: "根 package.json 不是有效 JSON" };
  }
  const parsed = packageManifestSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false, reason: "根 package.json 的依赖字段格式无效" };
  }
  return { success: true, value: parsed.data };
}
