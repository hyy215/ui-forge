/** 注册协议协商和 shared-protocol 业务通信端点。 */

import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import {
  communicationCapabilities,
  communicationInboundMessageSchema,
  communicationTransportMethods,
  createFailedCommunicationResponseMessage,
  createSuccessfulCommunicationResponseMessage,
  currentCommunicationProtocolVersion,
  negotiateCommunicationProtocolInputSchema,
  type CommunicationStreamMessage,
} from "@ui-forge/shared-protocol";
import type { CommunicationRequestHandler } from "./communicationRequestHandler.js";
import type { CommunicationStreamRequestHandler } from "./communicationStreamRequestHandler.js";

/** 注册统一通信路由，并在传输边界完成协议协商、Schema 校验和错误关联。 */
export function registerCommunicationRoute(
  app: FastifyInstance,
  requestHandler: CommunicationRequestHandler,
  streamRequestHandler: CommunicationStreamRequestHandler,
): void {
  app.post("/api/communication", async (request, reply) => {
    const messageResult = communicationInboundMessageSchema.safeParse(request.body);
    if (!messageResult.success) {
      return reply.status(400).send({
        code: "invalid_communication_message",
        message: "Communication message did not match the shared protocol.",
        issues: messageResult.error.issues,
      });
    }

    const message = messageResult.data;
    if (message.kind === "request" && message.method === communicationTransportMethods.negotiateProtocol) {
      try {
        const input = negotiateCommunicationProtocolInputSchema.parse(message.params);
        if (input.protocolVersion !== currentCommunicationProtocolVersion) {
          throw new Error(
            `通信协议版本不兼容：Client=${input.protocolVersion}，Server=${currentCommunicationProtocolVersion}。`,
          );
        }
        const supported = new Set<string>(communicationCapabilities);
        const missing = input.requiredCapabilities.filter((capability) => !supported.has(capability));
        if (missing.length > 0) throw new Error(`Agent Server 缺少必需通信能力：${missing.join("、")}。`);
        return createSuccessfulCommunicationResponseMessage(message.requestId, {
          protocolVersion: currentCommunicationProtocolVersion,
          capabilities: [...communicationCapabilities],
        });
      } catch (error: unknown) {
        return createFailedCommunicationResponseMessage(
          message.requestId,
          error instanceof Error ? error.message : "通信协议协商失败。",
        );
      }
    }
    if (message.kind === "notification") return reply.status(202).send();
    if (message.kind === "stream-request") {
      reply.header("content-type", "application/x-ndjson; charset=utf-8");
      reply.header("cache-control", "no-store");
      const controller = new AbortController();
      const handleDisconnect = () => controller.abort();
      request.raw.once("aborted", handleDisconnect);
      reply.raw.once("close", handleDisconnect);
      const stream = Readable.from(toNdjson(
        streamRequestHandler.handle(message, controller.signal),
      ));
      stream.once("close", () => {
        request.raw.removeListener("aborted", handleDisconnect);
        reply.raw.removeListener("close", handleDisconnect);
      });
      return reply.send(stream);
    }
    return requestHandler.handle(message);
  });
}

/** 将结构化流信封逐条编码为不会跨行的 NDJSON。 */
async function* toNdjson(
  messages: AsyncIterable<CommunicationStreamMessage>,
): AsyncIterable<string> {
  for await (const message of messages) yield `${JSON.stringify(message)}\n`;
}
