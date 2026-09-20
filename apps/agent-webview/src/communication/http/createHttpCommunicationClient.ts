/** 实现浏览器环境下经过协议校验、支持超时和取消的 HTTP 通信客户端。 */
import {
  communicationResponseMessageSchema,
  createCommunicationNotificationMessage,
  createCommunicationRequestMessage,
  createCommunicationStreamRequestMessage,
} from "@ui-forge/shared-protocol";
import { readCommunicationStream } from "@ui-forge/client-core";
import type { CommunicationClient } from "../clientContract";

/** HTTP 通信客户端的运行参数。 */
export interface HttpCommunicationClientOptions {
  endpoint?: string;
  fetchImplementation?: typeof fetch;
}

/** 创建使用统一消息封装和单一 HTTP 端点的通信客户端。 */
export function createHttpCommunicationClient(
  options: HttpCommunicationClientOptions = {},
): CommunicationClient {
  const endpoint = options.endpoint ?? "/api/communication";
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let requestSequence = 0;

  /** 向通信端点发送 JSON 消息。 */
  function send(message: unknown, signal?: AbortSignal): Promise<Response> {
    return fetchImplementation(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      ...(signal ? { signal } : {}),
    });
  }

  return {
    notify: ({ method, params }) => {
      void send(createCommunicationNotificationMessage(method, params)).catch(() => undefined);
    },
    request: async ({ method, params, responseSchema, signal, timeoutMs = 10_000 }) => {
      requestSequence += 1;
      const requestId = `web-${requestSequence}`;
      const timeoutController = new AbortController();
      let timedOut = false;
      let cancelledByCaller = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);

      /** 将调用方取消信号转发给当前 HTTP 请求。 */
      function handleAbort() {
        cancelledByCaller = true;
        timeoutController.abort();
      }

      if (signal?.aborted) handleAbort();
      signal?.addEventListener("abort", handleAbort, { once: true });

      try {
        const response = await send(
          createCommunicationRequestMessage(requestId, method, params),
          timeoutController.signal,
        );
        if (!response.ok) {
          throw new Error(`HTTP 通信失败：${response.status} ${response.statusText}`);
        }

        const messageResult = communicationResponseMessageSchema.safeParse(await response.json());
        if (!messageResult.success || messageResult.data.requestId !== requestId) {
          throw new Error("HTTP 通信响应格式无效。");
        }
        if (!messageResult.data.success) {
          throw new Error(messageResult.data.error.message);
        }

        const responseResult = responseSchema.safeParse(messageResult.data.data);
        if (!responseResult.success) {
          throw new Error(`通信响应格式无效：${responseResult.error.message}`);
        }
        return responseResult.data;
      } catch (error: unknown) {
        if (timedOut) throw new Error(`通信请求超时：${method}`);
        if (cancelledByCaller) throw new DOMException("通信请求已取消。", "AbortError");
        throw error;
      } finally {
        timeoutController.abort();
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
      }
    },
    stream: async ({ method, params, eventSchema, onEvent, signal, timeoutMs = 0 }) => {
      requestSequence += 1;
      const requestId = `web-stream-${requestSequence}`;
      const timeoutController = new AbortController();
      let timedOut = false;
      let cancelledByCaller = false;
      const timeout =
        timeoutMs > 0
          ? window.setTimeout(() => {
              timedOut = true;
              timeoutController.abort();
            }, timeoutMs)
          : undefined;

      /** 将调用方取消信号转发给当前 HTTP 流。 */
      function handleAbort() {
        cancelledByCaller = true;
        timeoutController.abort();
      }

      if (signal?.aborted) handleAbort();
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        const response = await send(
          createCommunicationStreamRequestMessage(requestId, method, params),
          timeoutController.signal,
        );
        if (!response.ok) {
          throw new Error(`HTTP 流式通信失败：${response.status} ${response.statusText}`);
        }
        if (!response.body) throw new Error("HTTP 流式通信没有响应体。");
        for await (const message of readCommunicationStream(
          response.body,
          requestId,
          timeoutController.signal,
        )) {
          if (message.kind === "stream-error") throw new Error(message.error.message);
          if (message.kind === "stream-event") await onEvent(eventSchema.parse(message.event));
        }
      } catch (error: unknown) {
        if (timedOut) throw new Error(`流式通信请求超时：${method}`);
        if (cancelledByCaller) throw new DOMException("流式通信请求已取消。", "AbortError");
        throw error;
      } finally {
        timeoutController.abort();
        if (timeout !== undefined) window.clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
      }
    },
  };
}
