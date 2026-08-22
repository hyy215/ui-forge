import {
  communicationTransportMethods,
  communicationRequestMessageSchema,
  communicationStreamRequestMessageSchema,
} from "@ui-forge/shared-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createVsCodeCommunicationClient } from "./createVsCodeCommunicationClient";

describe("VS Code communication client", () => {
  it("acquires the host API once and correlates a validated request response", async () => {
    const sentMessages: unknown[] = [];
    let acquireCount = 0;
    const targetWindow = Object.assign(new EventTarget(), {
      acquireVsCodeApi: () => {
        acquireCount += 1;
        return { postMessage: (message: unknown) => sentMessages.push(message) };
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }) as unknown as Window;
    const client = createVsCodeCommunicationClient(targetWindow);

    const responsePromise = client.request({
      method: "example.read",
      params: { id: "example" },
      responseSchema: z.object({ value: z.number() }),
    });
    const request = communicationRequestMessageSchema.parse(sentMessages[0]);
    targetWindow.dispatchEvent(new MessageEvent("message", {
      data: {
        kind: "response",
        requestId: request.requestId,
        success: true,
        data: { value: 42 },
      },
    }));

    await expect(responsePromise).resolves.toEqual({ value: 42 });
    expect(acquireCount).toBe(1);
  });

  it("sends notifications without creating a pending request", () => {
    const sentMessages: unknown[] = [];
    const targetWindow = Object.assign(new EventTarget(), {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => sentMessages.push(message),
      }),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }) as unknown as Window;
    const client = createVsCodeCommunicationClient(targetWindow);

    client.notify({ method: "example.changed", params: { id: "example" } });

    expect(sentMessages).toEqual([{
      kind: "notification",
      method: "example.changed",
      params: { id: "example" },
    }]);
  });

  it("delivers correlated stream events in sequence before completing", async () => {
    const sentMessages: unknown[] = [];
    const targetWindow = Object.assign(new EventTarget(), {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => sentMessages.push(message),
      }),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }) as unknown as Window;
    const client = createVsCodeCommunicationClient(targetWindow);
    const events: unknown[] = [];

    const streamPromise = client.stream({
      method: "example.stream",
      params: { id: "example" },
      eventSchema: z.object({ type: z.literal("progress"), message: z.string() }),
      onEvent: (event) => {
        events.push(event);
      },
    });
    const request = communicationStreamRequestMessageSchema.parse(sentMessages[0]);
    targetWindow.dispatchEvent(new MessageEvent("message", {
      data: {
        kind: "stream-event",
        requestId: request.requestId,
        seq: 1,
        event: { type: "progress", message: "正在校验项目" },
      },
    }));
    targetWindow.dispatchEvent(new MessageEvent("message", {
      data: {
        kind: "stream-heartbeat",
        requestId: request.requestId,
        seq: 2,
      },
    }));
    targetWindow.dispatchEvent(new MessageEvent("message", {
      data: {
        kind: "stream-complete",
        requestId: request.requestId,
        seq: 3,
      },
    }));

    await expect(streamPromise).resolves.toBeUndefined();
    expect(events).toEqual([{ type: "progress", message: "正在校验项目" }]);
  });

  it("notifies the Extension to cancel the upstream stream when aborted", async () => {
    const sentMessages: unknown[] = [];
    const targetWindow = Object.assign(new EventTarget(), {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => sentMessages.push(message),
      }),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }) as unknown as Window;
    const client = createVsCodeCommunicationClient(targetWindow);
    const controller = new AbortController();

    const streamPromise = client.stream({
      method: "example.stream",
      params: { id: "example" },
      eventSchema: z.unknown(),
      onEvent: () => undefined,
      signal: controller.signal,
    });
    const request = communicationStreamRequestMessageSchema.parse(sentMessages[0]);
    controller.abort();

    await expect(streamPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(sentMessages[1]).toEqual({
      kind: "notification",
      method: communicationTransportMethods.cancelStream,
      params: { requestId: request.requestId },
    });
  });
});
