/** 验证领域事件被转换为有序完成流，并把异常转换为安全错误信封。 */

import { describe, expect, it } from "vitest";
import { CommunicationStreamRequestHandler } from "./communicationStreamRequestHandler.js";

describe("CommunicationStreamRequestHandler", () => {
  it("assigns monotonically increasing sequence numbers", async () => {
    const handler = new CommunicationStreamRequestHandler({
      workflowService: {
        stream: async function* () {
          yield { type: "first" };
          yield { type: "second" };
        },
      },
    });

    const messages = await Array.fromAsync(handler.handle({
      kind: "stream-request",
      requestId: "stream-1",
      method: "example.stream",
    }));

    expect(messages).toMatchObject([
      { kind: "stream-event", seq: 1, event: { type: "first" } },
      { kind: "stream-event", seq: 2, event: { type: "second" } },
      { kind: "stream-complete", seq: 3 },
    ]);
  });

  it("ends a failed stream with an error envelope", async () => {
    const handler = new CommunicationStreamRequestHandler({
      workflowService: {
        stream: async function* () {
          yield { type: "started" };
          throw new Error("项目检查失败");
        },
      },
    });

    const messages = await Array.fromAsync(handler.handle({
      kind: "stream-request",
      requestId: "stream-2",
      method: "example.stream",
    }));

    expect(messages).toMatchObject([
      { kind: "stream-event", seq: 1 },
      { kind: "stream-error", seq: 2, error: { message: "项目检查失败" } },
    ]);
  });

  it("emits ordered heartbeats while the domain stream is idle", async () => {
    const handler = new CommunicationStreamRequestHandler({
      heartbeatIntervalMs: 5,
      workflowService: {
        stream: async function* () {
          await new Promise((resolve) => setTimeout(resolve, 18));
          yield { type: "completed" };
        },
      },
    });

    const messages = await Array.fromAsync(handler.handle({
      kind: "stream-request",
      requestId: "stream-heartbeat",
      method: "example.stream",
    }));

    expect(messages.some((message) => message.kind === "stream-heartbeat")).toBe(true);
    expect(messages.map((message) => message.seq)).toEqual(
      messages.map((_message, index) => index + 1),
    );
    expect(messages.at(-1)?.kind).toBe("stream-complete");
  });

  it("forwards transport cancellation and does not emit an error envelope", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const handler = new CommunicationStreamRequestHandler({
      heartbeatIntervalMs: 1_000,
      workflowService: {
        stream: async function* (_method, _params, signal) {
          receivedSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(
              new DOMException("连接已关闭。", "AbortError"),
            ), { once: true });
          });
        },
      },
    });
    const iterator = handler.handle({
      kind: "stream-request",
      requestId: "stream-abort",
      method: "example.stream",
    }, controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();

    controller.abort();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
