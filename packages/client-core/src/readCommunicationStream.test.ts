import { expect, it, vi } from "vitest";
import { readCommunicationStream } from "./readCommunicationStream.js";

function openStream(text: string) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    cancel,
  });
  return { body, cancel };
}
const event = { kind: "stream-event", requestId: "r", seq: 1, event: { text: "界面" } };
const complete = { kind: "stream-complete", requestId: "r", seq: 2 };

it("decodes split UTF-8 and stops at completion even when the server keeps the connection open", async () => {
  const cancel = vi.fn();
  const bytes = new TextEncoder().encode(
    [event, complete].map((value) => JSON.stringify(value)).join("\n") + "\n",
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    },
    cancel,
  });
  const received = [];
  for await (const message of readCommunicationStream(body, "r")) received.push(message);
  expect(received).toEqual([event, complete]);
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it.each([
  ["invalid JSON", "invalid\n"],
  ["identity", JSON.stringify({ ...event, requestId: "other" }) + "\n"],
  ["order", JSON.stringify({ ...event, seq: 2 }) + "\n"],
])("releases the upstream reader after a %s failure", async (_label, text) => {
  const { body, cancel } = openStream(text);
  await expect(
    (async () => {
      for await (const _message of readCommunicationStream(body, "r")) {
        /* Consume validated frames. */
      }
    })(),
  ).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("releases the reader when the consumer throws", async () => {
  const { body, cancel } = openStream(JSON.stringify(event) + "\n");
  await expect(
    (async () => {
      for await (const _message of readCommunicationStream(body, "r"))
        throw new Error("render failed");
    })(),
  ).rejects.toThrow("render failed");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("cancels an idle read without waiting for another server message", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const stream = readCommunicationStream(body, "r", controller.signal)[Symbol.asyncIterator]();
  const next = stream.next();
  controller.abort();
  await expect(next).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("delivers a final unterminated frame and rejects EOF before completion", async () => {
  const body = new Response(JSON.stringify({ ...complete, seq: 1 })).body!;
  const received = [];
  for await (const message of readCommunicationStream(body, "r")) received.push(message);
  expect(received).toEqual([{ ...complete, seq: 1 }]);
  await expect(
    (async () => {
      for await (const _message of readCommunicationStream(
        new Response(JSON.stringify(event)).body!,
        "r",
      )) {
        /* EOF is invalid. */
      }
    })(),
  ).rejects.toThrow("完成消息前结束");
});
