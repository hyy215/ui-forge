import { afterEach, expect, it, vi } from "vitest";
import { sessionMethods, type SessionSnapshot } from "@ui-forge/shared-protocol";
import { LocalClient } from "./client.js";
import { watchTask } from "./taskSession.js";

const terminal = vi.hoisted(() => ({
  line: undefined as ((line: string) => void) | undefined,
  close: vi.fn(),
}));
vi.mock("node:readline", () => ({
  createInterface: () => ({
    on(event: string, listener: (line: string) => void) {
      if (event === "line") terminal.line = listener;
    },
    close: terminal.close,
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  terminal.line = undefined;
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
