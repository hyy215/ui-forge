import { afterEach, expect, it, vi } from "vitest";
import { sessionMethods, type SessionSnapshot } from "@ui-forge/shared-protocol";
import { getSessionFailure, summarizeRecordedWork } from "@ui-forge/client-core";
import { LocalClient } from "./client.js";
import { watchTask } from "./taskSession.js";

const terminal = vi.hoisted(() => ({
  line: undefined as ((line: string) => void) | undefined,
  interrupt: undefined as ((line: string) => void) | undefined,
  close: vi.fn(),
}));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    on(event: string, listener: (line: string) => void) {
      if (event === "line") terminal.line = listener;
      if (event === "SIGINT") terminal.interrupt = listener;
    },
    close: terminal.close,
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  terminal.line = undefined;
  terminal.interrupt = undefined;
  terminal.close.mockClear();
});

const snapshot: SessionSnapshot = {
  thread: {
    id: "parent",
    cwd: "/tmp",
    name: null,
    preview: "task",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "active" },
    turns: [{ id: "parent-turn", status: "inProgress", items: [], error: null }],
  },
  pendingRequests: [],
};

function captureOutput(): string[] {
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  return output;
}

function terminalSnapshot(status: "completed" | "failed" | "interrupted"): SessionSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      status: { type: "idle" },
      turns: [{ id: "parent-turn", status, items: [], error: null }],
    },
  };
}

it("ignores child lifecycle events for stop and exit while retaining child interaction requests", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (method, _params, schema) =>
      schema.parse(method === sessionMethods.read ? snapshot : { accepted: true }),
    );
  vi.spyOn(client, "subscribe").mockImplementation(async (_taskId, receive, signal) => {
    receive({ type: "snapshot", snapshot });
    receive({
      type: "notification",
      notification: {
        method: "turn/started",
        params: { threadId: "child", turn: { id: "child-turn", status: "inProgress" } },
      },
    });
    receive({
      type: "request",
      pending: {
        token: "child-request",
        request: {
          id: 1,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "child" },
        },
      },
    });
    terminal.line?.("/stop");
    terminal.line?.("/reject");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(request).toHaveBeenCalledWith(
      sessionMethods.stop,
      { taskId: "parent", turnId: "parent-turn" },
      expect.anything(),
    );
    expect(request).toHaveBeenCalledWith(
      sessionMethods.respond,
      { taskId: "parent", token: "child-request", result: { decision: "decline" } },
      expect.anything(),
    );
    receive({
      type: "notification",
      notification: {
        method: "turn/completed",
        params: { threadId: "child", turn: { id: "child-turn", status: "completed" } },
      },
    });
    expect(signal.aborted).toBe(false);
    receive({
      type: "notification",
      notification: {
        method: "turn/completed",
        params: { threadId: "parent", turn: { id: "parent-turn", status: "failed" } },
      },
    });
    expect(signal.aborted).toBe(true);
  });
  expect(await watchTask(client, snapshot, false)).toBe(1);
  expect(terminal.close).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "reports capacity failure without sending another turn (json=%s)",
  async (json) => {
    const failed: SessionSnapshot = {
      ...snapshot,
      thread: {
        ...snapshot.thread,
        status: { type: "idle" },
        turns: [
          {
            id: "parent-turn",
            status: "failed",
            items: [],
            error: {
              message: "Selected model is at capacity.",
              codexErrorInfo: "serverOverloaded",
            },
          },
        ],
      },
    };
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const client = new LocalClient();
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (_method, _params, schema) => schema.parse(failed));
    vi.spyOn(client, "subscribe").mockImplementation(async (_taskId, receive) => {
      receive({ type: "snapshot", snapshot: failed });
    });
    expect(await watchTask(client, failed, json)).toBe(1);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.read,
      { taskId: "parent" },
      expect.anything(),
    );
    if (json) {
      const values: unknown[] = output.map((line) => JSON.parse(line));
      expect(values).toEqual([
        { type: "task", taskId: "parent" },
        { type: "event", taskId: "parent", event: { type: "snapshot", snapshot: failed } },
        { type: "result", snapshot: failed },
      ]);
    } else {
      expect(output.join("")).toContain("模型暂时繁忙");
      expect(output.join("")).toContain("Selected model is at capacity.");
      expect(output.join("")).toContain("ui-forge resume parent");
    }
  },
);

it.each([null, { message: "Request limit reached", codexErrorInfo: "rateLimitExceeded" }])(
  "shows failed-task recovery guidance even when error details are missing: %j",
  async (error) => {
    const failed = terminalSnapshot("failed");
    const turn = failed.thread.turns[0];
    if (!turn) throw new Error("Missing fixture turn");
    turn.error = error;
    turn.items = [
      {
        id: "command-1",
        type: "commandExecution",
        status: "completed",
        exitCode: 0,
        command: "private command",
        aggregatedOutput: "private output",
      },
      {
        id: "change-1",
        type: "fileChange",
        status: "completed",
        changes: [{ path: "src/App.tsx", diff: "private diff" }],
      },
    ];
    const output = captureOutput();
    const client = new LocalClient();
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (_method, _params, schema) => schema.parse(failed));
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
      receive({ type: "snapshot", snapshot: failed });
    });
    expect(await watchTask(client, failed, false)).toBe(1);
    expect(output.join("")).toContain("建议：");
    if (error) {
      const failure = getSessionFailure(error);
      expect(output.join("")).toContain(failure?.guidance);
      expect(output.join("")).toContain("原始错误：Request limit reached");
    } else {
      expect(output.join("")).toContain("未记录具体错误原因");
      expect(output.join("")).not.toContain("原始错误：");
    }
    expect(output.join("")).toContain(summarizeRecordedWork(failed.thread.turns));
    expect(output.join("")).not.toContain("private command");
    expect(output.join("")).not.toContain("private output");
    expect(output.join("")).not.toContain("private diff");
    expect(output.join("")).toContain("ui-forge status parent");
    expect(output.join("")).toContain("ui-forge diagnostics parent");
    expect(output.join("")).toContain("ui-forge delivery parent");
    expect(output.join("")).not.toContain("ui-forge resume parent");
    expect(request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.read,
      { taskId: "parent" },
      expect.anything(),
    );
  },
);

it("explains interruption without labelling it as an execution failure or sending a continuation", async () => {
  const interrupted = terminalSnapshot("interrupted");
  const output = captureOutput();
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (_method, _params, schema) => schema.parse(interrupted));
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
    receive({ type: "snapshot", snapshot: interrupted });
  });
  expect(await watchTask(client, interrupted, false)).toBe(1);
  expect(output.join("")).toContain("本轮已中断，不等同于执行失败");
  expect(output.join("")).toContain("核对已有文件和未完成工作");
  expect(output.join("")).toContain("ui-forge delivery parent");
  expect(output.join("")).not.toContain("本轮执行失败：");
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["ended", "thrown"] as const)(
  "keeps task identity and read-only inspection guidance after a %s subscription",
  async (mode) => {
    const output = captureOutput();
    const client = new LocalClient();
    const request = vi.spyOn(client, "request");
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
      receive({ type: "snapshot", snapshot });
      if (mode === "thrown") throw new Error("网络连接不可用");
      receive({ type: "close", message: "本机连接已关闭" });
    });
    await expect(watchTask(client, snapshot, false)).rejects.toThrow();
    const text = output.join("");
    expect(text).toContain("任务 parent 的连接已中断");
    expect(text).toContain("当前执行状态未确认；不会自动重试");
    expect(text).toContain("ui-forge status parent");
    expect(text).toContain("ui-forge diagnostics parent");
    expect(text).toContain("ui-forge delivery parent");
    expect(text).toContain("ui-forge resume parent；任务空闲时会继续执行，不是只读重连");
    expect(text).not.toContain("使用 resume 重新连接");
    expect(request).not.toHaveBeenCalled();
    expect(terminal.close).toHaveBeenCalledOnce();
  },
);

it.each(["detached", "completed"] as const)(
  "does not label an abort after %s as a connection failure",
  async (mode) => {
    const output = captureOutput();
    const client = new LocalClient();
    const request = vi.spyOn(client, "request");
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
      receive({ type: "snapshot", snapshot });
      if (mode === "detached") terminal.interrupt?.("");
      else {
        receive({
          type: "notification",
          notification: {
            method: "turn/completed",
            params: { threadId: "parent", turn: { id: "parent-turn", status: "completed" } },
          },
        });
      }
      expect(signal.aborted).toBe(true);
      throw new Error("subscription aborted");
    });
    await expect(watchTask(client, snapshot, false)).rejects.toThrow("subscription aborted");
    expect(output.join("")).not.toContain("连接已中断，当前执行状态未确认");
    expect(output.join("")).not.toContain("不是只读重连");
    expect(request).not.toHaveBeenCalled();
    expect(terminal.close).toHaveBeenCalledOnce();
  },
);

it("includes completed tool records observed before disconnection without querying or executing", async () => {
  const output = captureOutput();
  const client = new LocalClient();
  const request = vi.spyOn(client, "request");
  const items: SessionSnapshot["thread"]["turns"][number]["items"] = [
    {
      id: "observed-command",
      type: "commandExecution",
      status: "completed",
      exitCode: 0,
      command: "private command",
      aggregatedOutput: "private result",
    },
    {
      id: "observed-change",
      type: "fileChange",
      status: "completed",
      changes: [{ path: "src/App.tsx", diff: "private diff" }],
    },
  ];
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
    receive({ type: "snapshot", snapshot });
    for (const item of items) {
      receive({
        type: "notification",
        notification: {
          method: "item/completed",
          params: { threadId: "parent", turnId: "parent-turn", item },
        },
      });
    }
    expect(signal.aborted).toBe(false);
    receive({ type: "close", message: "connection closed" });
  });
  await expect(watchTask(client, snapshot, false)).rejects.toThrow("会话连接已关闭");
  expect(output.join("")).toContain(
    summarizeRecordedWork([{ id: "parent-turn", status: "inProgress", error: null, items }]),
  );
  expect(output.join("")).toContain("1 条命令成功退出，1 条已完成文件变更");
  expect(output.join("")).toContain("不代表当前文件状态或验收通过");
  expect(request).not.toHaveBeenCalled();
});

it.each([
  ["parent", "parent-turn", true, true],
  ["child", "parent-turn", true, false],
  ["parent", "old-turn", true, false],
  ["parent", undefined, true, false],
  ["parent", "parent-turn", false, false],
] as const)(
  "only labels a matching native retry and never sends a retry: %s %s %s",
  async (threadId, turnId, willRetry, expectedHint) => {
    const output = captureOutput();
    const finished = terminalSnapshot("completed");
    const client = new LocalClient();
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (_method, _params, schema) => schema.parse(finished));
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
      receive({ type: "snapshot", snapshot });
      receive({
        type: "notification",
        notification: {
          method: "error",
          params: {
            threadId,
            ...(turnId ? { turnId } : {}),
            willRetry,
            error: { message: "transient capacity error" },
          },
        },
      });
      expect(signal.aborted).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(output.join("").includes("Codex 正在重试")).toBe(expectedHint);
      if (expectedHint) expect(output.join("")).not.toContain("transient capacity error");
      receive({
        type: "notification",
        notification: {
          method: "turn/completed",
          params: { threadId: "parent", turn: { id: "parent-turn", status: "completed" } },
        },
      });
    });
    expect(await watchTask(client, snapshot, false)).toBe(0);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.read,
      { taskId: "parent" },
      expect.anything(),
    );
  },
);

it("does not claim native retry while the current main-thread turn is unknown", async () => {
  const output = captureOutput();
  const finished = terminalSnapshot("completed");
  const client = new LocalClient();
  vi.spyOn(client, "request").mockImplementation(async (_method, _params, schema) =>
    schema.parse(finished),
  );
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
    receive({
      type: "notification",
      notification: {
        method: "error",
        params: {
          threadId: "parent",
          turnId: "parent-turn",
          willRetry: true,
          error: { message: "retry" },
        },
      },
    });
    expect(output.join("")).not.toContain("Codex 正在重试");
    expect(signal.aborted).toBe(false);
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, snapshot, false)).toBe(0);
});

it.each([false, true])(
  "preserves retry events in JSON while filtering human controls (json=%s)",
  async (json) => {
    const output = captureOutput();
    const failed = terminalSnapshot("failed");
    const turn = failed.thread.turns[0];
    if (!turn) throw new Error("Missing fixture turn");
    const unsafe = "\u001b[31m原始错误\u001b[0m\r\b\u001b]52;c;c2VjcmV0\u0007";
    turn.error = { message: unsafe, codexErrorInfo: "serverOverloaded" };
    turn.items = [{ id: "message-1", type: "agentMessage", text: unsafe }];
    const client = new LocalClient();
    vi.spyOn(client, "request").mockImplementation(async (_method, _params, schema) =>
      schema.parse(failed),
    );
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
      receive({ type: "snapshot", snapshot });
      receive({
        type: "notification",
        notification: {
          method: "error",
          params: {
            threadId: "parent",
            turnId: "parent-turn",
            willRetry: true,
            error: { message: unsafe },
          },
        },
      });
      receive({
        type: "notification",
        notification: { method: "item/agentMessage/delta", params: { delta: unsafe } },
      });
      receive({
        type: "notification",
        notification: { method: "item/commandExecution/outputDelta", params: { delta: unsafe } },
      });
      receive({ type: "diagnostic", message: unsafe });
      receive({ type: "snapshot", snapshot: failed });
    });
    expect(await watchTask(client, snapshot, json)).toBe(1);
    if (json) {
      const values: unknown[] = output.map((line) => JSON.parse(line));
      expect(values).toContainEqual({ type: "result", snapshot: failed });
      expect(values).toContainEqual({
        type: "event",
        taskId: "parent",
        event: {
          type: "notification",
          notification: {
            method: "error",
            params: {
              threadId: "parent",
              turnId: "parent-turn",
              willRetry: true,
              error: { message: unsafe },
            },
          },
        },
      });
      expect(values).toHaveLength(8);
    } else {
      expect(output.join("")).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
      expect(output.join("")).toContain("原始错误");
      expect(output.join("")).not.toContain("c2VjcmV0");
    }
  },
);

it.each([false, true])(
  "acknowledges only successful human approval replies (failed=%s)",
  async (rejected) => {
    const output = captureOutput();
    const finished = terminalSnapshot("completed");
    const client = new LocalClient();
    const request = vi
      .spyOn(client, "request")
      .mockImplementation(async (method, _params, schema) => {
        if (method === sessionMethods.respond && rejected)
          throw new Error("\u001b[31m回复未确认\u001b[0m");
        return schema.parse(method === sessionMethods.read ? finished : { accepted: true });
      });
    vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
      receive({ type: "snapshot", snapshot });
      receive({
        type: "request",
        pending: {
          token: "approval",
          request: {
            id: 1,
            method: "item/commandExecution/requestApproval",
            params: { threadId: "parent" },
          },
        },
      });
      terminal.line?.("/reject");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(request).toHaveBeenCalledExactlyOnceWith(
        sessionMethods.respond,
        { taskId: "parent", token: "approval", result: { decision: "decline" } },
        expect.anything(),
      );
      if (rejected) {
        expect(output.join("")).toContain("操作未确认：回复未确认");
        expect(output.join("")).not.toContain("决议已提交");
      } else {
        expect(output.join("")).toContain("拒绝决议已提交；不代表任务已停止或操作已执行");
      }
      receive({
        type: "notification",
        notification: {
          method: "turn/completed",
          params: { threadId: "parent", turn: { id: "parent-turn", status: "completed" } },
        },
      });
    });
    expect(await watchTask(client, snapshot, false)).toBe(0);
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it("shows only local status and keeps unknown observations unknown", async () => {
  const output = captureOutput();
  const finished = terminalSnapshot("completed");
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (_method, _params, schema) => schema.parse(finished));
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("未连接，以下为最近记录");
    receive({ type: "snapshot", snapshot });
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：运行中；连接：已连接");
    expect(output.at(-1)).toContain("本轮原生耗时：未知");
    expect(output.at(-1)).toContain("本连接最近主线程事件接收时间：尚未观测到");
    expect(output.at(-1)).toContain("主线程累计 Token（本连接最后观测）：未知");
    expect(output.at(-1)).toContain("Token 观测时间：未知");
    expect(output.at(-1)).toContain("不代表当前工具有进展或验收通过");
    expect(request).not.toHaveBeenCalled();
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, snapshot, false)).toBe(0);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    sessionMethods.read,
    { taskId: "parent" },
    expect.anything(),
  );
});

it("shows native elapsed time and last primary cumulative tokens without adding duplicate or child usage", async () => {
  const base = Date.parse("2026-09-23T08:00:10Z");
  let now = base;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const timed: SessionSnapshot = {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      turns: [
        {
          id: "parent-turn",
          status: "inProgress",
          items: [],
          error: null,
          startedAt: base / 1000 - 5,
        },
      ],
    },
  };
  const output = captureOutput();
  const finished = terminalSnapshot("completed");
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (_method, _params, schema) => schema.parse(finished));
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("本轮原生耗时：未知");
    receive({ type: "snapshot", snapshot: timed });
    const beforeTokens = output.length;
    for (const [threadId, totalTokens] of [
      ["parent", 100],
      ["parent", 120],
      ["parent", 120],
      ["child", 500],
    ] as const) {
      now += 1000;
      receive({
        type: "notification",
        notification: {
          method: "thread/tokenUsage/updated",
          params: { threadId, tokenUsage: { total: { totalTokens } } },
        },
      });
    }
    expect(output).toHaveLength(beforeTokens);
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("本轮原生耗时：9秒");
    expect(output.at(-1)).toContain(
      "主线程累计 Token（本连接最后观测）：120；不是本轮用量、费用或预算",
    );
    expect(output.at(-1)).toContain("本连接最近主线程事件接收时间：2026-09-23T08:00:13.000Z");
    expect(output.at(-1)).toContain("Token 观测时间：2026-09-23T08:00:12.000Z");
    expect(request).not.toHaveBeenCalled();
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, timed, false)).toBe(0);
});

it.each([
  ["waitingOnApproval", "等待审批"],
  ["waitingOnUserInput", "等待输入"],
] as const)("shows native %s before generic running status", async (flag, label) => {
  const output = captureOutput();
  const finished = terminalSnapshot("completed");
  const waiting: SessionSnapshot = {
    ...snapshot,
    thread: { ...snapshot.thread, status: { type: "active", activeFlags: [flag] } },
  };
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (_method, _params, schema) => schema.parse(finished));
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
    receive({ type: "snapshot", snapshot: waiting });
    terminal.line?.("/status");
    expect(output.at(-1)).toContain(`当前记录状态：${label}`);
    receive({
      type: "request",
      pending: {
        token: "pending",
        request: {
          id: 1,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "parent" },
        },
      },
    });
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：等待处理 1 个请求");
    expect(request).not.toHaveBeenCalled();
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, snapshot, false)).toBe(0);
});

it("does not advance active elapsed time after disconnection", async () => {
  const now = Date.parse("2026-09-23T08:00:10Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  const timed: SessionSnapshot = {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      turns: [
        {
          id: "parent-turn",
          status: "inProgress",
          items: [],
          error: null,
          startedAt: now / 1000 - 5,
        },
      ],
    },
  };
  const output = captureOutput();
  const client = new LocalClient();
  const request = vi.spyOn(client, "request");
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive) => {
    receive({ type: "snapshot", snapshot: timed });
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("本轮原生耗时：5秒");
    receive({ type: "close", message: "lost connection" });
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("未连接，以下为最近记录");
    expect(output.at(-1)).toContain("本轮原生耗时：未知");
    expect(request).not.toHaveBeenCalled();
  });
  await expect(watchTask(client, timed, false)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it("shows local status during a pending stop response and waits for native termination after acceptance", async () => {
  const output = captureOutput();
  const finished = terminalSnapshot("interrupted");
  let releaseStop: (() => void) | undefined;
  const pendingStop = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (method, _params, schema) => {
      if (method === sessionMethods.stop) await pendingStop;
      return schema.parse(method === sessionMethods.read ? finished : { accepted: true });
    });
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
    receive({ type: "snapshot", snapshot });
    terminal.line?.("/stop");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.stop,
      { taskId: "parent", turnId: "parent-turn" },
      expect.anything(),
    );
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：运行中");
    expect(output.join("")).not.toContain("停止请求已提交");
    expect(signal.aborted).toBe(false);
    releaseStop?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.at(-1)).toContain("停止请求已提交，等待原生状态确认");
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：运行中");
    expect(signal.aborted).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    receive({ type: "snapshot", snapshot: finished });
    expect(signal.aborted).toBe(true);
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：本轮已中断");
  });
  expect(await watchTask(client, snapshot, false)).toBe(1);
  expect(request).toHaveBeenCalledTimes(2);
});

it("keeps a failed stop unconfirmed without acknowledging or retrying it", async () => {
  const output = captureOutput();
  const finished = terminalSnapshot("completed");
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (method, _params, schema) => {
      if (method === sessionMethods.stop) throw new Error("stop unavailable");
      return schema.parse(finished);
    });
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
    receive({ type: "snapshot", snapshot });
    terminal.line?.("/stop");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.join("")).toContain("操作未确认：stop unavailable");
    expect(output.join("")).not.toContain("停止请求已提交");
    terminal.line?.("/status");
    expect(output.at(-1)).toContain("当前记录状态：运行中");
    expect(signal.aborted).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, snapshot, false)).toBe(0);
  expect(request).toHaveBeenCalledTimes(2);
});

it("keeps JSON status shorthand invalid and emits no new stop acknowledgement or status event", async () => {
  const output = captureOutput();
  const finished = terminalSnapshot("interrupted");
  const client = new LocalClient();
  const request = vi
    .spyOn(client, "request")
    .mockImplementation(async (method, _params, schema) =>
      schema.parse(method === sessionMethods.read ? finished : { accepted: true }),
    );
  vi.spyOn(client, "subscribe").mockImplementation(async (_id, receive, signal) => {
    receive({ type: "snapshot", snapshot });
    terminal.line?.("/status");
    terminal.line?.(JSON.stringify({ type: "stop", turnId: "parent-turn" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(request).toHaveBeenCalledExactlyOnceWith(
      sessionMethods.stop,
      { taskId: "parent", turnId: "parent-turn" },
      expect.anything(),
    );
    expect(signal.aborted).toBe(false);
    receive({ type: "snapshot", snapshot: finished });
  });
  expect(await watchTask(client, snapshot, true)).toBe(1);
  expect(output.map((line) => JSON.parse(line))).toEqual([
    { type: "task", taskId: "parent" },
    { type: "event", taskId: "parent", event: { type: "snapshot", snapshot } },
    { type: "input-error", message: expect.any(String) },
    { type: "event", taskId: "parent", event: { type: "snapshot", snapshot: finished } },
    { type: "result", snapshot: finished },
  ]);
  expect(request).toHaveBeenCalledTimes(2);
});
