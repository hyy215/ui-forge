/** 在 Server 组合边界解析百炼分阶段模型配置，保留现有 MODEL_* 的兼容入口。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { ModelInvocationLog } from "../logging/workspaceRequestLogger.js";

type ModelOptions = D2CAgent.PlanDeepAgentModelOptions;
type Environment = Readonly<Record<string, string | undefined>>;

/** 从受控启动配置创建规划、视觉和格式修复模型；不读取或记录业务消息。 */
export function readStageModelConfiguration(
  env: Environment,
  diagnosticReporter?: (event: ModelInvocationLog) => void | Promise<void>,
): ModelOptions {
  const profile = value(env, "MODEL_PROFILE") ?? "legacy";
  if (!["legacy", "bailian-balanced"].includes(profile)) {
    throw new Error("MODEL_PROFILE 必须是 legacy 或 bailian-balanced。");
  }
  const balanced = profile === "bailian-balanced";
  const base = {
    provider: value(env, "MODEL_PROVIDER") ?? (balanced ? "bailian" : undefined),
    model: value(env, "MODEL_NAME"),
    apiKey: value(env, "MODEL_API_KEY"),
    baseUrl: value(env, "MODEL_BASE_URL"),
  };
  const stage = (name: "PLAN" | "VISION" | "REPAIR" | "ESCALATION"): ModelOptions => {
    const prefix = `MODEL_${name}_`;
    const model = value(env, `${prefix}NAME`) ?? base.model
      ?? (balanced ? name === "REPAIR" ? "qwen3.8-flash" : name === "ESCALATION" ? "qwen3.8-max" : "qwen3.7-plus" : undefined);
    const provider = value(env, `${prefix}PROVIDER`) ?? base.provider;
    const apiKey = value(env, `${prefix}API_KEY`) ?? base.apiKey;
    const baseUrl = value(env, `${prefix}BASE_URL`) ?? base.baseUrl;
    if (balanced && !["bailian", "qwen"].includes(provider ?? "")) {
      throw new Error("bailian-balanced 预设要求使用百炼服务供应商 bailian 或 qwen。");
    }
    const nativeSchema = ["bailian", "qwen"].includes(provider ?? "")
      && /^qwen3\.(?:7-(?:plus|max|flash)|8-(?:max|flash))(?:-|$)/.test(model ?? "");
    const configuredMode = value(env, `${prefix}STRUCTURED_OUTPUT_MODE`)
      ?? value(env, "MODEL_STRUCTURED_OUTPUT_MODE");
    const mode = configuredMode ?? (balanced && nativeSchema ? "json-schema" : "json-text");
    if (!["json-text", "tool", "json-schema"].includes(mode)) {
      throw new Error("MODEL_STRUCTURED_OUTPUT_MODE 必须是 json-text 或 tool 或 json-schema。");
    }
    if (mode === "json-schema" && !nativeSchema) throw new Error(`${prefix}NAME 不支持已验证的原生 JSON Schema。`);
    const thinking = readBoolean(env, `${prefix}THINKING`) ?? (balanced ? name === "PLAN" || name === "ESCALATION" : undefined);
    const budget = readInteger(env, `${prefix}THINKING_BUDGET`);
    const effort = value(env, `${prefix}REASONING_EFFORT`);
    if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) {
      throw new Error(`${prefix}REASONING_EFFORT 无效。`);
    }
    const output = readInteger(env, `${prefix}MAXIMUM_OUTPUT_TOKENS`);
    const inference = {
      ...(thinking !== undefined ? { thinking } : {}),
      ...(budget ? { thinkingBudget: budget } : {}),
      ...(effort ? { reasoningEffort: effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
      ...(output ? { maximumOutputTokens: output } : {}),
      ...(balanced && thinking && !budget && !effort
        ? /^deepseek-v4-/.test(model ?? "")
          ? { reasoningEffort: /-(?:0813|0731)$/.test(model ?? "") ? "low" as const : "high" as const }
          : { thinkingBudget: name === "ESCALATION" ? 8_192 : 4_096 }
        : {}),
    };
    if (thinking === false && (budget || effort)) throw new Error(`${prefix}关闭思考时不能配置预算或推理强度。`);
    if (budget && effort) throw new Error(`${prefix}思考预算与推理强度必须二选一。`);
    return {
      ...(provider ? { provider } : {}), ...(model ? { model } : {}),
      ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}),
      ...(balanced && mode !== "tool" ? { executionMode: "single" as const } : {}),
      structuredOutputMode: mode as "json-text" | "tool" | "json-schema",
      ...(Object.keys(inference).length > 0 ? { inference } : {}),
      ...(diagnosticReporter ? { diagnosticReporter } : {}),
    };
  };
  const plan = stage("PLAN");
  const visual = stage("VISION");
  const repair = stage("REPAIR");
  const escalation = balanced || value(env, "MODEL_ESCALATION_NAME") ? stage("ESCALATION") : undefined;
  return { ...plan, visualModel: { ...visual, repairModel: repair }, repairModel: repair,
    ...(escalation && (escalation.model !== plan.model || escalation.provider !== plan.provider)
      ? { escalationModel: { ...escalation, repairModel: repair } } : {}) };

}

/** 读取非空启动配置，空字符串按未配置处理。 */
function value(env: Environment, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

/** 拒绝隐式布尔转换，防止字符串 false 被解释为开启思考。 */
function readBoolean(env: Environment, key: string): boolean | undefined {
  const configured = value(env, key);
  if (!configured) return undefined;
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error(`${key} 必须是 true 或 false。`);
}

/** 校验正整数预算，不回显原始环境变量值。 */
function readInteger(env: Environment, key: string): number | undefined {
  const configured = value(env, key);
  if (!configured) return undefined;
  const parsed = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 393_216) {
    throw new Error(`${key} 必须是 1 到 393216 的整数。`);
  }
  return parsed;
}
