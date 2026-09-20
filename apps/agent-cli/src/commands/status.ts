/** status 命令：读取指定任务的原生快照，不发送继续执行请求。 */
import { sessionMethods, sessionSnapshotSchema } from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { LocalClient } from "../client.js";
import { readJsonOption, readTaskId } from "../options.js";

/** 注册只读任务状态命令，保留原生快照的 JSON 数据结构。 */
export function registerStatusCommand(program: Command): void {
  const command = program
    .command("status")
    .description("查看任务的原生会话快照")
    .argument("<task-id>", "任务标识");
  command.action(async (value: unknown) => {
    const taskId = readTaskId(value);
    const json = readJsonOption(command);
    const client = new LocalClient();
    await client.connect();
    const snapshot = await client.request(sessionMethods.read, { taskId }, sessionSnapshotSchema);
    process.stdout.write(`${JSON.stringify(snapshot, null, json ? undefined : 2)}\n`);
  });
}
