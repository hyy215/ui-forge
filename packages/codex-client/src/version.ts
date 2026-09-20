/** 通过 CLI 的版本命令检查运行版本；不创建 Codex 任务。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexProtocolVersion } from "./protocol.js";
import { explainCodexStartupError, resolveCodexExecutable } from "./runtime/executable.js";

/** 报告运行版本与协议生成版本；不同版本不自动判为不兼容。 */
export async function checkCodexVersion(executable = "codex"): Promise<{
  runtimeVersion: string;
  protocolVersion: string;
  matches: boolean;
}> {
  const resolved = resolveCodexExecutable(executable);
  const { stdout } = await promisify(execFile)(resolved, ["--version"], {
    timeout: 5_000,
    maxBuffer: 16 * 1024,
  }).catch((error: unknown) => {
    throw error instanceof Error ? explainCodexStartupError(error, resolved) : error;
  });
  const runtimeVersion = /^codex(?:-cli)?\s+(\S+)\s*$/m.exec(stdout)?.[1];
  if (!runtimeVersion) throw new Error("Cannot determine Codex CLI version");
  return {
    runtimeVersion,
    protocolVersion: codexProtocolVersion,
    matches: runtimeVersion === codexProtocolVersion,
  };
}
