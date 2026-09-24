/** CLI 直接展示原生会话事件并回传真实请求，Ctrl-C 只断开连接。 */
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  applySessionEvent,
  emptyPresentation,
  emptyTaskObservation,
  formatObservedDuration,
  getSessionFailure,
  nativeTurnElapsedMs,
  observeTaskEvent,
  summarizeRecordedWork,
  type SessionPresentation,
} from "@ui-forge/client-core";
import {
  sessionMethods,
  sessionSnapshotSchema,
  sessionOperationResultSchema,
  type PendingRequest,
  type SessionEvent,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import type { LocalClient } from "./client.js";
import { terminalText } from "./terminalText.js";

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), text: z.string().trim().min(1) }),
  z.object({ type: z.literal("reply"), token: z.string().min(1), result: z.json() }),
  z.object({ type: z.literal("stop"), turnId: z.string().min(1) }),
]);

function taskArgument(taskId: string): string {
  return /^[A-Za-z0-9_-]+$/.test(taskId) ? taskId : `'${taskId.replaceAll("'", "'\\''")}'`;
}

function inspectionCommands(taskId: string): string {
  const argument = taskArgument(taskId);
  return [
    `查看任务状态：ui-forge status ${argument}`,
    `查看诊断：ui-forge diagnostics ${argument}`,
    `查看交付记录：ui-forge delivery ${argument}`,
  ].join("\n");
}

function continuationCommand(taskId: string): string {
  return `ui-forge resume ${taskArgument(taskId)}`;
}

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
  let presentation: SessionPresentation | undefined = json
    ? undefined
    : { ...emptyPresentation(), snapshot: initial };
  let observation = json ? undefined : emptyTaskObservation(taskId, Date.now());
  let lastWorkSummary: string | undefined;
  const requests = new Map<string, PendingRequest>();
  let work = Promise.resolve();
  const output = (value: unknown, text: string) => {
    process.stdout.write(json ? `${JSON.stringify(value)}\n` : terminalText(text));
  };
  const showRecordedWork = (snapshot: SessionSnapshot) => {
    if (json) return;
    const summary = summarizeRecordedWork(snapshot.thread.turns);
    if (summary !== lastWorkSummary) output({}, `${summary}\n`);
    lastWorkSummary = summary;
  };
  const showLocalStatus = () => {
    const snapshot = presentation?.snapshot;
    if (!snapshot || !observation) return;
    const now = Date.now();
    const active = snapshot.thread.turns.findLast((turn) => turn.status === "inProgress");
    const turn = active ?? snapshot.thread.turns.at(-1);
    const pending = snapshot.pendingRequests.length;
    const flags = Array.isArray(snapshot.thread.status.activeFlags)
      ? snapshot.thread.status.activeFlags
      : [];
    const states: Record<string, string> = {
      inProgress: "运行中",
      completed: "本轮已结束",
      failed: "本轮失败",
      interrupted: "本轮已中断",
      idle: "空闲",
      active: "运行中",
    };
    const status =
      pending > 0
        ? `等待处理 ${pending} 个请求`
        : active && flags.includes("waitingOnApproval")
          ? "等待审批"
          : active && flags.includes("waitingOnUserInput")
            ? "等待输入"
            : (states[turn?.status ?? snapshot.thread.status.type] ?? "未知");
    const connected = presentation?.connection === "connected";
    const connection = connected ? "已连接" : "未连接，以下为最近记录";
    const elapsed = active && !connected ? null : nativeTurnElapsedMs(turn, now);
    output(
      {},
      [
        `\n任务：${taskId}；当前记录状态：${status}；连接：${connection}`,
        `本轮原生耗时：${formatObservedDuration(elapsed)}`,
        `本连接最近主线程事件接收时间：${observation.lastEventAtMs === null ? "尚未观测到" : new Date(observation.lastEventAtMs).toISOString()}`,
        `主线程累计 Token（本连接最后观测）：${observation.totalTokens ?? "未知"}；不是本轮用量、费用或预算。`,
        `Token 观测时间：${observation.tokenObservedAtMs === null ? "未知" : new Date(observation.tokenObservedAtMs).toISOString()}`,
        "以上为本地已收到的记录，不代表当前工具有进展或验收通过。",
        "",
      ].join("\n"),
    );
  };
  const showConnectionHelp = () => {
    if (json) return;
    output({}, `\n任务 ${taskId} 的连接已中断，当前执行状态未确认；不会自动重试。\n`);
    showRecordedWork(presentation?.snapshot ?? initial);
    output({}, `${inspectionCommands(taskId)}\n`);
    output(
      {},
      `确认后可使用 ${continuationCommand(taskId)}；任务空闲时会继续执行，不是只读重连。\n`,
    );
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
    `任务：${taskId}\n/approve、/reject 处理单个待审批；/reply <token> <JSON> 回答任意请求；/status 查看本地运行记录；/stop 停止本轮；Ctrl-C 断开。\n`,
  );
  const receive = (event: SessionEvent) => {
    if (json) output({ type: "event", taskId, event }, "");
    if (presentation) presentation = applySessionEvent(presentation, event);
    if (observation) observation = observeTaskEvent(observation, event, Date.now());
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
      showRecordedWork(event.snapshot);
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
        if (
          method === "error" &&
          params.willRetry === true &&
          params.threadId === taskId &&
          activeTurnId !== undefined &&
          params.turnId === activeTurnId
        )
          output({}, "\nCodex 正在重试，当前轮次尚未结束。\n");
        else if (
          method === "item/agentMessage/delta" ||
          method === "item/commandExecution/outputDelta"
        )
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
    if (!json && line === "/status") {
      showLocalStatus();
      return;
    }
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
        else if (command.type === "stop") {
          await client.request(
            sessionMethods.stop,
            { taskId, turnId: command.turnId },
            sessionOperationResultSchema,
          );
          if (!json) output({}, "停止请求已提交，等待原生状态确认。\n");
        } else {
          const pending = requests.get(command.token);
          if (!pending) throw new Error("请求已失效。");
          await client.request(
            sessionMethods.respond,
            { taskId, token: command.token, result: command.result },
            sessionOperationResultSchema,
          );
          requests.delete(command.token);
          if (!json) {
            const approval = [
              "item/commandExecution/requestApproval",
              "item/fileChange/requestApproval",
            ].includes(pending.request.method);
            const decision = z.object({ decision: z.string() }).safeParse(command.result);
            output(
              {},
              approval
                ? `${decision.success && decision.data.decision === "decline" ? "拒绝" : "审批"}决议已提交；不代表任务已停止或操作已执行。\n`
                : "回复已提交。\n",
            );
          }
        }
      })
      .catch((error: unknown) =>
        output(
          { type: "input-error", message: error instanceof Error ? error.message : "输入失败" },
          `操作未确认：${error instanceof Error ? error.message : "输入失败"}\n`,
        ),
      );
  });
  try {
    try {
      await client.subscribe(taskId, receive, controller.signal);
    } catch (error) {
      if (!detachedByUser && !completed) showConnectionHelp();
      throw error;
    }
    await work;
    if (!completed && !detachedByUser) {
      showConnectionHelp();
      throw new Error(
        json
          ? "会话连接已关闭，请使用 resume 重新连接。"
          : `任务 ${taskId} 的会话连接已关闭，当前执行状态未确认。`,
      );
    }
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
    if (!json && lastTurn?.status === "failed") {
      const failure = getSessionFailure(lastTurn.error);
      output(
        {},
        `${failure?.title ?? "本轮执行失败"}：${failure?.message ?? "未记录具体错误原因。"}\n`,
      );
      output(
        {},
        `建议：${failure?.guidance ?? "先检查已有文件、诊断和交付记录，再决定后续操作。"}\n`,
      );
      if (failure?.details) output({}, `原始错误：${failure.details}\n`);
      showRecordedWork(snapshot);
      output({}, `${inspectionCommands(taskId)}\n`);
      if (failure?.canContinue)
        output({}, `稍后继续原任务：${continuationCommand(taskId)}；任务空闲时会继续执行。\n`);
    } else if (!json && lastTurn?.status === "interrupted") {
      output({}, "本轮已中断，不等同于执行失败。请先核对已有文件和未完成工作；不会自动继续。\n");
      showRecordedWork(snapshot);
      output({}, `${inspectionCommands(taskId)}\n`);
    }
    return exitCode;
  } finally {
    rl.close();
    process.removeListener("SIGINT", detach);
    controller.abort();
  }
}
