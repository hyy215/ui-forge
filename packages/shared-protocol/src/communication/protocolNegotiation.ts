/** 定义 Client 与 Agent Server 在业务调用前使用的协议版本和能力协商。 */

import { z } from "zod";

/** 当前第一方 Client 与 Server 支持的通信协议版本。 */
export const currentCommunicationProtocolVersion = 7 as const;

/** 当前协议公开且可稳定协商的能力集合。 */
export const communicationCapabilities = [
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
] as const;

/** 第一方 UI 正常工作所需的最小能力集合。 */
export const firstPartyRequiredCommunicationCapabilities = [
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
] as const;

/** 校验服务端声明的稳定能力，不接受未知能力污染当前 Client。 */
export const communicationCapabilitySchema = z.enum(communicationCapabilities);

/** Client 发起协商时声明的版本和所需能力。 */
export const negotiateCommunicationProtocolInputSchema = z.object({
  protocolVersion: z.number().int().positive(),
  requiredCapabilities: z.array(z.string().min(1)),
});

/** Server 协商成功后返回的版本和完整稳定能力。 */
export const negotiateCommunicationProtocolResultSchema = z.object({
  protocolVersion: z.literal(currentCommunicationProtocolVersion),
  capabilities: z.array(communicationCapabilitySchema),
});

export type CommunicationCapability = z.infer<typeof communicationCapabilitySchema>;
export type NegotiateCommunicationProtocolInput = z.infer<
  typeof negotiateCommunicationProtocolInputSchema
>;
export type NegotiateCommunicationProtocolResult = z.infer<
  typeof negotiateCommunicationProtocolResultSchema
>;

/** 创建第一方 Client 默认使用的协商输入。 */
export function createCommunicationProtocolNegotiationInput(
  requiredCapabilities: readonly string[] = firstPartyRequiredCommunicationCapabilities,
): NegotiateCommunicationProtocolInput {
  return {
    protocolVersion: currentCommunicationProtocolVersion,
    requiredCapabilities: [...requiredCapabilities],
  };
}
