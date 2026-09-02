/** 统一识别模型流式传输中断，并提供不泄露请求配置的稳定错误信息。 */

/** 表示单个模型流在一次受控重试后仍未完整结束。 */
export class ModelStreamRetryExhaustedError extends Error {
  /** 保留最终传输异常作为 cause，供安全日志继续提取名称和错误码。 */
  constructor(error: unknown) {
    super(`模型流式连接中断，自动重试 1 次后仍然失败：${readModelTransportErrorMessage(error)}`, {
      cause: error,
    });
    this.name = "ModelStreamRetryExhaustedError";
  }
}

/** 识别 OpenAI 兼容客户端与 Node 网络栈暴露的瞬时断连信号。 */
export function isTransientModelTransportError(error: unknown, depth = 0): boolean {
  if (depth > 3 || !isRecord(error)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  if (name === "AbortError") return false;
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  if (["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET"].includes(code)) return true;
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (/\bterminated\b|socket hang up|connection reset|other side closed/.test(message)) return true;
  return isTransientModelTransportError(error.cause, depth + 1);
}

/** 把未知传输异常转换为可展示且不泄露请求配置的短消息。 */
export function readModelTransportErrorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" && error.message.trim()
    ? error.message.trim()
    : "远端连接已关闭";
}

/** 从未知传输异常读取稳定名称。 */
export function readModelTransportErrorName(error: unknown): string {
  return isRecord(error) && typeof error.name === "string" && error.name.trim()
    ? error.name.trim()
    : "UnknownError";
}

/** 沿 cause 链读取可审计网络错误码。 */
export function readModelTransportErrorCode(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || !isRecord(error)) return undefined;
  if (typeof error.code === "string" && error.code.trim()) return error.code.trim();
  return readModelTransportErrorCode(error.cause, depth + 1);
}

/** 将未知运行时值收窄为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
