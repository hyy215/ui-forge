/** 验证协议协商在业务 Workflow 之前完成并返回明确兼容性结果。 */

import Fastify from "fastify";
import {
  communicationResponseMessageSchema,
  communicationTransportMethods,
  createCommunicationRequestMessage,
  currentCommunicationProtocolVersion,
  negotiateCommunicationProtocolResultSchema,
} from "@ui-forge/shared-protocol";
import { describe, expect, it, vi } from "vitest";
import { CommunicationRequestHandler } from "./communicationRequestHandler.js";
import { CommunicationStreamRequestHandler } from "./communicationStreamRequestHandler.js";
import { registerCommunicationRoute } from "./registerCommunicationRoute.js";

function createApp(handle = vi.fn(async () => ({ business: true }))) {
  const app = Fastify();
  registerCommunicationRoute(
    app,
    new CommunicationRequestHandler({ workflowService: { handle } }),
    new CommunicationStreamRequestHandler({
      workflowService: { stream: async function* () { yield { ok: true }; } },
    }),
  );
  return { app, handle };
}

describe("communication protocol negotiation", () => {
  it("returns the current version and capabilities without invoking the business workflow", async () => {
    const { app, handle } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage(
        "negotiate-1",
        communicationTransportMethods.negotiateProtocol,
        {
          protocolVersion: currentCommunicationProtocolVersion,
          requiredCapabilities: ["request-response", "ordered-stream"],
        },
      ),
    });
    await app.close();
    const message = communicationResponseMessageSchema.parse(response.json());
    expect(message.success).toBe(true);
    if (message.success) expect(negotiateCommunicationProtocolResultSchema.parse(message.data))
      .toMatchObject({ protocolVersion: currentCommunicationProtocolVersion });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns correlated errors for incompatible versions and unsupported future capabilities", async () => {
    const { app } = createApp();
    const incompatible = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage(
        "negotiate-version",
        communicationTransportMethods.negotiateProtocol,
        { protocolVersion: 99, requiredCapabilities: [] },
      ),
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage(
        "negotiate-capability",
        communicationTransportMethods.negotiateProtocol,
        {
          protocolVersion: currentCommunicationProtocolVersion,
          requiredCapabilities: ["future-capability"],
        },
      ),
    });
    await app.close();
    expect(communicationResponseMessageSchema.parse(incompatible.json()))
      .toMatchObject({ success: false, requestId: "negotiate-version" });
    expect(communicationResponseMessageSchema.parse(missing.json()))
      .toMatchObject({ success: false, requestId: "negotiate-capability" });
  });
});
