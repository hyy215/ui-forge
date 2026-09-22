/** 将诊断白名单字段转换为中文文案，区分未采集值与真实的零值。 */
import type { DiagnosticWarning, TaskDiagnostics } from "@ui-forge/shared-protocol";

/** 原生错误类别的展示名称，不使用可能含私有内容的异常正文。 */
export const diagnosticErrorLabels: Record<
  NonNullable<TaskDiagnostics["turns"][number]["errorCode"]>,
  string
> = {
  contextWindowExceeded: "上下文达到上限",
  usageLimitExceeded: "使用额度达到上限",
  sessionBudgetExceeded: "会话预算达到上限",
  rateLimitExceeded: "请求频率达到上限",
  serverOverloaded: "服务繁忙，暂无可用容量",
  cyberPolicy: "网络安全策略限制",
  misalignmentPolicyViolation: "安全策略限制",
  httpConnectionFailed: "HTTP 连接失败",
  responseStreamConnectionFailed: "响应流连接失败",
  internalServerError: "服务内部错误",
  unauthorized: "身份验证失败",
  badRequest: "请求无效",
  threadRollbackFailed: "会话回滚失败",
  sandboxError: "沙箱执行失败",
  responseStreamDisconnected: "响应流中断",
  responseTooManyFailedAttempts: "响应重试次数过多",
  activeTurnNotSteerable: "当前轮次无法追加输入",
  other: "其他错误",
};

/** 数据缺口只解释采集限制，不表示对应操作发生了零次。 */
export const diagnosticWarningLabels: Record<DiagnosticWarning, string> = {
  rulesUnavailable: "未记录此任务的规则指纹。",
  tokenUsageUnavailable: "未采集到此任务的 Token 用量。",
  metadataReadFailed: "部分运行信息读取失败，相关字段可能未知。",
  metadataWriteFailed: "部分运行信息未能保存，报告可能不完整。",
  historyIncomplete: "原生会话历史不完整，轮次和工具统计可能缺失。",
  runtimeUnavailable: "未采集到运行时信息。",
  agentsUnavailable: "未采集到子代理信息。",
  concurrencyUnavailable: "未采集到并发统计。",
};

/** 按当前主会话的原生工具类型显示统计，不合并子任务。 */
export const diagnosticToolLabels: Record<
  TaskDiagnostics["turns"][number]["tools"][number]["type"],
  string
> = {
  commandExecution: "命令执行",
  fileChange: "文件修改",
  mcpToolCall: "MCP 工具",
  dynamicToolCall: "动态工具",
  collabAgentToolCall: "子任务协作调用",
  webSearch: "网页搜索",
  imageView: "图片查看",
  imageGeneration: "图片生成",
};

/** 轮次终态沿用报告，不根据工具统计推断是否完成。 */
export const diagnosticTurnLabels: Record<TaskDiagnostics["turns"][number]["status"], string> = {
  inProgress: "运行中",
  completed: "已结束",
  interrupted: "已停止",
  failed: "失败",
};

/** null 明确表示未知；保留 0 毫秒以避免混淆未采集与零值。 */
export function formatDiagnosticDuration(value: number | null): string {
  if (value === null) return "未知";
  return value < 1000
    ? `${value.toLocaleString("zh-CN")} ms`
    : `${(value / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 秒`;
}
