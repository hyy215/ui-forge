/** 统一查找 Codex 可执行文件，并为宿主补充可操作的启动错误信息。 */
import { accessSync, constants, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { posix, win32 } from "node:path";

/** 优先使用显式配置和 PATH；macOS GUI 环境额外查找桌面应用与常见安装目录。 */
export function resolveCodexExecutable(executable = "codex", cwd = process.cwd()): string {
  // 显式指定的路径或其他命令由操作系统执行；配置失效时不得悄悄换用另一份 Codex。
  if (executable !== "codex") return executable;
  const system = platform();
  const paths = system === "win32" ? win32 : posix;
  const binary = system === "win32" ? "codex.exe" : "codex";
  const searchPath = process.env.PATH ?? (system === "win32" ? process.env.Path : undefined) ?? "";
  const candidates = searchPath
    .split(paths.delimiter)
    .filter(Boolean)
    .map((directory) => paths.resolve(cwd, directory, binary));
  if (system === "darwin") {
    for (const directory of ["/Applications", posix.join(homedir(), "Applications")]) {
      for (const app of ["Codex.app", "ChatGPT.app"]) {
        candidates.push(posix.join(directory, app, "Contents/Resources/codex"));
      }
    }
    candidates.push(
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      posix.join(homedir(), ".local/bin/codex"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* 不可用的候选路径交给下一个候选；最终保留操作系统的启动错误。 */
    }
  }
  return executable;
}

/** 保留操作系统错误码；区分缺失工作区与无法启动的程序，避免只显示 spawn ENOENT。 */
export function explainCodexStartupError(error: Error, executable: string, cwd?: string): Error {
  if (!("code" in error) || (error.code !== "ENOENT" && error.code !== "EACCES")) return error;
  if (cwd) {
    try {
      if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
    } catch {
      error.message += `\nCodex 工作区不存在或不可访问：${cwd}。请检查目标目录。`;
      return error;
    }
  }
  error.message += `\n无法启动 Codex：${executable}。请在仓库根 .env 中将 UI_FORGE_CODEX_PATH 设为 Codex 可执行文件的绝对路径，并确认文件及其运行环境可用；修改后重启 agent-server。`;
  return error;
}
