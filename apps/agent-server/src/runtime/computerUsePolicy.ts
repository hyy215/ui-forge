/** 禁用 ui-forge 任务中的桌面操作入口，同时保留包内 MasterGo 和 Playwright MCP。 */
import type { CodexClient } from "@ui-forge/codex-client";
import { z } from "zod";

/** 进程启动及线程配置均禁用桌面功能与插件，避免插件在初始化时注入 cua_repl。 */
export const computerUseDisabledConfig = {
  "features.computer_use": false,
  "plugins.unified-computer-use@openai-bundled.enabled": false,
  "plugins.computer-use@openai-bundled.enabled": false,
} as const;

const desktopServers = ["node_repl", "cua_repl", "computer-use"] as const;

/** 禁用当前工作区实际继承的桌面 MCP；不为未安装服务创建缺少 transport 的无效配置。 */
export async function disableDesktopMcp(
  client: Pick<CodexClient, "request">,
  cwd: string,
): Promise<Record<string, boolean>> {
  const { config } = await client.request("config/read", { cwd, includeLayers: false });
  const servers = z.record(z.string(), z.unknown()).parse(config.mcp_servers ?? {});
  return Object.fromEntries(
    desktopServers
      .filter((name) => Object.hasOwn(servers, name))
      .map((name) => [`mcp_servers.${name}.enabled`, false]),
  );
}
