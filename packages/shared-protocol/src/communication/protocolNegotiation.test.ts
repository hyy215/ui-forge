/** 验证协议版本与稳定能力 Schema。 */

import { describe, expect, it } from "vitest";
import {
  createCommunicationProtocolNegotiationInput,
  currentCommunicationProtocolVersion,
  negotiateCommunicationProtocolResultSchema,
} from "./protocolNegotiation.js";

describe("communication protocol negotiation", () => {
  it("uses the current version and first-party required capabilities", () => {
    expect(createCommunicationProtocolNegotiationInput()).toEqual({
      protocolVersion: currentCommunicationProtocolVersion,
      requiredCapabilities: [
        "request-response",
        "ordered-stream",
        "stream-cancel",
        "persisted-design-confirmation",
        "persisted-plan-approval",
        "reviewable-code-patch",
        "automatic-controlled-patch-application",
        "automatic-delivery-validation",
        "exact-workspace-command-approval",
        "persistent-workspace-task-list",
        "permanent-workspace-task-deletion",
      ],
    });
  });

  it("rejects an unknown capability claimed by the server", () => {
    expect(negotiateCommunicationProtocolResultSchema.safeParse({
      protocolVersion: currentCommunicationProtocolVersion,
      capabilities: ["request-response", "future-capability"],
    }).success).toBe(false);
  });
});
