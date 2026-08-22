/** 验证通用通信信封的关联标识和运行时校验规则。 */
import { describe, expect, it } from "vitest";
import {
  cancelCommunicationStreamInputSchema,
  communicationRequestMessageSchema,
  communicationResponseMessageSchema,
  communicationStreamMessageSchema,
  createCommunicationRequestMessage,
  createCommunicationStreamCompleteMessage,
  createCommunicationStreamEventMessage,
  createCommunicationStreamHeartbeatMessage,
  createCommunicationStreamRequestMessage,
} from "./transportProtocol.js";

describe("communication transport protocol", () => {
  it("validates a generic request and its correlated response", () => {
    const request = communicationRequestMessageSchema.parse(
      createCommunicationRequestMessage("webview-1", "example.read", { id: "example" }),
    );
    const response = communicationResponseMessageSchema.parse({
      kind: "response",
      requestId: request.requestId,
      success: true,
      data: { value: 1 },
    });

    expect(response.requestId).toBe(request.requestId);
  });

  it("rejects a response without a correlation identifier", () => {
    const result = communicationResponseMessageSchema.safeParse({
      kind: "response",
      success: true,
      data: null,
    });

    expect(result.success).toBe(false);
  });

  it("validates correlated stream requests, events, heartbeats and completion", () => {
    const request = createCommunicationStreamRequestMessage(
      "webview-stream-1",
      "example.stream",
      { taskId: "task-1" },
    );
    const event = communicationStreamMessageSchema.parse(
      createCommunicationStreamEventMessage(request.requestId, 1, { type: "progress" }),
    );
    const heartbeat = communicationStreamMessageSchema.parse(
      createCommunicationStreamHeartbeatMessage(request.requestId, 2),
    );
    const complete = communicationStreamMessageSchema.parse(
      createCommunicationStreamCompleteMessage(request.requestId, 3),
    );

    expect(request.kind).toBe("stream-request");
    expect(event).toMatchObject({ requestId: request.requestId, seq: 1 });
    expect(heartbeat).toMatchObject({ kind: "stream-heartbeat", seq: 2 });
    expect(complete).toMatchObject({ requestId: request.requestId, seq: 3 });
    expect(cancelCommunicationStreamInputSchema.parse({ requestId: request.requestId }))
      .toEqual({ requestId: request.requestId });
  });

  it("rejects a stream message without a positive sequence", () => {
    const result = communicationStreamMessageSchema.safeParse({
      kind: "stream-complete",
      requestId: "stream-1",
      seq: 0,
    });

    expect(result.success).toBe(false);
  });
});
