import { communicationStreamRequestMessageSchema } from "@ui-forge/shared-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpCommunicationClient } from "./createHttpCommunicationClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP communication client", () => {
  it("decodes fragmented NDJSON and delivers validated stream events", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const encoder = new TextEncoder();
    const events: unknown[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const request = communicationStreamRequestMessageSchema.parse(JSON.parse(String(init?.body)));
      const lines =
        [
          JSON.stringify({
            kind: "stream-event",
            requestId: request.requestId,
            seq: 1,
            event: { type: "progress", message: "正在校验项目" },
          }),
          JSON.stringify({
            kind: "stream-heartbeat",
            requestId: request.requestId,
            seq: 2,
          }),
          JSON.stringify({
            kind: "stream-complete",
            requestId: request.requestId,
            seq: 3,
          }),
        ].join("\n") + "\n";
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(lines.slice(0, 23)));
            controller.enqueue(encoder.encode(lines.slice(23)));
            controller.close();
          },
        }),
      );
    });
    const client = createHttpCommunicationClient({ fetchImplementation });

    await client.stream({
      method: "example.stream",
      params: { id: "example" },
      eventSchema: z.object({ type: z.literal("progress"), message: z.string() }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toEqual([{ type: "progress", message: "正在校验项目" }]);
  });

  it("distinguishes a request timeout from caller cancellation", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          ),
        ),
    );
    const client = createHttpCommunicationClient({ fetchImplementation });

    await expect(
      client.request({
        method: "example.timeout",
        responseSchema: z.unknown(),
        timeoutMs: 1,
      }),
    ).rejects.toThrow("通信请求超时：example.timeout");

    const controller = new AbortController();
    const cancelledRequest = client.request({
      method: "example.cancel",
      responseSchema: z.unknown(),
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    controller.abort();
    await expect(cancelledRequest).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels the upstream fetch and reader when stream validation fails", async () => {
    vi.stubGlobal("window", globalThis);
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal;
      const request = communicationStreamRequestMessageSchema.parse(JSON.parse(String(init?.body)));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ kind: "stream-heartbeat", requestId: request.requestId, seq: 2 }) +
                  "\n",
              ),
            );
          },
          cancel,
        }),
      );
    });
    await expect(
      createHttpCommunicationClient({ fetchImplementation }).stream({
        method: "test",
        eventSchema: z.unknown(),
        onEvent() {},
      }),
    ).rejects.toThrow("顺序");
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
