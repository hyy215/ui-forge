/** 把原生通知和交互按线程路由；订阅只负责传输缓存，不驱动任务。 */
import {
  nativeNotificationSchema,
  pendingRequestSchema,
  type SessionEvent,
} from "@ui-forge/shared-protocol";
import type { CodexEvent } from "@ui-forge/codex-client";

/** 从原生载荷中读取线程身份，兼容旧原生审批字段。 */
export function eventThreadId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  if ("threadId" in params && typeof params.threadId === "string") return params.threadId;
  if ("conversationId" in params && typeof params.conversationId === "string")
    return params.conversationId;
  if (
    "thread" in params &&
    params.thread &&
    typeof params.thread === "object" &&
    "id" in params.thread &&
    typeof params.thread.id === "string"
  )
    return params.thread.id;
  return undefined;
}
/** 保留原生通知字段，连接错误只保留可展示信息。 */
export function toSessionEvent(event: CodexEvent): SessionEvent | undefined {
  if (event.type === "notification" || event.type === "unknownNotification")
    return {
      type: "notification",
      notification: nativeNotificationSchema.parse(event.notification),
    };
  if (event.type === "request")
    return {
      type: "request",
      pending: pendingRequestSchema.parse({ token: event.token, request: event.request }),
    };
  if (event.type === "close") return { type: "close", message: event.error.message };
  if (event.type === "unsupportedRequest")
    return { type: "diagnostic", message: `Codex 请求暂不支持：${event.method}` };
  if (event.type === "lateResponse")
    return {
      type: "diagnostic",
      message: `Codex 请求 ${event.requestId}（${event.method}）已返回迟到响应，请刷新会话确认。`,
    };
  return undefined;
}

/** 有界事件队列，慢客户端需重连读取原生历史，不无限占用服务内存。 */
export class SessionEventQueue {
  private readonly values: SessionEvent[] = [];
  private wake: (() => void) | undefined;
  private failure: Error | undefined;
  /** 入队并唤醒等待中的流。 */
  push(event: SessionEvent): void {
    if (this.failure) return;
    if (this.values.length >= 4096) {
      this.failure = new Error("客户端消费过慢，请重新连接任务。");
      this.values.length = 0;
    } else this.values.push(event);
    this.wake?.();
  }
  /** 等待事件或心跳；取消只清理当前订阅。 */
  async next(signal: AbortSignal): Promise<SessionEvent | undefined> {
    if (!this.values.length && !this.failure && !signal.aborted)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          this.wake = undefined;
          resolve();
        };
        const timer = setTimeout(done, 15_000);
        this.wake = done;
        signal.addEventListener("abort", done, { once: true });
      });
    if (this.failure) throw this.failure;
    return this.values.shift();
  }
}
