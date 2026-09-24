/** 验证第一方客户端只协商一次、阻断不兼容调用并允许失败后重试。 */

import {
  communicationCapabilities,
  communicationTransportMethods,
  currentCommunicationProtocolVersion,
} from "@ui-forge/shared-protocol";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CommunicationClient, CommunicationRequest } from "./clientContract";
import { createNegotiatedCommunicationClient } from "./createNegotiatedCommunicationClient";

function successfulNegotiationResult() {
  return {
    protocolVersion: currentCommunicationProtocolVersion,
    capabilities: [...communicationCapabilities],
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

    expect(
      requestedMethods.filter(
        (method) => method === communicationTransportMethods.negotiateProtocol,
      ),
    ).toHaveLength(1);
    expect(stream).toHaveBeenCalledOnce();
  });

  it("rejects a server without native sessions before sending input", async () => {
    const methods: string[] = [];
    const underlying: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(input: CommunicationRequest<TResult>): Promise<TResult> {
        methods.push(input.method);
        return input.responseSchema.parse({
          protocolVersion: currentCommunicationProtocolVersion,
          capabilities: communicationCapabilities.filter(
            (capability) => capability !== "codex-native-sessions",
          ),
        });
      },
    };
    const client = createNegotiatedCommunicationClient(underlying);
    await expect(
      client.request({ method: "ui-forge.session.send", responseSchema: z.unknown() }),
    ).rejects.toThrow("codex-native-sessions");
    expect(methods).toEqual([communicationTransportMethods.negotiateProtocol]);
  });

  it.each([
    {
      name: "incompatible protocol version",
      result: {
        ...successfulNegotiationResult(),
        protocolVersion: currentCommunicationProtocolVersion + 1,
      },
    },
    ...communicationCapabilities.map((missing) => ({
      name: `missing ${missing}`,
      result: {
        ...successfulNegotiationResult(),
        capabilities: communicationCapabilities.filter((capability) => capability !== missing),
      },
    })),
  ])("blocks requests, streams and notifications for $name", async ({ result }) => {
    const methods: string[] = [];
    const notify = vi.fn();
    const stream = vi.fn(async () => undefined);
    const underlying: CommunicationClient = {
      notify,
      stream,
      async request<TResult>(input: CommunicationRequest<TResult>): Promise<TResult> {
        methods.push(input.method);
        return input.responseSchema.parse(result);
      },
    };
    const client = createNegotiatedCommunicationClient(underlying);
    const request = client.request({ method: "business.write", responseSchema: z.unknown() });
    const subscription = client.stream({
      method: "business.subscribe",
      eventSchema: z.unknown(),
      onEvent: () => undefined,
    });
    client.notify({ method: "business.notify" });

    const outcomes = await Promise.allSettled([request, subscription]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    expect(methods).toEqual([communicationTransportMethods.negotiateProtocol]);
    expect(stream).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
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
