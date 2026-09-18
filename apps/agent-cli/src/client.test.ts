import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createSuccessfulCommunicationResponseMessage } from "@ui-forge/shared-protocol";
import { LocalClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

it("validates response identity and payload before accepting local task data", async () => {
  const response = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body));
    return Response.json(
      createSuccessfulCommunicationResponseMessage(request.requestId, { value: 42 }),
    );
  });
  vi.stubGlobal("fetch", response);
  await expect(
    new LocalClient(4310).request("test/read", {}, z.object({ value: z.number() })),
  ).resolves.toEqual({ value: 42 });
  response.mockImplementation(async () =>
    Response.json(createSuccessfulCommunicationResponseMessage("wrong-request", { value: 42 })),
  );
  await expect(new LocalClient(4310).request("test/read", {}, z.unknown())).rejects.toThrow(
    "请求身份",
  );
});

it("refuses invalid ports and an unavailable explicitly connected server", async () => {
  expect(() => new LocalClient(0)).toThrow();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    }),
  );
  await expect(new LocalClient().connect(false)).rejects.toThrow("服务未启动");
});

it("streams native events without projecting fields and detaches without a stop request", async () => {
  const calls: string[] = [];
  const abort = new AbortController();
  const native = {
    type: "notification",
    notification: {
      method: "future/activity",
      params: { threadId: "t", originalField: ["preserved"] },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      const request = z
        .object({ requestId: z.string(), method: z.string() })
        .parse(JSON.parse(String(options?.body)));
      calls.push(request.method);
      return new Response(
        [
          { kind: "stream-heartbeat", requestId: request.requestId, seq: 1 },
          { kind: "stream-event", requestId: request.requestId, seq: 2, event: native },
        ]
          .map((value) => JSON.stringify(value))
          .join("\n") + "\n",
      );
    }),
  );
  const events: unknown[] = [];
  await new LocalClient().subscribe(
    "t",
    (event) => {
      events.push(event);
      abort.abort();
    },
    abort.signal,
  );
  expect(events).toEqual([native]);
  expect(calls).toEqual(["ui-forge.session.subscribe"]);
});

it("rejects a gap in the ordered native stream", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      const request = z.object({ requestId: z.string() }).parse(JSON.parse(String(options?.body)));
      return new Response(
        JSON.stringify({ kind: "stream-heartbeat", requestId: request.requestId, seq: 2 }) + "\n",
      );
    }),
  );
  await expect(
    new LocalClient().subscribe("t", () => undefined, new AbortController().signal),
  ).rejects.toThrow("顺序");
});
