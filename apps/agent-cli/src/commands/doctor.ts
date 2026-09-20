/** doctor 命令：检查 Codex 版本与登录状态，并在完成后关闭检查连接。 */
import { CodexClient, checkCodexVersion } from "@ui-forge/codex-client";
import type { Command } from "commander";
import { readJsonOption } from "../options.js";

/** 注册只读环境检查命令；未登录时使用退出码 1。 */
export function registerDoctorCommand(program: Command, root: string): void {
  const command = program.command("doctor").description("检查 Codex 版本和登录状态");
  command.action(async () => {
    const json = readJsonOption(command);
    const executable = process.env.UI_FORGE_CODEX_PATH || "codex";
    const client = new CodexClient({ cwd: root, executable });
    try {
      const version = await checkCodexVersion(executable);
      const { account } = await client.request("account/read", { refreshToken: false });
      const result = { ...version, authenticated: account !== null };
      process.stdout.write(
        `${json ? JSON.stringify(result) : `Codex ${version.runtimeVersion} · 协议 ${version.protocolVersion} · ${result.authenticated ? "已登录" : "未登录，请运行 codex login"}`}\n`,
      );
      if (!result.authenticated) process.exitCode = 1;
    } finally {
      await client.close();
    }
  });
}
