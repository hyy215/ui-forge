/** 消费有序 NDJSON 信封；浏览器、Extension 和 CLI 共享分帧、校验及 reader 清理。 */
import {
  communicationStreamMessageSchema,
  type CommunicationStreamMessage,
} from "@ui-forge/shared-protocol";

/** 消费到结束信封即停止；错误、取消及调用方提前退出均释放上游流。 */
export async function* readCommunicationStream(
  body: ReadableStream<Uint8Array>,
  requestId: string,
  signal?: AbortSignal,
): AsyncIterable<CommunicationStreamMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seq = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("通信流已取消。", "AbortError");
      const chunk = await reader.read();
      if (signal?.aborted) throw new DOMException("通信流已取消。", "AbortError");
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0 || (chunk.done && buffer.length > 0)) {
        const end = newline < 0 ? buffer.length : newline;
        const line = buffer.slice(0, end);
        buffer = newline < 0 ? "" : buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = communicationStreamMessageSchema.parse(JSON.parse(line));
        if (message.requestId !== requestId || message.seq !== seq + 1)
          throw new Error("会话事件身份或顺序无效。");
        seq = message.seq;
        yield message;
        if (message.kind === "stream-complete" || message.kind === "stream-error") return;
        if (signal?.aborted) throw new DOMException("通信流已取消。", "AbortError");
      }
      if (chunk.done) throw new Error("会话流在完成消息前结束。");
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
