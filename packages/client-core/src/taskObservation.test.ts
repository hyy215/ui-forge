import type { NativeNotification, NativeTurn, SessionEvent } from "@ui-forge/shared-protocol";
import { describe, expect, it } from "vitest";
import {
  emptyTaskObservation,
  formatObservedDuration,
  nativeTurnElapsedMs,
  observeTaskEvent,
} from "./taskObservation.js";

function notification(
  params: NonNullable<NativeNotification["params"]>,
  method = "thread/tokenUsage/updated",
): SessionEvent {
  return {
    type: "notification",
    notification: { method, params },
  };
}

function tokenUsage(totalTokens: number, threadId = "task"): SessionEvent {
  return notification({ threadId, tokenUsage: { total: { totalTokens } } });
}

function snapshot(taskId = "task"): SessionEvent {
  return {
    type: "snapshot",
    snapshot: {
      thread: {
        id: taskId,
        cwd: "/workspace",
        preview: "",
        name: null,
        createdAt: 100,
        updatedAt: 100,
        status: { type: "active" },
        turns: [{ id: "turn", status: "inProgress", error: null, items: [], startedAt: 10 }],
      },
      pendingRequests: [],
    },
  };
}

function turn(fields: Partial<NativeTurn> = {}): NativeTurn {
  return { id: "turn", status: "inProgress", error: null, items: [], ...fields };
}

describe("task observation", () => {
  it("starts without invented events, tokens or a turn start time", () => {
    expect(emptyTaskObservation("task", 1000)).toEqual({
      taskId: "task",
      connectedAtMs: 1000,
      lastEventAtMs: null,
      totalTokens: null,
      tokenObservedAtMs: null,
    });
  });

  it("resets same-task snapshots to a connection baseline instead of counting history as activity", () => {
    const before = observeTaskEvent(emptyTaskObservation("task", 1000), tokenUsage(100), 2000);
    expect(observeTaskEvent(before, snapshot(), 3000)).toEqual(emptyTaskObservation("task", 3000));
    expect(observeTaskEvent(before, snapshot("other"), 3000)).toBe(before);
    expect(before.totalTokens).toBe(100);
  });

  it("replaces cumulative token values without adding them and retains the timestamp of duplicates", () => {
    const first = observeTaskEvent(emptyTaskObservation("task", 1000), tokenUsage(100), 2000);
    expect(first).toMatchObject({ totalTokens: 100, tokenObservedAtMs: 2000, lastEventAtMs: 2000 });
    const repeated = observeTaskEvent(first, tokenUsage(100), 3000);
    expect(repeated).toMatchObject({
      totalTokens: 100,
      tokenObservedAtMs: 2000,
      lastEventAtMs: 3000,
    });
    const replaced = observeTaskEvent(repeated, tokenUsage(150), 4000);
    expect(replaced).toMatchObject({
      totalTokens: 150,
      tokenObservedAtMs: 4000,
      lastEventAtMs: 4000,
    });
    expect(observeTaskEvent(replaced, tokenUsage(0), 5000)).toMatchObject({
      totalTokens: 0,
      tokenObservedAtMs: 5000,
    });
    expect(first.totalTokens).toBe(100);
  });

  it.each<NonNullable<NativeNotification["params"]>>([
    {},
    { tokenUsage: null },
    { tokenUsage: { total: null } },
    { tokenUsage: { total: { totalTokens: "12" } } },
    { tokenUsage: { total: { totalTokens: -1 } } },
    { tokenUsage: { total: { totalTokens: 1.5 } } },
    { tokenUsage: { total: { totalTokens: Number.NaN } } },
    { tokenUsage: { total: { totalTokens: Number.POSITIVE_INFINITY } } },
    { tokenUsage: { total: { totalTokens: Number.MAX_SAFE_INTEGER + 1 } } },
    { tokenUsage: { total: { totalTokens: null } } },
    { tokenUsage: { last: { totalTokens: 200 } } },
  ])("does not replace token observations from invalid totals: %j", (params) => {
    const before = observeTaskEvent(emptyTaskObservation("task", 1000), tokenUsage(100), 2000);
    expect(observeTaskEvent(before, notification({ threadId: "task", ...params }), 3000)).toEqual({
      ...before,
      lastEventAtMs: 3000,
    });
  });

  it("counts exact main-thread native notices and requests as received messages, not progress", () => {
    const initial = emptyTaskObservation("task", 1000);
    const notice = notification({ threadId: "task", willRetry: true }, "error");
    const received = observeTaskEvent(initial, notice, 2000);
    expect(received).toEqual({ ...initial, lastEventAtMs: 2000 });
    const request: SessionEvent = {
      type: "request",
      pending: {
        token: "pending",
        request: { id: 1, method: "item/tool/requestUserInput", params: { threadId: "task" } },
      },
    };
    expect(observeTaskEvent(received, request, 3000)).toEqual({ ...initial, lastEventAtMs: 3000 });
  });

  it("ignores child threads, unbound events and connection diagnostics", () => {
    const before = observeTaskEvent(emptyTaskObservation("task", 1000), tokenUsage(100), 2000);
    const ignored: SessionEvent[] = [
      tokenUsage(999, "child"),
      notification({ conversationId: "task" }, "error"),
      notification({ thread: { id: "task" } }, "thread/started"),
      notification({ threadId: null }),
      { type: "notification", notification: { method: "warning" } },
      { type: "diagnostic", message: "late response" },
      { type: "close", message: "connection closed" },
      { type: "resolved", token: "pending" },
      {
        type: "request",
        pending: {
          token: "child-request",
          request: { id: 1, method: "item/tool/requestUserInput", params: { threadId: "child" } },
        },
      },
    ];
    for (const event of ignored) expect(observeTaskEvent(before, event, 3000)).toBe(before);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "does not manufacture a reception time from an invalid clock: %s",
    (nowMs) => {
      expect(() => emptyTaskObservation("task", nowMs)).toThrow(RangeError);
      const before = emptyTaskObservation("task", 1000);
      expect(observeTaskEvent(before, tokenUsage(10), nowMs)).toBe(before);
      expect(observeTaskEvent(before, snapshot(), nowMs)).toBe(before);
    },
  );
});

describe("native turn duration", () => {
  it("converts native seconds to milliseconds and recomputes only active turns", () => {
    const active = turn({ startedAt: 10, durationMs: 123, completedAt: 11 });
    expect(nativeTurnElapsedMs(active, 12_345)).toBe(2345);
    expect(nativeTurnElapsedMs(active, 14_000)).toBe(4000);
    expect(nativeTurnElapsedMs(turn({ startedAt: 0 }), 0)).toBe(0);
  });

  it.each(["completed", "failed", "interrupted"])(
    "prefers native duration for %s even if timestamps are unavailable",
    (status) => {
      expect(nativeTurnElapsedMs(turn({ status, startedAt: null, durationMs: 1234 }), 20_000)).toBe(
        1234,
      );
      expect(nativeTurnElapsedMs(turn({ status, durationMs: 0 }), 20_000)).toBe(0);
      expect(nativeTurnElapsedMs(turn({ status, startedAt: 10, completedAt: 12 }), 20_000)).toBe(
        2000,
      );
      expect(
        nativeTurnElapsedMs(
          turn({ status, startedAt: 10, completedAt: 12, durationMs: -1 }),
          20_000,
        ),
      ).toBe(2000);
    },
  );

  it.each([null, -1, "10", 10.5, Number.MAX_SAFE_INTEGER])(
    "does not invent a start timestamp from %j",
    (startedAt) => {
      expect(nativeTurnElapsedMs(turn({ startedAt }), 20_000)).toBeNull();
    },
  );

  it("rejects missing, future or reversed timestamps and unknown statuses", () => {
    expect(nativeTurnElapsedMs(undefined, 20_000)).toBeNull();
    expect(nativeTurnElapsedMs(turn(), 20_000)).toBeNull();
    expect(nativeTurnElapsedMs(turn({ startedAt: 21 }), 20_000)).toBeNull();
    expect(nativeTurnElapsedMs(turn({ status: "completed", startedAt: 10 }), 20_000)).toBeNull();
    expect(
      nativeTurnElapsedMs(turn({ status: "completed", startedAt: 10, completedAt: 9 }), 20_000),
    ).toBeNull();
    expect(
      nativeTurnElapsedMs(turn({ status: "completed", startedAt: 10, completedAt: 21 }), 20_000),
    ).toBeNull();
    expect(
      nativeTurnElapsedMs(turn({ status: "unknown", startedAt: 10, durationMs: 1000 }), 20_000),
    ).toBeNull();
    expect(nativeTurnElapsedMs(turn({ startedAt: 10 }), Number.NaN)).toBeNull();
  });
});

it.each<[number | null, string]>([
  [null, "未知"],
  [-1, "未知"],
  [Number.NaN, "未知"],
  [Number.POSITIVE_INFINITY, "未知"],
  [Number.MAX_SAFE_INTEGER + 1, "未知"],
  [0, "0秒"],
  [999, "0秒"],
  [5000, "5秒"],
  [65_000, "1分05秒"],
  [3_723_999, "1小时02分03秒"],
])("formats observed duration %s as %s", (duration, expected) => {
  expect(formatObservedDuration(duration)).toBe(expected);
});
