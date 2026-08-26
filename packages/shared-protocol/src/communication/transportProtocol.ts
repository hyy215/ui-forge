/** 定义跨 VS Code、HTTP 等传输方式复用的请求、响应与通知信封。 */
import { z } from "zod";

/** 传输层内部方法，不进入具体业务方法命名空间。 */
export const communicationTransportMethods = {
  cancelStream: "ui-forge.communication.cancel-stream",
  negotiateProtocol: "ui-forge.communication.negotiate-protocol",
} as const;

/** 校验 Webview 请求宿主终止指定传输流的参数。 */
export const cancelCommunicationStreamInputSchema = z.object({
  requestId: z.string().min(1),
});

/** 单向通知在所有运行容器中共享的传输格式。 */
export const communicationNotificationMessageSchema = z.object({
  kind: z.literal("notification"),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

/** 双向请求在所有运行容器中共享的传输格式。 */
export const communicationRequestMessageSchema = z.object({
  kind: z.literal("request"),
  requestId: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

/** 流式调用在所有运行容器中共享的请求信封。 */
export const communicationStreamRequestMessageSchema = z.object({
  kind: z.literal("stream-request"),
  requestId: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

/** 接收端允许处理的通知与请求消息联合格式。 */
export const communicationInboundMessageSchema = z.discriminatedUnion("kind", [
  communicationNotificationMessageSchema,
  communicationRequestMessageSchema,
  communicationStreamRequestMessageSchema,
]);

/** 请求成功时使用的传输层响应格式。 */
export const successfulCommunicationResponseMessageSchema = z.object({
  kind: z.literal("response"),
  requestId: z.string().min(1),
  success: z.literal(true),
  data: z.unknown(),
});

/** 请求失败时使用的传输层响应格式。 */
export const failedCommunicationResponseMessageSchema = z.object({
  kind: z.literal("response"),
  requestId: z.string().min(1),
  success: z.literal(false),
  error: z.object({ message: z.string().min(1) }),
});

/** 所有受支持的请求响应消息格式。 */
export const communicationResponseMessageSchema = z.discriminatedUnion("success", [
  successfulCommunicationResponseMessageSchema,
  failedCommunicationResponseMessageSchema,
]);

/** 流式调用携带一个已排序领域事件的传输信封。 */
export const communicationStreamEventMessageSchema = z.object({
  kind: z.literal("stream-event"),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  event: z.unknown(),
});

/** 长时间没有领域事件时维持外层连接活跃的传输心跳。 */
export const communicationStreamHeartbeatMessageSchema = z.object({
  kind: z.literal("stream-heartbeat"),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
});

/** 流式调用正常完成时使用的传输信封。 */
export const communicationStreamCompleteMessageSchema = z.object({
  kind: z.literal("stream-complete"),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
});

/** 流式调用失败时使用的传输信封。 */
export const communicationStreamErrorMessageSchema = z.object({
  kind: z.literal("stream-error"),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  error: z.object({ message: z.string().min(1) }),
});

/** 服务端向客户端发送的全部流式传输消息。 */
export const communicationStreamMessageSchema = z.discriminatedUnion("kind", [
  communicationStreamEventMessageSchema,
  communicationStreamHeartbeatMessageSchema,
  communicationStreamCompleteMessageSchema,
  communicationStreamErrorMessageSchema,
]);

/** 单向通知消息的已校验类型。 */
export type CommunicationNotificationMessage = z.infer<typeof communicationNotificationMessageSchema>;

/** 双向请求消息的已校验类型。 */
export type CommunicationRequestMessage = z.infer<typeof communicationRequestMessageSchema>;

/** 流式调用请求消息的已校验类型。 */
export type CommunicationStreamRequestMessage = z.infer<typeof communicationStreamRequestMessageSchema>;

/** 接收端允许处理的通知与请求消息。 */
export type CommunicationInboundMessage = z.infer<typeof communicationInboundMessageSchema>;

/** 请求响应消息的已校验类型。 */
export type CommunicationResponseMessage = z.infer<typeof communicationResponseMessageSchema>;

/** 服务端发送的流式传输消息。 */
export type CommunicationStreamMessage = z.infer<typeof communicationStreamMessageSchema>;

/** Webview 终止指定宿主传输流时使用的参数。 */
export type CancelCommunicationStreamInput = z.infer<typeof cancelCommunicationStreamInputSchema>;

/** 创建不包含未定义可选字段的通知传输消息。 */
export function createCommunicationNotificationMessage(
  method: string,
  params?: unknown,
): CommunicationNotificationMessage {
  return params === undefined
    ? { kind: "notification", method }
    : { kind: "notification", method, params };
}

/** 创建不包含未定义可选字段的请求传输消息。 */
export function createCommunicationRequestMessage(
  requestId: string,
  method: string,
  params?: unknown,
): CommunicationRequestMessage {
  return params === undefined
    ? { kind: "request", requestId, method }
    : { kind: "request", requestId, method, params };
}

/** 创建不包含未定义可选字段的流式调用请求。 */
export function createCommunicationStreamRequestMessage(
  requestId: string,
  method: string,
  params?: unknown,
): CommunicationStreamRequestMessage {
  return params === undefined
    ? { kind: "stream-request", requestId, method }
    : { kind: "stream-request", requestId, method, params };
}

/** 创建与指定请求关联的成功响应。 */
export function createSuccessfulCommunicationResponseMessage(
  requestId: string,
  data: unknown,
): CommunicationResponseMessage {
  return { kind: "response", requestId, success: true, data };
}

/** 创建与指定请求关联的失败响应。 */
export function createFailedCommunicationResponseMessage(
  requestId: string,
  message: string,
): CommunicationResponseMessage {
  return { kind: "response", requestId, success: false, error: { message } };
}

/** 创建携带一个领域事件的流消息。 */
export function createCommunicationStreamEventMessage(
  requestId: string,
  seq: number,
  event: unknown,
): CommunicationStreamMessage {
  return communicationStreamEventMessageSchema.parse({
    kind: "stream-event",
    requestId,
    seq,
    event,
  });
}

/** 创建不携带领域数据、但参与严格序号的传输心跳。 */
export function createCommunicationStreamHeartbeatMessage(
  requestId: string,
  seq: number,
): CommunicationStreamMessage {
  return communicationStreamHeartbeatMessageSchema.parse({
    kind: "stream-heartbeat",
    requestId,
    seq,
  });
}

/** 创建流式调用正常结束消息。 */
export function createCommunicationStreamCompleteMessage(
  requestId: string,
  seq: number,
): CommunicationStreamMessage {
  return communicationStreamCompleteMessageSchema.parse({
    kind: "stream-complete",
    requestId,
    seq,
  });
}

/** 创建不包含内部异常对象的流式调用失败消息。 */
export function createCommunicationStreamErrorMessage(
  requestId: string,
  seq: number,
  message: string,
): CommunicationStreamMessage {
  return communicationStreamErrorMessageSchema.parse({
    kind: "stream-error",
    requestId,
    seq,
    error: { message },
  });
}
