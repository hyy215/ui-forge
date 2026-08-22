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
      const lines = [
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
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines.slice(0, 23)));
          controller.enqueue(encoder.encode(lines.slice(23)));
          controller.close();
        },
      }));
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
});
