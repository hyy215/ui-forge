import { expect, it } from "vitest";
import type { NativeNotification, SessionEvent, SessionSnapshot } from "@ui-forge/shared-protocol";
import type { PendingRequest } from "@ui-forge/codex-client";
import { thread, approval } from "../../../../packages/codex-client/src/testing/payloads.js";
import { applySessionEvent, emptyPresentation, requestItem } from "@ui-forge/client-core";
import { SessionEventHub } from "./sessionEventHub.js";

const initial: SessionSnapshot = { thread, pendingRequests: [] };
const client = { pendingRequests: (): PendingRequest[] => [] };
const turn = { id: "turn", status: "inProgress", items: [], error: null };
const notification = (
  method: string,
  params: NativeNotification["params"],
): NativeNotification => ({
  method,
  params: { threadId: thread.id, ...params },
});
const events: NativeNotification[] = [
  notification("thread/status/changed", { status: { type: "active" } }),
  notification("turn/started", { turn }),
  notification("item/started", {
    turnId: turn.id,
    item: { id: "message", type: "agentMessage", text: "" },
  }),
  notification("item/agentMessage/delta", { turnId: turn.id, itemId: "message", delta: "hello" }),
  notification("item/agentMessage/delta", { turnId: turn.id, itemId: "message", delta: " world" }),
  notification("item/completed", {
    turnId: turn.id,
    item: { id: "message", type: "agentMessage", text: "hello world!" },
  }),
  notification("item/plan/delta", { turnId: turn.id, itemId: "plan", delta: "Check" }),
  notification("item/plan/delta", { turnId: turn.id, itemId: "plan", delta: " output" }),
  notification("item/started", {
    turnId: turn.id,
    item: { id: "command", type: "commandExecution", aggregatedOutput: "" },
  }),
  notification("item/commandExecution/outputDelta", {
    turnId: turn.id,
    itemId: "command",
    delta: "first\n",
  }),
  notification("item/commandExecution/outputDelta", {
    turnId: turn.id,
    itemId: "command",
    delta: "second\n",
  }),
  notification("item/reasoning/summaryTextDelta", {
    turnId: turn.id,
    itemId: "reasoning",
    summaryIndex: 0,
    delta: "Inspect",
  }),
  notification("item/reasoning/summaryTextDelta", {
    turnId: turn.id,
    itemId: "reasoning",
    summaryIndex: 0,
    delta: " code",
  }),
  notification("item/reasoning/summaryTextDelta", {
    turnId: turn.id,
    itemId: "reasoning",
    summaryIndex: 2,
    delta: "Validate",
  }),
  notification("turn/started", { threadId: "child", turn: { ...turn, id: "child-turn" } }),
  notification("turn/completed", { turn: { ...turn, status: "completed" } }),
  notification("thread/status/changed", { status: { type: "idle" } }),
  notification("turn/started", { turn: { ...turn, id: "next-turn" } }),
  notification("item/agentMessage/delta", {
    turnId: "next-turn",
    itemId: "message",
    delta: "New turn",
  }),
];

it("keeps the server snapshot and Webview conversation identical across every reconnection boundary", async () => {
  const continuous = events.reduce(
    (state, event) => applySessionEvent(state, { type: "notification", notification: event }),
    applySessionEvent(emptyPresentation(), {
      type: "snapshot",
      snapshot: structuredClone(initial),
    }),
  );
  expect(continuous.snapshot?.thread.turns[0]?.items).toEqual([
    { id: "message", type: "agentMessage", text: "hello world!" },
    { id: "plan", type: "plan", text: "Check output" },
    { id: "command", type: "commandExecution", aggregatedOutput: "first\nsecond\n" },
    { id: "reasoning", type: "reasoning", summary: ["Inspect code", "", "Validate"] },
  ]);
  expect(continuous.snapshot?.thread.turns).toHaveLength(2);
  for (let split = 0; split <= events.length; split++) {
    const hub = new SessionEventHub(() => thread.cwd);
    hub.seed(initial.thread);
    hub.onEvent(thread.cwd, {
      type: "notification",
      notification: {
        method: "thread/started",
        params: { thread: { ...thread, id: "child", parentThreadId: thread.id } },
      },
    });
    for (const event of events.slice(0, split))
      hub.onEvent(thread.cwd, { type: "unknownNotification", notification: event });
    const controller = new AbortController();
    const stream = hub
      .subscribe(thread.id, controller.signal, async () => client)
      [Symbol.asyncIterator]();
    try {
      const first = await stream.next();
      if (first.value?.type !== "snapshot") throw new Error("Expected initial snapshot");
      let reconnected = applySessionEvent(emptyPresentation(), first.value);
      const prefix = events.slice(0, split).reduce(
        (state, event) => applySessionEvent(state, { type: "notification", notification: event }),
        applySessionEvent(emptyPresentation(), {
          type: "snapshot",
          snapshot: structuredClone(initial),
        }),
      );
      expect(reconnected.snapshot?.thread, `snapshot at boundary ${split}`).toEqual(
        prefix.snapshot?.thread,
      );
      for (let replay = 0; replay < prefix.activities.length; replay++) {
        const next = await stream.next();
        if (!next.value) throw new Error("Expected replayed activity");
        reconnected = applySessionEvent(reconnected, next.value);
      }
      expect(reconnected.activities).toEqual(prefix.activities);
      for (const event of events.slice(split)) {
        hub.publish(thread.id, { type: "notification", notification: event });
        const next = await stream.next();
        if (!next.value) throw new Error("Expected incremental event");
        reconnected = applySessionEvent(reconnected, next.value);
      }
      expect(reconnected.snapshot?.thread, `conversation after boundary ${split}`).toEqual(
        continuous.snapshot?.thread,
      );
      expect(reconnected.activities).toEqual(continuous.activities);
    } finally {
      controller.abort();
      await stream.return?.();
    }
  }
});

it("includes output and approvals arriving during loading exactly once in the initial snapshot", async () => {
  const hub = new SessionEventHub(() => thread.cwd);
  const controller = new AbortController();
  const pending = { token: "pending", request: approval };
  const stream = hub
    .subscribe(thread.id, controller.signal, async () => {
      hub.seed({ ...thread, turns: [turn] });
      hub.publish(thread.id, {
        type: "notification",
        notification: notification("item/agentMessage/delta", {
          turnId: turn.id,
          itemId: "m",
          delta: "loaded",
        }),
      });
      hub.publish(thread.id, { type: "request", pending });
      return { pendingRequests: () => [pending] };
    })
    [Symbol.asyncIterator]();
  try {
    const first = await stream.next();
    expect(first.value).toMatchObject({
      type: "snapshot",
      snapshot: {
        thread: { turns: [{ items: [{ text: "loaded" }] }] },
        pendingRequests: [pending],
      },
    });
    const resolved: SessionEvent = { type: "resolved", token: pending.token };
    hub.publish(thread.id, resolved);
    expect((await stream.next()).value).toEqual(resolved);
  } finally {
    controller.abort();
    await stream.return?.();
  }
});

it("clears parent associations only for the workspace whose connection has closed", () => {
  const hub = new SessionEventHub(() => thread.cwd);
  const pendingFor = (id: string): PendingRequest => ({
    token: id,
    request: { ...approval, params: { ...approval.params, threadId: id } },
  });
  for (const [id, cwd, parentThreadId] of [
    ["child", "/first", thread.id],
    ["other-child", "/second", "other-parent"],
  ] as const) {
    hub.onEvent(cwd, {
      type: "notification",
      notification: {
        method: "thread/started",
        params: { thread: { ...thread, id, cwd, parentThreadId } },
      },
    });
  }
  expect(hub.requestBelongsTo(pendingFor("child"), thread.id)).toBe(true);
  hub.onEvent("/first", { type: "close", error: new Error("Disconnected") });
  expect(hub.requestBelongsTo(pendingFor("child"), thread.id)).toBe(false);
  expect(hub.requestBelongsTo(pendingFor("other-child"), "other-parent")).toBe(true);
});

it("replays plans, diffs and pending child patches before newer events on reconnect", async () => {
  const hub = new SessionEventHub(() => thread.cwd);
  hub.seed({ ...thread, turns: [turn] });
  hub.onEvent(thread.cwd, {
    type: "notification",
    notification: {
      method: "thread/started",
      params: { thread: { ...thread, id: "child", parentThreadId: thread.id } },
    },
  });
  const pending: PendingRequest = {
    token: "child-approval",
    request: {
      ...approval,
      params: { ...approval.params, threadId: "child", turnId: "child-turn", itemId: "patch" },
    },
  };
  const notifications = [
    notification("turn/plan/updated", {
      turnId: turn.id,
      plan: [{ step: "Build", status: "inProgress" }],
    }),
    notification("turn/diff/updated", { turnId: turn.id, diff: "+current patch" }),
    notification("item/started", {
      threadId: "child",
      turnId: "child-turn",
      item: {
        id: "patch",
        type: "fileChange",
        changes: [{ path: "app.ts", diff: "+change", kind: { type: "update" } }],
      },
    }),
  ];
  for (const value of notifications)
    hub.publish(thread.id, { type: "notification", notification: value });
  hub.publish(thread.id, { type: "request", pending });
  const controller = new AbortController();
  const stream = hub
    .subscribe(thread.id, controller.signal, async () => ({ pendingRequests: () => [pending] }))
    [Symbol.asyncIterator]();
  try {
    const first = await stream.next();
    if (!first.value) throw new Error("Missing snapshot");
    let state = applySessionEvent(emptyPresentation(), first.value);
    const newest: SessionEvent = {
      type: "notification",
      notification: notification("turn/diff/updated", { turnId: turn.id, diff: "+new patch" }),
    };
    hub.publish(thread.id, newest);
    for (const value of notifications) {
      const next = await stream.next();
      expect(next.value).toEqual({ type: "notification", notification: value });
      state = applySessionEvent(state, next.value!);
    }
    expect(state.snapshot?.pendingRequests).toEqual([pending]);
    expect(requestItem(state, pending)?.changes).toEqual([
      { path: "app.ts", diff: "+change", kind: { type: "update" } },
    ]);
    expect((await stream.next()).value).toEqual(newest);
  } finally {
    controller.abort();
    await stream.return?.();
  }
});
