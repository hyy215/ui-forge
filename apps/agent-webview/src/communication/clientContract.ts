/** 定义 Webview 功能层依赖的环境无关通信客户端接口。 */
import type { z } from "zod";

/** 单向通知调用，发送方不等待接收方返回结果。 */
export interface CommunicationNotification {
  method: string;
  params?: unknown;
}

/** 双向请求调用，响应在返回给调用方前必须通过指定 Schema 校验。 */
export interface CommunicationRequest<TResult> {
  method: string;
  params?: unknown;
  responseSchema: z.ZodType<TResult>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** 流式调用参数以及每个已校验领域事件的消费回调。 */
export interface CommunicationStreamRequest<TEvent> {
  method: string;
  params?: unknown;
  eventSchema: z.ZodType<TEvent>;
  onEvent(event: TEvent): void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** 隔离 Webview 功能代码与 VS Code、HTTP 等具体通信方式的客户端接口。 */
export interface CommunicationClient {
  notify(notification: CommunicationNotification): void;
  request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult>;
  /** 关联并按顺序消费服务端流事件，直到完成、失败或取消。 */
  stream<TEvent>(request: CommunicationStreamRequest<TEvent>): Promise<void>;
}
