/** list 命令：连接本地服务并输出最近任务的分页结果。 */
import { sessionMethods, taskHistoryPageSchema } from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { LocalClient } from "../client.js";
import { readJsonOption } from "../options.js";

/** 注册任务列表命令，JSON 模式输出单行对象，普通模式缩进展示。 */
export function registerListCommand(program: Command): void {
  const command = program.command("list").description("列出最近任务");
  command.action(async () => {
    const json = readJsonOption(command);
    const client = new LocalClient();
    await client.connect();
    const result = await client.request(sessionMethods.list, { offset: 0 }, taskHistoryPageSchema);
    process.stdout.write(`${JSON.stringify(result, null, json ? undefined : 2)}\n`);
  });
}
