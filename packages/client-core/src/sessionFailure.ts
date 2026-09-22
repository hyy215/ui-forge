/** 为页面与 CLI 解释原生失败信息；只生成提示，不重试或改变任务状态。 */
import { z } from "zod";

/** 一次原生错误的展示文案及是否适合在容量恢复后继续原任务。 */
export interface SessionFailure {
  /** 面向用户的错误类别。 */
  title: string;
  /** 说明下一步并保留原始错误，便于排查。 */
  message: string;
  /** 仅表示可展示主动继续入口，不判断服务当前是否可用。 */
  canContinue: boolean;
}

/** 用户主动继续时先核对现场，避免重复已有执行结果。 */
export const continuationPrompt =
  "继续当前任务，先检查原会话记录、实际工作区及已有验证结果，只处理尚未完成的工作。复用仍有效的验证结果，避免重复已完成的修改或有副作用的操作；无法确认时先核实当前状态。";

const failureSchema = z.object({
  message: z.string(),
  codexErrorInfo: z.unknown().optional(),
  codex_error_info: z.unknown().optional(),
});

/** 识别结构化错误码；兼容原始历史的 snake_case，不根据 HTTP 状态猜测容量问题。 */
export function getSessionFailure(error: unknown): SessionFailure | undefined {
  if (error === null || error === undefined) return undefined;
  const parsed = failureSchema.safeParse(error);
  const original = parsed.success
    ? parsed.data.message
    : typeof error === "string"
      ? error
      : (JSON.stringify(error) ?? "未知错误");
  const code = parsed.success
    ? (parsed.data.codexErrorInfo ?? parsed.data.codex_error_info)
    : undefined;
  if (code === "serverOverloaded" || code === "server_overloaded")
    return {
      title: "模型暂时繁忙",
      message: `可稍后继续原任务，先检查已有文件和验证结果。原始错误：${original}`,
      canContinue: true,
    };
  if (code === "contextWindowExceeded" || code === "context_window_exceeded")
    return {
      title: "会话上下文已达上限",
      message: `请先整理已有结果与未完成工作，再处理上下文限制。原始错误：${original}`,
      canContinue: false,
    };
  if (code === "usageLimitExceeded" || code === "usage_limit_exceeded")
    return {
      title: "使用额度已达上限",
      message: `请检查账号额度及恢复时间。原始错误：${original}`,
      canContinue: false,
    };
  if (code === "sessionBudgetExceeded" || code === "session_budget_exceeded")
    return {
      title: "会话预算已达上限",
      message: `请检查当前任务的预算设置。原始错误：${original}`,
      canContinue: false,
    };
  if (code === "rateLimitExceeded" || code === "rate_limit_exceeded")
    return {
      title: "请求频率已达上限",
      message: `请稍后再尝试。原始错误：${original}`,
      canContinue: false,
    };
  return { title: "Codex 返回错误", message: original, canContinue: false };
}
