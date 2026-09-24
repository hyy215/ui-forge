import { expect, it } from "vitest";
import type { SessionSnapshot } from "@ui-forge/shared-protocol";
import { applySessionEvent, emptyPresentation, requestItem } from "./sessionPresentation.js";
const snapshot: SessionSnapshot = {
  thread: {
    id: "t",
    cwd: "/tmp",
    preview: "test",
    name: null,
    createdAt: 1,
    updatedAt: 1,
    status: { type: "active" },
    turns: [
      {
        id: "turn",
        status: "inProgress",
        error: null,
        items: [{ id: "message", type: "agentMessage", text: "hello" }],
      },
    ],
  },
  pendingRequests: [],
};
it("merges deltas by native item ID and keeps output when completion omits items", () => {
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "item/agentMessage/delta",
      params: { threadId: "t", turnId: "turn", itemId: "message", delta: " world" },
    },
  });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "turn/completed",
      params: { threadId: "t", turn: { id: "turn", status: "completed", items: [], error: null } },
    },
  });
  expect(state.snapshot?.thread.turns[0]?.items[0]?.text).toBe("hello world");
  expect(state.snapshot?.thread.turns[0]?.status).toBe("completed");
  expect(state.snapshot?.thread).not.toHaveProperty("acceptance");
});
it("preserves unknown activity and invalidates approvals on connection loss", () => {
  const pending = {
    token: "a",
    request: { id: 1, method: "item/fileChange/requestApproval", params: { threadId: "t" } },
  };
  let state = applySessionEvent(emptyPresentation(), {
    type: "snapshot",
    snapshot: { ...snapshot, pendingRequests: [pending] },
  });
  state = applySessionEvent(state, {
    type: "notification",
    notification: { method: "future/event", params: { value: 3 } },
  });
  expect(state.activities[0]?.params).toEqual({ value: 3 });
  state = applySessionEvent(state, { type: "close", message: "Disconnected" });
  expect(state.snapshot?.pendingRequests).toEqual([]);
});
it("preserves a completed turn's structured capacity error and existing output", () => {
  const error = {
    message: "Selected model is at capacity. Please try a different model.",
    codexErrorInfo: "serverOverloaded",
    additionalDetails: null,
  };
  const state = applySessionEvent(
    applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot }),
    {
      type: "notification",
      notification: {
        method: "turn/completed",
        params: {
          threadId: "t",
          turn: { id: "turn", status: "failed", items: [], error },
        },
      },
    },
  );
  expect(state.snapshot?.thread.turns[0]).toMatchObject({
    status: "failed",
    error,
    items: snapshot.thread.turns[0]?.items,
  });
  const reconnected = applySessionEvent(emptyPresentation(), {
    type: "snapshot",
    snapshot: state.snapshot ?? snapshot,
  });
  expect(reconnected.snapshot?.thread.turns[0]?.error).toEqual(error);
});
it("does not merge a child agent turn into the parent conversation", () => {
  const state = applySessionEvent(
    applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot }),
    {
      type: "notification",
      notification: {
        method: "turn/started",
        params: {
          threadId: "child",
          turn: { id: "child-turn", status: "inProgress", items: [], error: null },
        },
      },
    },
  );
  expect(state.snapshot?.thread.turns).toHaveLength(1);
  expect(state.activities).toHaveLength(1);
});
it("keeps only the newest full diff per turn while preserving other turns", () => {
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot });
  for (const diff of ["first", "second", "latest"])
    state = applySessionEvent(state, {
      type: "notification",
      notification: {
        method: "turn/diff/updated",
        params: { threadId: "t", turnId: "turn", diff },
      },
    });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "turn/diff/updated",
      params: { threadId: "t", turnId: "other", diff: "other diff" },
    },
  });
  expect(state.activities).toHaveLength(2);
  expect(state.activities[0]?.params).toMatchObject({ diff: "latest" });
});
it("updates child tool items in place instead of duplicating started and completed cards", () => {
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot });
  for (const method of ["item/started", "item/completed"])
    state = applySessionEvent(state, {
      type: "notification",
      notification: {
        method,
        params: {
          threadId: "child",
          turnId: "ct",
          item: {
            id: "cmd",
            type: "commandExecution",
            status: method === "item/started" ? "inProgress" : "completed",
          },
        },
      },
    });
  expect(state.activities).toHaveLength(1);
  expect(state.activities[0]?.params).toMatchObject({ item: { status: "completed" } });
});
it("associates approval previews with the correct child thread", () => {
  const state = applySessionEvent(
    applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot }),
    {
      type: "notification",
      notification: {
        method: "item/started",
        params: {
          threadId: "child",
          turnId: "turn",
          item: { id: "message", type: "fileChange", changes: [] },
        },
      },
    },
  );
  const pending = {
    token: "child-request",
    request: {
      id: 1,
      method: "item/fileChange/requestApproval",
      params: { threadId: "child", turnId: "turn", itemId: "message" },
    },
  };
  expect(requestItem(state, pending)?.type).toBe("fileChange");
  expect(
    requestItem(state, {
      ...pending,
      request: { ...pending.request, params: { ...pending.request.params, threadId: "other" } },
    }),
  ).toBeUndefined();
});
it("clears resolved child approvals from the parent UI instead of retaining a stale prompt", () => {
  const pending = {
    token: "child-token",
    request: {
      id: 42,
      method: "mcpServer/elicitation/request",
      params: { threadId: "child", turnId: "child-turn" },
    },
  };
  let state = applySessionEvent(emptyPresentation(), {
    type: "snapshot",
    snapshot: { ...snapshot, pendingRequests: [pending] },
  });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "serverRequest/resolved",
      params: { threadId: "child", requestId: 42 },
    },
  });
  expect(state.snapshot?.pendingRequests).toEqual([]);
});

it("retains a pending child patch across the activity limit and replaces stale activity on snapshot", () => {
  const pending = {
    token: "patch-request",
    request: {
      id: 10,
      method: "item/fileChange/requestApproval",
      params: { threadId: "child", turnId: "ct", itemId: "patch" },
    },
  };
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "item/started",
      params: {
        threadId: "child",
        turnId: "ct",
        item: { id: "patch", type: "fileChange", changes: [] },
      },
    },
  });
  state = applySessionEvent(state, { type: "request", pending });
  for (let i = 0; i < 100; i++)
    state = applySessionEvent(state, {
      type: "notification",
      notification: { method: "future/event", params: { i } },
    });
  expect(state.activities).toHaveLength(81);
  expect(requestItem(state, pending)?.type).toBe("fileChange");
  state = applySessionEvent(state, { type: "snapshot", snapshot });
  expect(state.activities).toEqual([]);
});

function snapshotWithHistory(): SessionSnapshot {
  const value = structuredClone(snapshot);
  value.thread.turns.unshift({
    id: "history",
    status: "completed",
    error: null,
    items: [
      {
        id: "history-message",
        type: "agentMessage",
        text: "Original history",
        status: "completed",
      },
      {
        id: "history-command",
        type: "commandExecution",
        status: "completed",
        aggregatedOutput: "Original result",
        exitCode: 0,
      },
    ],
  });
  value.thread.turns[1]!.items.push(
    {
      id: "command",
      type: "commandExecution",
      status: "inProgress",
      aggregatedOutput: "first",
    },
    { id: "unchanged-user", type: "userMessage", content: [{ type: "text", text: "Keep this" }] },
  );
  return value;
}

it.each([
  {
    method: "item/agentMessage/delta",
    itemId: "message",
    index: 0,
    field: "text",
    expected: "hello world",
  },
  {
    method: "item/commandExecution/outputDelta",
    itemId: "command",
    index: 1,
    field: "aggregatedOutput",
    expected: "first world",
  },
])(
  "replaces only the target item and turn for $method without mutating history",
  ({ method, itemId, index, field, expected }) => {
    const initial = snapshotWithHistory();
    const before = structuredClone(initial);
    const history = initial.thread.turns[0]!;
    const active = initial.thread.turns[1]!;
    const previous = applySessionEvent(emptyPresentation(), {
      type: "snapshot",
      snapshot: initial,
    });
    const next = applySessionEvent(previous, {
      type: "notification",
      notification: {
        method,
        params: { threadId: "t", turnId: "turn", itemId, delta: " world" },
      },
    });
    expect(next.snapshot).not.toBe(previous.snapshot);
    expect(next.snapshot?.thread).not.toBe(initial.thread);
    expect(next.snapshot?.thread.turns).not.toBe(initial.thread.turns);
    expect(next.snapshot?.thread.turns[0]).toBe(history);
    expect(next.snapshot?.thread.turns[0]?.items).toBe(history.items);
    for (const [position, item] of history.items.entries())
      expect(next.snapshot?.thread.turns[0]?.items[position]).toBe(item);
    const updated = next.snapshot?.thread.turns[1];
    expect(updated).not.toBe(active);
    expect(updated?.items).not.toBe(active.items);
    expect(updated?.items[index]).not.toBe(active.items[index]);
    expect(updated?.items[index]?.[field]).toBe(expected);
    for (const [position, item] of active.items.entries())
      if (position !== index) expect(updated?.items[position]).toBe(item);
    expect(previous.snapshot).toBe(initial);
    expect(initial).toEqual(before);
  },
);

it("replaces completed historical items when native completion corrects their content or status", () => {
  const initial = snapshotWithHistory();
  const before = structuredClone(initial);
  const history = initial.thread.turns[0]!;
  const active = initial.thread.turns[1]!;
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot: initial });
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "item/completed",
      params: {
        threadId: "t",
        turnId: "history",
        item: {
          id: "history-message",
          type: "agentMessage",
          text: "Corrected history",
          status: "completed",
        },
      },
    },
  });
  const updatedMessage = state.snapshot?.thread.turns[0]?.items[0];
  expect(updatedMessage).not.toBe(history.items[0]);
  expect(updatedMessage?.text).toBe("Corrected history");
  expect(state.snapshot?.thread.turns[0]).not.toBe(history);
  expect(state.snapshot?.thread.turns[0]?.items[1]).toBe(history.items[1]);
  expect(state.snapshot?.thread.turns[1]).toBe(active);
  state = applySessionEvent(state, {
    type: "notification",
    notification: {
      method: "item/completed",
      params: {
        threadId: "t",
        turnId: "history",
        item: {
          id: "history-command",
          type: "commandExecution",
          status: "failed",
          aggregatedOutput: "Corrected failure result",
          exitCode: 1,
        },
      },
    },
  });
  expect(state.snapshot?.thread.turns[0]?.status).toBe("completed");
  expect(state.snapshot?.thread.turns[0]?.items[0]).toBe(updatedMessage);
  expect(state.snapshot?.thread.turns[0]?.items[1]).not.toBe(history.items[1]);
  expect(state.snapshot?.thread.turns[0]?.items[1]).toMatchObject({
    status: "failed",
    aggregatedOutput: "Corrected failure result",
    exitCode: 1,
  });
  expect(state.snapshot?.thread.turns[1]).toBe(active);
  expect(initial).toEqual(before);
});

it("accepts changed content from a complete snapshot even when turn and item IDs are unchanged", () => {
  const initial = snapshotWithHistory();
  const before = structuredClone(initial);
  const previous = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot: initial });
  const replacement = structuredClone(initial);
  replacement.thread.turns[0]!.items[0]!.text = "History refreshed from native snapshot";
  replacement.thread.turns[1]!.items[0]!.text = "Active message refreshed from native snapshot";
  const state = applySessionEvent(previous, { type: "snapshot", snapshot: replacement });
  expect(state.snapshot).not.toBe(previous.snapshot);
  for (const index of [0, 1]) {
    expect(state.snapshot?.thread.turns[index]?.id).toBe(initial.thread.turns[index]?.id);
    expect(state.snapshot?.thread.turns[index]).not.toBe(initial.thread.turns[index]);
    expect(state.snapshot?.thread.turns[index]?.items[0]?.id).toBe(
      initial.thread.turns[index]?.items[0]?.id,
    );
    expect(state.snapshot?.thread.turns[index]?.items[0]).not.toBe(
      initial.thread.turns[index]?.items[0],
    );
  }
  expect(state.snapshot?.thread.turns[0]?.items[0]?.text).toBe(
    "History refreshed from native snapshot",
  );
  expect(state.snapshot?.thread.turns[1]?.items[0]?.text).toBe(
    "Active message refreshed from native snapshot",
  );
  expect(initial).toEqual(before);
});
