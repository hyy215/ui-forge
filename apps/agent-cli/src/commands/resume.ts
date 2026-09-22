/** resume 命令：重连原任务，空闲时原子地发送继续请求，再进入同一会话终端。 */
import {
  sessionMethods,
  sessionOperationResultSchema,
  sessionSnapshotSchema,
} from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { continuationPrompt } from "@ui-forge/client-core";
import { LocalClient } from "../client.js";
import { readJsonOption, readTaskId, requireTaskInputMode } from "../options.js";
import { watchTask } from "../taskSession.js";

/** 注册恢复命令；已有运行轮次时服务端跳过自动输入，仅建立订阅。 */
export function registerResumeCommand(program: Command): void {
  const command = program
    .command("resume")
    .description("重连任务；任务空闲时请求继续执行")
    .argument("<task-id>", "任务标识");
  command.action(async (value: unknown) => {
    const taskId = readTaskId(value);
    const json = readJsonOption(command);
    requireTaskInputMode(json);
    const client = new LocalClient();
    await client.connect();
    await client.request(
      sessionMethods.send,
      {
        taskId,
        text: continuationPrompt,
        startOnlyIfIdle: true,
      },
      sessionOperationResultSchema,
    );
    const snapshot = await client.request(sessionMethods.read, { taskId }, sessionSnapshotSchema);
    process.exitCode = await watchTask(client, snapshot, json);
  });
}
