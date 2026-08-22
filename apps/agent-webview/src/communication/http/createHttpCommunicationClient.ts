/** 实现浏览器环境下经过协议校验、支持超时和取消的 HTTP 通信客户端。 */
import {
  communicationResponseMessageSchema,
  communicationStreamMessageSchema,
  createCommunicationNotificationMessage,
  createCommunicationRequestMessage,
  createCommunicationStreamRequestMessage,
} from "@ui-forge/shared-protocol";
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
      const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs);

      /** 将调用方取消信号转发给当前 HTTP 请求。 */
      function handleAbort() {
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
      } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
      }
    },
    stream: async ({ method, params, eventSchema, onEvent, signal, timeoutMs = 0 }) => {
      requestSequence += 1;
      const requestId = `web-stream-${requestSequence}`;
      const timeoutController = new AbortController();
      const timeout = timeoutMs > 0
        ? window.setTimeout(() => timeoutController.abort(), timeoutMs)
        : undefined;

      /** 将调用方取消信号转发给当前 HTTP 流。 */
      function handleAbort() {
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
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastSeq = 0;
        let finished = false;

        /** 解析并消费一行与当前请求关联的有序流消息。 */
        async function consumeLine(line: string): Promise<void> {
          if (!line.trim()) return;
          const messageResult = communicationStreamMessageSchema.safeParse(JSON.parse(line));
          if (!messageResult.success || messageResult.data.requestId !== requestId) {
            throw new Error("HTTP 流式通信消息格式或关联标识无效。");
          }
          const message = messageResult.data;
          if (message.seq !== lastSeq + 1) throw new Error("HTTP 流式通信事件顺序无效。");
          lastSeq = message.seq;
          if (message.kind === "stream-heartbeat") return;
          if (message.kind === "stream-error") throw new Error(message.error.message);
          if (message.kind === "stream-complete") {
            finished = true;
            return;
          }
          const eventResult = eventSchema.safeParse(message.event);
          if (!eventResult.success) {
            throw new Error(`流式领域事件格式无效：${eventResult.error.message}`);
          }
          await onEvent(eventResult.data);
        }

        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            await consumeLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
          }
        }
        buffer += decoder.decode();
        await consumeLine(buffer);
        if (!finished) throw new Error("HTTP 流式通信在完成消息前结束。");
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        signal?.removeEventListener("abort", handleAbort);
      }
    },
  };
}
