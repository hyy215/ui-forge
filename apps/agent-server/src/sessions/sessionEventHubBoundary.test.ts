import { expect, it } from "vitest";
import type { SessionEvent } from "@ui-forge/shared-protocol";
import { thread } from "../../../../packages/codex-client/src/testing/payloads.js";
import { SessionEventHub } from "./sessionEventHub.js";

it("includes events emitted while pending requests are captured in the snapshot boundary", async () => {
  const turn = { id: "turn", status: "inProgress", items: [], error: null };
  const hub = new SessionEventHub(() => thread.cwd);
  hub.seed({ ...thread, turns: [turn] });
  const controller = new AbortController();
  const completed: SessionEvent = {
    type: "notification",
    notification: {
      method: "turn/completed",
      params: {
        threadId: thread.id,
        turn: { ...turn, status: "completed" },
      },
    },
  };
  const stream = hub
    .subscribe(thread.id, controller.signal, async () => ({
      pendingRequests: () => {
        hub.publish(thread.id, completed);
        return [];
      },
    }))
    [Symbol.asyncIterator]();
  try {
    expect((await stream.next()).value).toMatchObject({
      type: "snapshot",
      snapshot: { thread: { turns: [{ status: "completed" }] } },
    });
    const diagnostic: SessionEvent = { type: "diagnostic", message: "after boundary" };
    hub.publish(thread.id, diagnostic);
    expect((await stream.next()).value).toEqual(diagnostic);
  } finally {
    controller.abort();
    await stream.return?.();
  }
});
