import { expect, it } from "vitest";
import type { NativeNotification, SessionSnapshot } from "@ui-forge/shared-protocol";
import { applySessionEvent, emptyPresentation } from "./sessionPresentation.js";

const snapshot: SessionSnapshot = {
  thread: {
    id: "main",
    cwd: "/tmp",
    name: null,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "active" },
    turns: [{ id: "turn", status: "inProgress", error: null, items: [] }],
  },
  pendingRequests: [],
};
function retryState() {
  let state = applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot });
  for (const [threadId, turnId, willRetry] of [
    ["main", "turn", true],
    ["main", "turn", false],
    ["child", "turn", true],
    ["main", "other", true],
  ] as const) {
    state = applySessionEvent(state, {
      type: "notification",
      notification: {
        method: "error",
        params: {
          threadId,
          turnId,
          willRetry,
          error: { message: "busy", codexErrorInfo: "serverOverloaded" },
        },
      },
    });
  }
  return state;
}
it.each<NativeNotification>([
  {
    method: "item/started",
    params: {
      threadId: "main",
      turnId: "turn",
      item: { id: "tool", type: "commandExecution", status: "inProgress" },
    },
  },
  {
    method: "item/completed",
    params: {
      threadId: "main",
      turnId: "turn",
      item: { id: "tool", type: "commandExecution", status: "completed" },
    },
  },
  ...[
    "item/agentMessage/delta",
    "item/commandExecution/outputDelta",
    "item/reasoning/summaryTextDelta",
  ].map((method) => ({
    method,
    params: { threadId: "main", turnId: "turn", itemId: "item", delta: "continued" },
  })),
])(
  "clears only the matching retry notice on confirmed primary activity: $method",
  (notification) => {
    const before = retryState();
    const result = applySessionEvent(before, { type: "notification", notification });
    expect(result.activities).toEqual(before.activities.slice(1));
    expect(result.snapshot?.thread.turns[0]?.status).toBe("inProgress");
    expect(result.snapshot?.pendingRequests).toEqual([]);
  },
);
it.each<NativeNotification>([
  {
    method: "item/started",
    params: { threadId: "child", turnId: "turn", item: { id: "item", type: "commandExecution" } },
  },
  { method: "item/started", params: { threadId: "main", turnId: "turn", item: null } },
  {
    method: "item/agentMessage/delta",
    params: { threadId: "main", turnId: "other", itemId: "item", delta: "text" },
  },
  {
    method: "item/agentMessage/delta",
    params: { threadId: "main", turnId: "turn", itemId: "item", delta: "" },
  },
  { method: "item/agentMessage/delta", params: { turnId: "turn", itemId: "item", delta: "text" } },
  { method: "thread/tokenUsage/updated", params: { threadId: "main", turnId: "turn" } },
  {
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "main",
      turnId: "turn",
      itemId: "reason",
      summaryIndex: 1000,
      delta: "ignored",
    },
  },
])("retains a retry notice across unrelated or invalid activity: %j", (notification) => {
  const before = retryState();
  const result = applySessionEvent(before, { type: "notification", notification });
  expect(result.activities).toContainEqual(before.activities[0]);
});

it("does not clear a retry for a repeated completed item and preserves pending approvals", () => {
  const item = {
    id: "cmd",
    type: "commandExecution",
    status: "completed",
    exitCode: 0,
    aggregatedOutput: "done",
  };
  const pending = {
    token: "pending",
    request: {
      id: 1,
      method: "item/fileChange/requestApproval",
      params: { threadId: "main", turnId: "turn" },
    },
  };
  const state = retryState();
  const withItem = {
    ...state,
    snapshot: {
      ...snapshot,
      thread: {
        ...snapshot.thread,
        turns: [{ id: "turn", status: "inProgress", error: null, items: [item] }],
      },
      pendingRequests: [pending],
    },
  };
  const result = applySessionEvent(withItem, {
    type: "notification",
    notification: { method: "item/completed", params: { threadId: "main", turnId: "turn", item } },
  });
  expect(result.activities).toEqual(state.activities);
  expect(result.snapshot?.pendingRequests).toEqual([pending]);
  const progressed = applySessionEvent(result, {
    type: "notification",
    notification: {
      method: "item/started",
      params: {
        threadId: "main",
        turnId: "turn",
        item: { id: "new", type: "fileChange", status: "inProgress" },
      },
    },
  });
  expect(progressed.activities).toEqual(state.activities.slice(1));
  expect(progressed.snapshot?.pendingRequests).toEqual([pending]);
});
