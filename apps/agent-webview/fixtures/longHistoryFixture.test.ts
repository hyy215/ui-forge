import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  sessionEventSchema,
  sessionMethods,
  sessionOperationResultSchema,
  sessionSnapshotSchema,
  taskHistoryPageSchema,
  type SessionEvent,
} from "@ui-forge/shared-protocol";
import { applySessionEvent, emptyPresentation } from "@ui-forge/client-core";
import type { CommunicationClient } from "../src/communication/clientContract";
import {
  createLongHistoryFixtureClient,
  createLongHistorySnapshot,
  LONG_HISTORY_TASK_ID,
} from "./longHistoryFixture";

const controllers: AbortController[] = [];
const read = (client: CommunicationClient, taskId = LONG_HISTORY_TASK_ID) =>
  client.request({
    method: sessionMethods.read,
    params: { taskId },
    responseSchema: sessionSnapshotSchema,
  });
const control = (detail: unknown) =>
  window.dispatchEvent(new CustomEvent("ui-forge:benchmark-control", { detail }));
function subscribe(client: CommunicationClient) {
  const controller = new AbortController();
  controllers.push(controller);
  const events: SessionEvent[] = [];
  const done = client.stream({
    method: sessionMethods.subscribe,
    params: { taskId: LONG_HISTORY_TASK_ID },
    eventSchema: sessionEventSchema,
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { controller, events, done };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("long-history snapshots", () => {
  it.each([100, 500, 1000] as const)(
    "creates %i bounded historical items and one active message",
    (size) => {
      const snapshot = createLongHistorySnapshot(size);
      expect(sessionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
      const history = snapshot.thread.turns.slice(0, -1);
      expect(history).toHaveLength(size / 4);
      expect(history.flatMap((turn) => turn.items)).toHaveLength(size);
      expect(history.every((turn) => turn.status === "completed")).toBe(true);
      expect(
        history.every(
          (turn) =>
            turn.items.map((item) => item.type).join(",") ===
            "userMessage,agentMessage,commandExecution,fileChange",
        ),
      ).toBe(true);
      expect(
        new Set(snapshot.thread.turns.flatMap((turn) => turn.items.map((item) => item.id))).size,
      ).toBe(size + 1);
      expect(snapshot.thread.turns.at(-1)).toMatchObject({
        id: "benchmark-active",
        status: "inProgress",
        items: [{ id: "benchmark-stream", text: "stream-ready" }],
      });
      expect(snapshot.thread.name).toBe("长历史基线（模拟）");
      expect(
        history.flatMap((turn) => turn.items).every((item) => JSON.stringify(item).length < 500),
      ).toBe(true);
    },
  );

  it("rejects unsupported sizes and does not share snapshot state", () => {
    expect(() => createLongHistorySnapshot(101 as 100)).toThrow();
    const first = createLongHistorySnapshot(100);
    first.thread.turns[0]!.items = [];
    expect(createLongHistorySnapshot(100).thread.turns[0]!.items).toHaveLength(4);
  });
});

describe("offline client boundaries", () => {
  it("validates list pagination and task identities, with independent read copies", async () => {
    const client = createLongHistoryFixtureClient(100);
    const list = (params: unknown) =>
      client.request({
        method: sessionMethods.list,
        params,
        responseSchema: taskHistoryPageSchema,
      });
    expect((await list({ offset: 0 })).tasks[0]?.taskId).toBe(LONG_HISTORY_TASK_ID);
    expect((await list({ offset: 1 })).tasks).toEqual([]);
    expect((await list({ projectPath: "/real/workspace" })).tasks).toEqual([]);
    await expect(list({ offset: -1 })).rejects.toThrow();
    await expect(read(client, "real-task")).rejects.toThrow();
    const first = await read(client);
    first.thread.turns[0]!.items = [];
    expect((await read(client)).thread.turns[0]!.items).toHaveLength(4);
  });

  it("rejects other writes, malformed responses and pre-aborted requests", async () => {
    const client = createLongHistoryFixtureClient(100);
    for (const method of [sessionMethods.create, sessionMethods.send, "ui-forge.instructions.save"])
      await expect(
        client.request({ method, params: {}, responseSchema: z.unknown() }),
      ).rejects.toThrow();
    expect(() => client.notify({ method: sessionMethods.send })).toThrow();
    await expect(
      client.request({
        method: sessionMethods.read,
        params: { taskId: LONG_HISTORY_TASK_ID },
        responseSchema: z.never(),
      }),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.request({
        method: sessionMethods.read,
        params: { taskId: LONG_HISTORY_TASK_ID },
        responseSchema: sessionSnapshotSchema,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends one ordered 100-delta stream and keeps its re-readable snapshot in sync", async () => {
    const client = createLongHistoryFixtureClient(100);
    const subscribed = subscribe(client);
    const progress: unknown[] = [];
    window.addEventListener("ui-forge:benchmark-progress", (event) => {
      if (event instanceof CustomEvent) progress.push(event.detail as unknown);
    });
    await vi.advanceTimersByTimeAsync(0);
    control({ action: "stream", count: 100, intervalMs: 20 });
    control({ action: "stream", count: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(2100);
    const deltas = subscribed.events.filter(
      (event) =>
        event.type === "notification" && event.notification.method === "item/agentMessage/delta",
    );
    expect(deltas).toHaveLength(100);
    expect(progress).toEqual([
      { kind: "stream-start", taskId: LONG_HISTORY_TASK_ID, historyItems: 100, count: 100 },
      { kind: "stream-end", taskId: LONG_HISTORY_TASK_ID, historyItems: 100, count: 100 },
    ]);
    const presentation = subscribed.events.reduce(applySessionEvent, emptyPresentation());
    const actual = await read(client);
    expect(presentation.snapshot).toEqual(actual);
    expect(actual.thread.turns.at(-1)?.items[0]?.text).toContain("stream-end-100");
    control({ action: "stream", count: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(subscribed.events).toHaveLength(101);
    subscribed.controller.abort();
    await subscribed.done;
  });

  it("ignores malformed controls without timers or mutations", async () => {
    const client = createLongHistoryFixtureClient(100);
    const subscribed = subscribe(client);
    await vi.advanceTimersByTimeAsync(0);
    const before = await read(client);
    for (const detail of [
      null,
      "stream",
      { action: "stream", count: 10000, intervalMs: 20 },
      { action: "stream", count: 100, intervalMs: 0 },
      { action: "approval", extra: true },
    ])
      control(detail);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await read(client)).toEqual(before);
    expect(subscribed.events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves one synthetic approval with the native event, without executing a command", async () => {
    const client = createLongHistoryFixtureClient(100);
    const subscribed = subscribe(client);
    const progress: unknown[] = [];
    window.addEventListener("ui-forge:benchmark-progress", (event) => {
      if (event instanceof CustomEvent) progress.push(event.detail as unknown);
    });
    await vi.advanceTimersByTimeAsync(0);
    control({ action: "approval" });
    control({ action: "approval" });
    await vi.advanceTimersByTimeAsync(0);
    const pending = await read(client);
    expect(pending.pendingRequests).toHaveLength(1);
    const respond = (result: unknown, token = "benchmark-approval") =>
      client.request({
        method: sessionMethods.respond,
        params: { taskId: LONG_HISTORY_TASK_ID, token, result },
        responseSchema: sessionOperationResultSchema,
      });
    await expect(respond({ decision: "delete" })).rejects.toThrow();
    await expect(respond({ decision: "decline" }, "another-token")).rejects.toThrow();
    expect(await respond({ decision: "decline" })).toEqual({ accepted: true });
    expect(subscribed.events.at(-1)).toMatchObject({
      type: "notification",
      notification: {
        method: "serverRequest/resolved",
        params: { requestId: "benchmark-approval" },
      },
    });
    expect((await read(client)).pendingRequests).toEqual([]);
    expect((await read(client)).thread.turns).toEqual(pending.thread.turns);
    expect(progress).toEqual([
      {
        kind: "approval-resolved",
        decision: "decline",
        taskId: LONG_HISTORY_TASK_ID,
        historyItems: 100,
      },
    ]);
    await expect(respond({ decision: "decline" })).rejects.toThrow();
  });

  it("cleans aborted subscriptions and timers, without replaying or automatically resuming a stream", async () => {
    const client = createLongHistoryFixtureClient(100);
    const strictMode = subscribe(client);
    strictMode.controller.abort();
    await strictMode.done;
    const subscribed = subscribe(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribed.events).toHaveLength(1);
    control({ action: "stream", count: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(60);
    expect(subscribed.events).toHaveLength(4);
    subscribed.controller.abort();
    await subscribed.done;
    expect(vi.getTimerCount()).toBe(0);
    const paused = await read(client);
    control({ action: "approval" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await read(client)).toEqual(paused);
    const reconnected = subscribe(client);
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconnected.events).toEqual([{ type: "snapshot", snapshot: paused }]);
  });

  it("stops only the active synthetic turn and clears the controlled stream", async () => {
    const client = createLongHistoryFixtureClient(100);
    const subscribed = subscribe(client);
    await vi.advanceTimersByTimeAsync(0);
    control({ action: "stream", count: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(40);
    const stop = (turnId: string) =>
      client.request({
        method: sessionMethods.stop,
        params: { taskId: LONG_HISTORY_TASK_ID, turnId },
        responseSchema: sessionOperationResultSchema,
      });
    await expect(stop("benchmark-history-0001")).rejects.toThrow();
    await expect(stop("benchmark-active")).resolves.toEqual({ accepted: true });
    expect((await read(client)).thread.turns.at(-1)?.status).toBe("interrupted");
    expect(vi.getTimerCount()).toBe(0);
    await expect(stop("benchmark-active")).rejects.toThrow();
    const count = subscribed.events.length;
    control({ action: "approval" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(subscribed.events).toHaveLength(count);
  });

  it("validates subscribed events and isolates simultaneous subscriber copies", async () => {
    const client = createLongHistoryFixtureClient(100);
    await expect(
      client.stream({
        method: sessionMethods.subscribe,
        params: { taskId: "another-task" },
        eventSchema: sessionEventSchema,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow();
    await expect(
      client.stream({
        method: sessionMethods.send,
        params: { taskId: LONG_HISTORY_TASK_ID },
        eventSchema: sessionEventSchema,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow();
    await expect(
      client.stream({
        method: sessionMethods.subscribe,
        params: { taskId: LONG_HISTORY_TASK_ID },
        eventSchema: z.never(),
        onEvent: () => undefined,
      }),
    ).rejects.toThrow();
    const first = subscribe(client);
    const second = subscribe(client);
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = first.events[0];
    if (snapshot?.type !== "snapshot") throw new Error("Missing test snapshot");
    snapshot.snapshot.thread.turns = [];
    expect(second.events[0]).toEqual({ type: "snapshot", snapshot: await read(client) });
    first.controller.abort();
    await first.done;
    control({ action: "stream", count: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(second.events).toHaveLength(101);
  });

  it("does not resolve or stop a task when the caller rejects its response schema", async () => {
    const client = createLongHistoryFixtureClient(100);
    subscribe(client);
    await vi.advanceTimersByTimeAsync(0);
    control({ action: "approval" });
    await expect(
      client.request({
        method: sessionMethods.respond,
        params: {
          taskId: LONG_HISTORY_TASK_ID,
          token: "benchmark-approval",
          result: { decision: "decline" },
        },
        responseSchema: z.never(),
      }),
    ).rejects.toThrow();
    expect((await read(client)).pendingRequests).toHaveLength(1);
    await expect(
      client.request({
        method: sessionMethods.stop,
        params: { taskId: LONG_HISTORY_TASK_ID, turnId: "benchmark-active" },
        responseSchema: z.never(),
      }),
    ).rejects.toThrow();
    expect((await read(client)).thread.turns.at(-1)?.status).toBe("inProgress");
  });
});
