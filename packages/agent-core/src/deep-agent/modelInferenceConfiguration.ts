/** 在 Core 边界校验供应商推理能力，并转换为兼容 Chat API 的受控参数。 */

import { z } from "zod";

const inferenceSchema = z.object({
  thinking: z.boolean().optional(),
  thinkingBudget: z.number().int().min(1).max(262_144).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  maximumOutputTokens: z.number().int().min(1).max(393_216).optional(),
}).strict();

/** 单个阶段的推理开关、预算和输出上限；不包含任意供应商参数。 */
export type ModelInferenceConfiguration = z.infer<typeof inferenceSchema>;

/** 模型身份与可选推理配置；只由可信组合入口提供。 */
export interface ModelConnectionOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  inference?: ModelInferenceConfiguration;
}

const providerBaseUrls: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

/** 解析认证与端点，延迟到模型实际调用时才要求凭据齐备。 */
export function resolveModelConnection(options: ModelConnectionOptions): {
  baseUrl: string; model: string; apiKey: string;
} {
  const provider = options.provider?.trim();
  const model = options.model?.trim();
  const apiKey = options.apiKey?.trim();
  if (!provider) throw new Error("缺少 MODEL_PROVIDER，无法调用 Agent。");
  if (!model) throw new Error("缺少 MODEL_NAME，无法调用 Agent。");
  if (!apiKey) throw new Error("缺少 MODEL_API_KEY，无法调用 Agent。");
  const baseUrl = options.baseUrl?.trim().replace(/\/$/, "") || providerBaseUrls[provider];
  if (!baseUrl) throw new Error(`模型供应商 ${provider} 未配置 MODEL_BASE_URL。`);
  const url = new URL(baseUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("模型端点必须是无内嵌凭据的 HTTP(S) URL。");
  }
  return { baseUrl, model, apiKey };
}

/** 判断已核对的百炼型号是否支持原生严格 JSON Schema。 */
export function supportsNativeJsonSchema(options: ModelConnectionOptions): boolean {
  return ["bailian", "qwen"].includes(options.provider ?? "")
    && /^qwen3\.(?:7-(?:plus|max|flash)|8-(?:max|flash))(?:-|$)/.test(options.model ?? "");
}

/** 校验型号对应的推理参数，避免忽略预算或把百炼参数发送到其他服务。 */
export function createModelInferenceParameters(options: ModelConnectionOptions): Record<string, unknown> {
  const inference = inferenceSchema.parse(options.inference ?? {});
  if (Object.keys(inference).length === 0) return {};
  const bailian = ["bailian", "qwen"].includes(options.provider ?? "");
  const model = options.model ?? "";
  const qwen = /^qwen3\.(?:7|8)-(?:plus|max|flash)(?:-|$)/.test(model);
  const deepseek = /^deepseek-v4-(?:pro|flash)(?:-|$)/.test(model);
  if (!bailian || (!qwen && !deepseek)) {
    throw new Error("当前推理配置仅支持已验证的百炼 Qwen3.7/3.8 和 DeepSeek V4 型号。");
  }
  if (inference.thinking === false && (inference.thinkingBudget || inference.reasoningEffort)) {
    throw new Error("关闭思考时不能同时设置思考预算或推理强度。");
  }
  if (inference.thinkingBudget && inference.reasoningEffort) {
    throw new Error("thinkingBudget 与 reasoningEffort 必须二选一。");
  }
  if (deepseek && inference.thinkingBudget) {
    throw new Error("百炼 DeepSeek V4 使用 reasoningEffort 控制推理，不发送 Qwen 思考预算。");
  }
  if (inference.reasoningEffort) {
    const allowed = deepseek
      ? (/^(deepseek-v4-pro-0813|deepseek-v4-flash-0731)$/.test(model)
        ? ["low", "high", "max"] : ["high", "max"])
      : model.startsWith("qwen3.8-") ? ["low", "medium", "xhigh"] : [];
    if (!allowed.includes(inference.reasoningEffort)) throw new Error("该型号不支持配置的 reasoningEffort。");
  }
  return {
    ...(inference.thinking !== undefined ? { enable_thinking: inference.thinking } : {}),
    ...(inference.thinkingBudget ? { thinking_budget: inference.thinkingBudget } : {}),
    ...(inference.reasoningEffort ? { reasoning_effort: inference.reasoningEffort } : {}),
    ...(inference.maximumOutputTokens ? { max_completion_tokens: inference.maximumOutputTokens } : {}),
  };
}
