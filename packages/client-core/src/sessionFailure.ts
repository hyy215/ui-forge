/** 为页面与 CLI 解释原生失败信息；只生成提示，不重试或改变任务状态。 */
import { z } from "zod";

/** 原生错误的展示信息；继续建议不判断服务是否已经恢复。 */
export interface SessionFailure {
  /** 面向用户的错误类别。 */
  title: string;
  /** 只说明失败原因，不把原始载荷混入默认提示。 */
  message: string;
  /** 依据明确错误类别提供人工处理建议，不执行任何操作。 */
  guidance: string;
  /** 有界的原始 message，供折叠展示；不展开错误对象的其他字段。 */
  details: string;
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
const connectionDetailsSchema = z.union([
  z.strictObject({ httpStatusCode: z.number().int().nullable() }),
  z.strictObject({ http_status_code: z.number().int().nullable() }),
]);

const explanations = new Map<string, Omit<SessionFailure, "details">>([
  [
    "serverOverloaded",
    {
      title: "模型暂时繁忙",
      message: "模型服务暂时没有可用容量，本轮未能完成。",
      guidance: "可稍后继续原任务；继续前先核对工作区和已有验证结果，服务不一定已经恢复。",
      canContinue: true,
    },
  ],
  [
    "contextWindowExceeded",
    {
      title: "会话上下文已达上限",
      message: "本轮超出模型可处理的上下文范围。",
      guidance: "先保留已完成内容和未完成清单，检查上下文限制；直接重复提交不一定能解决。",
      canContinue: false,
    },
  ],
  [
    "usageLimitExceeded",
    {
      title: "使用额度已达上限",
      message: "当前账号的可用额度不足。",
      guidance: "检查账号额度与恢复时间，条件恢复后再继续；无需重复创建同一任务。",
      canContinue: false,
    },
  ],
  [
    "sessionBudgetExceeded",
    {
      title: "会话预算已达上限",
      message: "本轮受到会话预算限制。",
      guidance: "先查看已有结果和剩余工作，再检查当前会话的预算设置；不要反复提交相同请求。",
      canContinue: false,
    },
  ],
  [
    "rateLimitExceeded",
    {
      title: "请求频率已达上限",
      message: "上游服务限制了当前请求频率。",
      guidance: "等待限流恢复后再尝试，先保留已有结果，不要连续重复提交。",
      canContinue: false,
    },
  ],
  [
    "httpConnectionFailed",
    {
      title: "上游服务连接失败",
      message: "未能连接模型服务，不能据此判断是容量不足。",
      guidance: "检查网络、代理和服务状态，再查看任务诊断；确认实际任务状态后决定是否继续。",
      canContinue: false,
    },
  ],
  ...[
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
  ].map((code): [string, Omit<SessionFailure, "details">] => [
    code,
    {
      title: "模型响应中断",
      message: "模型响应未能完整传回，本轮未能完成。",
      guidance: "先核对已记录的工具输出和工作区，检查网络与服务状态，不要假设之前的操作未执行。",
      canContinue: false,
    },
  ]),
  [
    "unauthorized",
    {
      title: "身份验证失败",
      message: "当前模型服务认证未通过。",
      guidance: "检查 Codex 登录或服务凭据，修复后再继续；不要将凭据粘贴到需求或报告中。",
      canContinue: false,
    },
  ],
  [
    "sandboxError",
    {
      title: "沙箱执行受限",
      message: "本轮遇到沙箱执行错误，不能等同于用户拒绝审批。",
      guidance: "查看错误详情及原始审批范围，确认目标工作区和可写目录；不要通过关闭沙箱来重试。",
      canContinue: false,
    },
  ],
  [
    "badRequest",
    {
      title: "请求未被接受",
      message: "上游服务拒绝了当前请求参数。",
      guidance: "检查任务诊断和原始错误中的参数问题，修正后再提交。",
      canContinue: false,
    },
  ],
]);

/** 识别结构化错误码；兼容原始历史的 snake_case，不根据 HTTP 状态猜测容量问题。 */
export function getSessionFailure(error: unknown): SessionFailure | undefined {
  if (error === null || error === undefined) return undefined;
  const parsed = failureSchema.safeParse(error);
  const original = parsed.success
    ? parsed.data.message
    : typeof error === "string"
      ? error
      : "未提供可显示的错误信息。";
  const info = parsed.success
    ? (parsed.data.codexErrorInfo ?? parsed.data.codex_error_info)
    : undefined;
  const keys = info && typeof info === "object" && !Array.isArray(info) ? Object.keys(info) : [];
  const code = typeof info === "string" ? info : keys.length === 1 ? keys[0] : undefined;
  const normalized = code?.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const structured = [
    "httpConnectionFailed",
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
  ];
  const payload = z.record(z.string(), z.unknown()).safeParse(info);
  const validCode =
    normalized &&
    (typeof info === "string"
      ? !structured.includes(normalized)
      : structured.includes(normalized) &&
        payload.success &&
        code !== undefined &&
        connectionDetailsSchema.safeParse(payload.data[code]).success);
  const explanation = normalized && validCode ? explanations.get(normalized) : undefined;
  return {
    ...(explanation ?? {
      title: "Codex 返回错误",
      message: "本轮执行失败，尚不能确定具体原因。",
      guidance:
        "先查看任务诊断、错误详情和已有交付记录，再决定下一步；不要仅凭错误文字推断容量或权限问题。",
      canContinue: false,
    }),
    details: original.length > 12_000 ? `${original.slice(0, 12_000)}\n[错误详情已截断]` : original,
  };
}
