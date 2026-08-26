/** 在第一方业务调用前强制执行一次 Client / Server 协议能力协商。 */

import {
  communicationTransportMethods,
  createCommunicationProtocolNegotiationInput,
  currentCommunicationProtocolVersion,
  firstPartyRequiredCommunicationCapabilities,
  negotiateCommunicationProtocolResultSchema,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "./clientContract";

/** 包装具体传输客户端时允许覆盖的必需能力。 */
export interface NegotiatedCommunicationClientOptions {
  requiredCapabilities?: readonly string[];
}

/** 创建在请求、通知或流之前复用同一个协商 Promise 的客户端。 */
export function createNegotiatedCommunicationClient(
  client: CommunicationClient,
  options: NegotiatedCommunicationClientOptions = {},
): CommunicationClient {
  const requiredCapabilities = options.requiredCapabilities
    ?? firstPartyRequiredCommunicationCapabilities;
  let negotiation: Promise<void> | undefined;

  function ensureNegotiated(): Promise<void> {
    if (negotiation) return negotiation;
    let current!: Promise<void>;
    current = client.request({
      method: communicationTransportMethods.negotiateProtocol,
      params: createCommunicationProtocolNegotiationInput(requiredCapabilities),
      responseSchema: negotiateCommunicationProtocolResultSchema,
    }).then((result) => {
      if (result.protocolVersion !== currentCommunicationProtocolVersion) {
        throw new Error("Agent Server 返回了不兼容的通信协议版本。");
      }
      const supported = new Set<string>(result.capabilities);
      const missing = requiredCapabilities.filter((capability) => !supported.has(capability));
      if (missing.length > 0) throw new Error(`Agent Server 缺少必需通信能力：${missing.join("、")}。`);
    }).catch((error: unknown) => {
      if (negotiation === current) negotiation = undefined;
      throw error;
    });
    negotiation = current;
    return current;
  }

  return {
    notify(notification) {
      void ensureNegotiated().then(() => client.notify(notification)).catch(() => undefined);
    },
    async request(request) {
      await ensureNegotiated();
      return client.request(request);
    },
    async stream(request) {
      await ensureNegotiated();
      await client.stream(request);
    },
  };
}
