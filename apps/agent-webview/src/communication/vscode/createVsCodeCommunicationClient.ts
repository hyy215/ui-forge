/** 实现 VS Code Webview 消息通道上的请求关联、校验、超时和取消。 */
import {
  communicationTransportMethods,
  communicationResponseMessageSchema,
  communicationStreamMessageSchema,
  createCommunicationNotificationMessage,
  createCommunicationRequestMessage,
  createCommunicationStreamRequestMessage,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../clientContract";

/** VS Code Webview 暴露给页面的最小消息 API。 */
interface VsCodeApi {
  postMessage(message: unknown): void;
}

/** VS Code 注入到 Webview 全局环境中的 API 工厂。 */
type AcquireVsCodeApi = () => VsCodeApi;

/** 带有可选 VS Code API 工厂的浏览器窗口。 */
type VsCodeWindow = Window & {
  acquireVsCodeApi?: AcquireVsCodeApi;
};

/** 判断当前窗口是否由 VS Code Webview 承载。 */
export function isVsCodeRuntime(targetWindow: Window = window): boolean {
  return typeof (targetWindow as VsCodeWindow).acquireVsCodeApi === "function";
}

/** 创建基于 VS Code Webview 消息通道的通信客户端。 */
export function createVsCodeCommunicationClient(targetWindow: Window = window): CommunicationClient {
  const acquireVsCodeApi = (targetWindow as VsCodeWindow).acquireVsCodeApi;
  if (!acquireVsCodeApi) {
    throw new Error("当前页面未运行在 VS Code Webview 中。");
  }

  const api = acquireVsCodeApi();
  let requestSequence = 0;

  return {
    notify: ({ method, params }) => {
      api.postMessage(createCommunicationNotificationMessage(method, params));
    },
    request: ({ method, params, responseSchema, signal, timeoutMs = 10_000 }) => new Promise((resolve, reject) => {
      requestSequence += 1;
      const requestId = `webview-${requestSequence}`;
      let timeout: number | undefined;

      /** 释放本次请求注册的浏览器资源。 */
      function cleanup() {
        if (timeout !== undefined) targetWindow.clearTimeout(timeout);
        targetWindow.removeEventListener("message", handleMessage);
        signal?.removeEventListener("abort", handleAbort);
      }

      /** 在调用方取消时终止本次请求。 */
      function handleAbort() {
        cleanup();
        reject(new DOMException("通信请求已取消。", "AbortError"));
      }

      /** 接收并校验与当前请求标识匹配的响应。 */
      function handleMessage(event: MessageEvent<unknown>) {
        const messageResult = communicationResponseMessageSchema.safeParse(event.data);
        if (!messageResult.success || messageResult.data.requestId !== requestId) return;

        cleanup();
        if (!messageResult.data.success) {
          reject(new Error(messageResult.data.error.message));
          return;
        }

        const responseResult = responseSchema.safeParse(messageResult.data.data);
        if (!responseResult.success) {
          reject(new Error(`通信响应格式无效：${responseResult.error.message}`));
          return;
        }
        resolve(responseResult.data);
      }

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      timeout = targetWindow.setTimeout(() => {
        cleanup();
        reject(new Error(`通信请求超时：${method}`));
      }, timeoutMs);
      signal?.addEventListener("abort", handleAbort, { once: true });
      targetWindow.addEventListener("message", handleMessage);
      api.postMessage(createCommunicationRequestMessage(requestId, method, params));
    }),
    stream: ({ method, params, eventSchema, onEvent, signal, timeoutMs = 0 }) => new Promise((resolve, reject) => {
      requestSequence += 1;
      const requestId = `webview-stream-${requestSequence}`;
      let timeout: number | undefined;
      let lastSeq = 0;
      let processing = Promise.resolve();
      let cancellationSent = false;

      /** 释放本次流调用注册的浏览器资源。 */
      function cleanup() {
        if (timeout !== undefined) targetWindow.clearTimeout(timeout);
        targetWindow.removeEventListener("message", handleMessage);
        signal?.removeEventListener("abort", handleAbort);
      }

      /** 以取消异常结束当前流调用。 */
      function handleAbort() {
        cancelHostStream();
        cleanup();
        reject(new DOMException("流式通信请求已取消。", "AbortError"));
      }

      /** 通知 Extension 中止与当前 requestId 绑定的上游 fetch。 */
      function cancelHostStream() {
        if (cancellationSent) return;
        cancellationSent = true;
        api.postMessage(createCommunicationNotificationMessage(
          communicationTransportMethods.cancelStream,
          { requestId },
        ));
      }

      /** 串行校验并消费当前请求的下一条流消息。 */
      async function consumeMessage(message: ReturnType<typeof communicationStreamMessageSchema.parse>) {
        if (message.seq !== lastSeq + 1) throw new Error("VS Code 流式通信事件顺序无效。");
        lastSeq = message.seq;
        if (message.kind === "stream-heartbeat") return;
        if (message.kind === "stream-error") throw new Error(message.error.message);
        if (message.kind === "stream-complete") {
          cleanup();
          resolve();
          return;
        }
        const eventResult = eventSchema.safeParse(message.event);
        if (!eventResult.success) {
          throw new Error(`流式领域事件格式无效：${eventResult.error.message}`);
        }
        await onEvent(eventResult.data);
      }

      /** 接收与当前请求关联的流信封，并保持异步回调执行顺序。 */
      function handleMessage(event: MessageEvent<unknown>) {
        const messageResult = communicationStreamMessageSchema.safeParse(event.data);
        if (!messageResult.success || messageResult.data.requestId !== requestId) return;
        processing = processing.then(() => consumeMessage(messageResult.data)).catch((error: unknown) => {
          cleanup();
          reject(error);
        });
      }

      if (signal?.aborted) {
        handleAbort();
        return;
      }
      if (timeoutMs > 0) {
        timeout = targetWindow.setTimeout(() => {
          cancelHostStream();
          cleanup();
          reject(new Error(`流式通信请求超时：${method}`));
        }, timeoutMs);
      }
      signal?.addEventListener("abort", handleAbort, { once: true });
      targetWindow.addEventListener("message", handleMessage);
      api.postMessage(createCommunicationStreamRequestMessage(requestId, method, params));
    }),
  };
}
