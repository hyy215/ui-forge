/** 为 D2C 中间产物提供安装目录内的稳定位置，源码工作区保持独立。 */
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { NativeMethods } from "./generated/native.js";

/** 按目标项目隔离临时产物；默认位于 ui-forge 安装根，恢复时复用同一路径。 */
export async function prepareTemporaryWorkspace(
  cwd: string,
  runtimeDirectory = fileURLToPath(new URL("../../../.ui-forge/runtime/", import.meta.url)),
): Promise<string> {
  const directory = await temporaryWorkspacePath(cwd, runtimeDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return realpath(directory);
}

/** 只读计算项目的临时目录，文件预览可复用位置规则而不创建目录。 */
export async function temporaryWorkspacePath(
  cwd: string,
  runtimeDirectory: string,
): Promise<string> {
  return temporaryWorkspacePathForCanonicalCwd(await realpath(cwd), runtimeDirectory);
}

/** 由宿主已保存的规范绝对路径定位历史产物；不读取磁盘、不验证或授予工作区访问权。 */
export function temporaryWorkspacePathForCanonicalCwd(
  canonicalCwd: string,
  runtimeDirectory: string,
): string {
  if (!isAbsolute(canonicalCwd)) throw new Error("工作区身份必须是规范绝对路径。");
  const key = createHash("sha256").update(canonicalCwd).digest("hex").slice(0, 24);
  return resolve(runtimeDirectory, "tmp", key);
}

/** 给命令和 MCP 子进程设置同一临时目录，不修改服务进程或用户的全局环境。 */
export function temporaryWorkspaceEnvironment(directory: string): Record<string, string> {
  // 保留 Playwright 原有的短 socket 路径；项目内产物目录可能超过 Unix socket 长度上限。
  const user = createHash("sha1")
    .update(process.env.USERNAME || process.env.USER || "default")
    .digest("hex")
    .slice(0, 8);
  return {
    UI_FORGE_TEMP_DIR: directory,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    PWTEST_SOCKETS_DIR: process.env.PWTEST_SOCKETS_DIR || join(tmpdir(), `pw-${user}`),
  };
}

/** 每轮通过原生应用上下文提供产物位置，避免恢复任务时替换已保存的设计与工程规则。 */
export function temporaryWorkspaceContext(
  directory: string,
): NonNullable<NativeMethods["turn/start"]["params"]["additionalContext"]> {
  return {
    ui_forge_artifacts: {
      kind: "application",
      value: [
        `本次 ui-forge 临时产物目录（绝对路径）：${directory}`,
        "设计 DSL/JSON、截图、切片、差异图、验证报告、日志、下载的待处理资源和临时脚本全部写入此目录。每个任务或并行子任务使用唯一子目录，工具的 filename、输出路径等显式传入该目录内的绝对路径。",
        "源码工作区仍为线程 cwd；最终源码、正式测试和实际引用的资源按项目约定写入该工作区。不要在目标工作区新建 evidence、screenshots、临时报告或调试脚本；已有构建工具的正常输出遵循其配置，支持指定验证产物目录时使用上述临时目录。",
        "委派子任务时传递本目录与写入边界。不要自动移动或清理之前的文件，也不要以临时文件路径替代最终项目需要的资源路径。",
      ].join("\n"),
    },
  };
}
