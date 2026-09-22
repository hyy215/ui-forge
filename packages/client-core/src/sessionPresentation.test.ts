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
