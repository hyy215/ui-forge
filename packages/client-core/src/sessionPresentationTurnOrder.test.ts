import { expect, it } from "vitest";
import type { NativeTurn, SessionSnapshot } from "@ui-forge/shared-protocol";
import { applySessionEvent, emptyPresentation } from "./sessionPresentation.js";

it.each(["completed", "failed", "interrupted"])(
  "does not regress a %s turn or discard its output/error on a late start",
  (status) => {
    const started: NativeTurn = {
      id: "turn",
      status: "inProgress",
      items: [{ id: "user", type: "userMessage", content: [] }],
      error: null,
    };
    const snapshot: SessionSnapshot = {
      thread: {
        id: "task",
        cwd: "/tmp",
        preview: "test",
        name: null,
        createdAt: 1,
        updatedAt: 1,
        status: { type: "active" },
        turns: [started],
      },
      pendingRequests: [
        {
          token: "approval",
          request: {
            id: 1,
            method: "item/commandExecution/requestApproval",
            params: { threadId: "task", turnId: started.id, itemId: "command" },
          },
        },
      ],
    };
    const finished: NativeTurn = {
      ...started,
      status,
      items: [...started.items, { id: "answer", type: "agentMessage", text: "final output" }],
      error: status === "failed" ? { message: "model failed" } : null,
    };
    const completed = applySessionEvent(
      applySessionEvent(emptyPresentation(), { type: "snapshot", snapshot }),
      {
        type: "notification",
        notification: {
          method: "turn/completed",
          params: { threadId: "task", turn: finished },
        },
      },
    );
    expect(completed.snapshot?.pendingRequests).toEqual([]);
    for (const items of [[], started.items]) {
      const replayed = applySessionEvent(completed, {
        type: "notification",
        notification: {
          method: "turn/started",
          params: { threadId: "task", turn: { ...started, items } },
        },
      });
      expect(replayed).toBe(completed);
      expect(replayed.snapshot?.thread.turns).toEqual([finished]);
    }

    // A new turn ID must still start normally after a terminal turn.
    const next = { ...started, id: "next-turn" };
    const continued = applySessionEvent(completed, {
      type: "notification",
      notification: { method: "turn/started", params: { threadId: "task", turn: next } },
    });
    expect(continued.snapshot?.thread.turns).toEqual([finished, next]);
  },
);
