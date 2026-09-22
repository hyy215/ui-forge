/** CLI 直接展示原生会话事件并回传真实请求，Ctrl-C 只断开连接。 */
import { createInterface } from "node:readline";
import { z } from "zod";
import { getSessionFailure } from "@ui-forge/client-core";
import {
  sessionMethods,
  sessionSnapshotSchema,
  sessionOperationResultSchema,
  type PendingRequest,
  type SessionEvent,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import type { LocalClient } from "./client.js";

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), text: z.string().trim().min(1) }),
  z.object({ type: z.literal("reply"), token: z.string().min(1), result: z.json() }),
  z.object({ type: z.literal("stop"), turnId: z.string().min(1) }),
]);
/** 交互终端支持简写，脚本必须携带明确的 token 或 turn ID。 */
export async function watchTask(
  client: LocalClient,
  initial: SessionSnapshot,
  json: boolean,
): Promise<number> {
  const taskId = initial.thread.id;
  const controller = new AbortController();
  let activeTurnId: string | undefined;
  let exitCode = 0;
  let completed = false;
  let detachedByUser = false;
  const requests = new Map<string, PendingRequest>();
  let work = Promise.resolve();
  const output = (value: unknown, text: string) => {
    process.stdout.write(json ? `${JSON.stringify(value)}\n` : text);
  };
  const rl = createInterface({
    input: process.stdin,
    ...(process.stdin.isTTY ? { output: process.stdout } : {}),
    terminal: Boolean(process.stdin.isTTY && !json),
  });
  const detach = () => {
    detachedByUser = true;
    controller.abort();
  };
  process.once("SIGINT", detach);
  rl.on("SIGINT", detach);
  output(
    { type: "task", taskId },
    `任务：${taskId}\n/approve、/reject 处理单个待审批；/reply <token> <JSON> 回答任意请求；/stop 停止本轮；Ctrl-C 断开。\n`,
  );
  const receive = (event: SessionEvent) => {
    if (json) output({ type: "event", taskId, event }, "");
    if (event.type === "snapshot") {
      requests.clear();
      for (const pending of event.snapshot.pendingRequests) requests.set(pending.token, pending);
      activeTurnId = event.snapshot.thread.turns.findLast(
        (turn) => turn.status === "inProgress",
      )?.id;
      if (!json)
        for (const turn of event.snapshot.thread.turns)
          for (const item of turn.items) {
            if (item.type === "agentMessage" && typeof item.text === "string")
              output({}, `${item.text}\n`);
          }
      const last = event.snapshot.thread.turns.at(-1);
      if (!activeTurnId && last && ["completed", "failed", "interrupted"].includes(last.status)) {
        completed = true;
        exitCode = last.status === "completed" ? 0 : 1;
        controller.abort();
      }
      if (!json)
        for (const pending of requests.values())
          output({}, `\n等待 ${pending.token}\n${JSON.stringify(pending.request, null, 2)}\n`);
    } else if (event.type === "request") {
      requests.set(event.pending.token, event.pending);
      if (!json)
        output(
          {},
          `\n等待 ${event.pending.token}\n${JSON.stringify(event.pending.request, null, 2)}\n`,
        );
    } else if (event.type === "resolved") requests.delete(event.token);
    else if (event.type === "close") {
      requests.clear();
      if (!json) output({}, `\n连接中断：${event.message}\n`);
    } else if (event.type === "diagnostic") {
      if (!json) output({}, `\n${event.message}\n`);
    } else {
      const { method, params = {} } = event.notification;
      if (method === "serverRequest/resolved")
        for (const [token, pending] of requests)
          if (pending.request.id === params.requestId) requests.delete(token);
      if (method === "turn/started" && params.threadId === taskId) {
        const turn = z.object({ id: z.string() }).safeParse(params.turn);
        if (turn.success) activeTurnId = turn.data.id;
      }
      if (!json) {
        if (method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta")
          output({}, typeof params.delta === "string" ? params.delta : "");
        else if (method !== "thread/tokenUsage/updated")
          output({}, `\n${method}\n${JSON.stringify(params)}\n`);
      }
      if (method === "turn/completed" && params.threadId === taskId) {
        const turn = z.object({ id: z.string(), status: z.string() }).safeParse(params.turn);
        if (turn.success && (!activeTurnId || turn.data.id === activeTurnId)) {
          completed = true;
          exitCode = turn.data.status === "completed" ? 0 : 1;
          controller.abort();
        }
      }
    }
  };
  rl.on("line", (line) => {
    work = work
      .then(async () => {
        let command: z.infer<typeof commandSchema>;
        if (json) command = commandSchema.parse(JSON.parse(line));
        else if (line === "/stop") {
          if (!activeTurnId) throw new Error("当前没有运行轮次。");
          command = { type: "stop", turnId: activeTurnId };
        } else if (line.startsWith("/reply ")) {
          const match = /^\/reply\s+(\S+)\s+([\s\S]+)$/.exec(line);
          if (!match) throw new Error("用法：/reply <token> <JSON>");
          command = commandSchema.parse({
            type: "reply",
            token: match[1],
            result: JSON.parse(match[2] ?? ""),
          });
        } else if (line === "/approve" || line === "/reject") {
          const pending = [...requests.values()];
          const request = pending[0];
          if (
            pending.length !== 1 ||
            !request ||
            !["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(
              request.request.method,
            )
          )
            throw new Error("请使用 /reply <token> <JSON> 回答对应请求。");
          command = {
            type: "reply",
            token: request.token,
            result: { decision: line === "/approve" ? "accept" : "decline" },
          };
        } else command = commandSchema.parse({ type: "input", text: line });
        if (command.type === "input")
          await client.request(
            sessionMethods.send,
            { taskId, text: command.text },
            sessionOperationResultSchema,
          );
        else if (command.type === "stop")
          await client.request(
            sessionMethods.stop,
            { taskId, turnId: command.turnId },
            sessionOperationResultSchema,
          );
        else {
          if (!requests.has(command.token)) throw new Error("请求已失效。");
          await client.request(
            sessionMethods.respond,
            { taskId, token: command.token, result: command.result },
            sessionOperationResultSchema,
          );
          requests.delete(command.token);
        }
      })
      .catch((error: unknown) =>
        output(
          { type: "input-error", message: error instanceof Error ? error.message : "输入失败" },
          `${error instanceof Error ? error.message : "输入失败"}\n`,
        ),
      );
  });
  try {
    await client.subscribe(taskId, receive, controller.signal);
    await work;
    if (!completed && !detachedByUser) throw new Error("会话连接已关闭，请使用 resume 重新连接。");
    if (!completed) {
      output({ type: "detached", taskId }, `\n已断开，任务继续运行：${taskId}\n`);
      return 0;
    }
    const snapshot = await client.request(sessionMethods.read, { taskId }, sessionSnapshotSchema);
    output(
      { type: "result", snapshot },
      `\n会话：${snapshot.thread.id}；状态：${snapshot.thread.turns.at(-1)?.status ?? "idle"}。验证结论见 Codex 输出。\n`,
    );
    const lastTurn = snapshot.thread.turns.at(-1);
    const failure = lastTurn?.status === "failed" ? getSessionFailure(lastTurn.error) : undefined;
    if (!json && failure) {
      output({}, `${failure.title}：${failure.message}\n`);
      if (failure.canContinue) output({}, `稍后继续原任务：ui-forge resume ${taskId}\n`);
    }
    return exitCode;
  } finally {
    rl.close();
    process.removeListener("SIGINT", detach);
    controller.abort();
  }
}
