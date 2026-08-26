/** 验证第一方客户端只协商一次、阻断不兼容调用并允许失败后重试。 */

import {
  communicationTransportMethods,
  currentCommunicationProtocolVersion,
} from "@ui-forge/shared-protocol";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  CommunicationClient,
  CommunicationRequest,
} from "./clientContract";
import { createNegotiatedCommunicationClient } from "./createNegotiatedCommunicationClient";

function successfulNegotiationResult() {
  return {
    protocolVersion: currentCommunicationProtocolVersion,
    capabilities: [
      "request-response",
      "ordered-stream",
      "stream-cancel",
      "persisted-design-confirmation",
    ],
  };
}

describe("negotiated communication client", () => {
  it("shares one negotiation across concurrent requests and later streams", async () => {
    const requestedMethods: string[] = [];
    const stream = vi.fn(async () => undefined);
    const underlying: CommunicationClient = {
      notify: vi.fn(),
      async request<TResult>(input: CommunicationRequest<TResult>): Promise<TResult> {
        requestedMethods.push(input.method);
        return input.responseSchema.parse(
          input.method === communicationTransportMethods.negotiateProtocol
            ? successfulNegotiationResult()
            : { ok: true },
        );
      },
      stream,
    };
    const negotiated = createNegotiatedCommunicationClient(underlying);
    await Promise.all([
      negotiated.request({ method: "business.one", responseSchema: z.object({ ok: z.boolean() }) }),
      negotiated.request({ method: "business.two", responseSchema: z.object({ ok: z.boolean() }) }),
    ]);
    await negotiated.stream({
      method: "business.stream",
      eventSchema: z.unknown(),
      onEvent: () => undefined,
    });

    expect(requestedMethods.filter((method) => (
      method === communicationTransportMethods.negotiateProtocol
    ))).toHaveLength(1);
    expect(stream).toHaveBeenCalledOnce();
  });

  it("does not issue a business request when negotiation fails and retries next time", async () => {
    let attempts = 0;
    const requestedMethods: string[] = [];
    const underlying: CommunicationClient = {
      notify: vi.fn(),
      async request<TResult>(input: CommunicationRequest<TResult>): Promise<TResult> {
        requestedMethods.push(input.method);
        if (input.method === communicationTransportMethods.negotiateProtocol) {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary negotiation failure");
          return input.responseSchema.parse(successfulNegotiationResult());
        }
        return input.responseSchema.parse({ ok: true });
      },
      stream: vi.fn(async () => undefined),
    };
    const client = createNegotiatedCommunicationClient(underlying);
    const business = { method: "business.one", responseSchema: z.object({ ok: z.boolean() }) };

    await expect(client.request(business)).rejects.toThrow("temporary negotiation failure");
    expect(requestedMethods).not.toContain("business.one");
    await expect(client.request(business)).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });
});
