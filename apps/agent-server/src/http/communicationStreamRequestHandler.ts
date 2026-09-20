/** 将原生会话事件包装成现有有序 NDJSON 传输，断开只取消当前订阅。 */
import {
  sessionIdSchema,
  sessionMethods,
  createCommunicationStreamEventMessage,
  createCommunicationStreamHeartbeatMessage,
  createCommunicationStreamCompleteMessage,
  createCommunicationStreamErrorMessage,
  type CommunicationStreamMessage,
  type CommunicationStreamRequestMessage,
} from "@ui-forge/shared-protocol";
import type { SessionService } from "../sessions/sessionService.js";

/** HTTP 流适配器，不持有执行状态。 */
export class CommunicationStreamRequestHandler {
  /** 复用 HTTP 请求侧同一会话服务。 */
  constructor(private readonly sessions: SessionService) {}
  /** 为每个传输连接重新编号；原生消息正文保持不变。 */
  async *handle(
    message: CommunicationStreamRequestMessage,
    signal: AbortSignal,
  ): AsyncIterable<CommunicationStreamMessage> {
    let seq = 0;
    try {
      if (message.method !== sessionMethods.subscribe) throw new Error("不支持的会话订阅。");
      const { taskId } = sessionIdSchema.parse(message.params);
      for await (const event of this.sessions.subscribe(taskId, signal)) {
        if (signal.aborted) return;
        yield event
          ? createCommunicationStreamEventMessage(message.requestId, ++seq, event)
          : createCommunicationStreamHeartbeatMessage(message.requestId, ++seq);
      }
      if (!signal.aborted) yield createCommunicationStreamCompleteMessage(message.requestId, ++seq);
    } catch (error) {
      if (!signal.aborted)
        yield createCommunicationStreamErrorMessage(
          message.requestId,
          ++seq,
          error instanceof Error ? error.message : "会话订阅失败。",
        );
    }
  }
}
