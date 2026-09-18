/** 解释原生审批选项和 MCP 表单，仅整理展示及用户提交值，不决定是否授权。 */
import { z } from "zod";

const choiceSchema = z.union([
  z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  z.object({
    acceptWithExecpolicyAmendment: z.object({ execpolicy_amendment: z.array(z.string()) }),
  }),
  z.object({
    applyNetworkPolicyAmendment: z.object({
      network_policy_amendment: z.object({ host: z.string(), action: z.enum(["allow", "deny"]) }),
    }),
  }),
]);
/** 优先使用服务端实际提供的决议；缺省仅显示单次允许、拒绝和取消。 */
export function approvalChoices(value: unknown) {
  const offered = z.array(choiceSchema).safeParse(value);
  return (
    offered.success
      ? offered.data
      : value === undefined || value === null
        ? (["accept", "decline", "cancel"] as const)
        : []
  ).map((decision) => {
    if (typeof decision === "string")
      return {
        decision,
        label: {
          accept: "允许本次",
          acceptForSession: "本会话允许",
          decline: "拒绝",
          cancel: "取消操作",
        }[decision],
        detail: decision === "acceptForSession" ? "按 Codex 提供的范围记住本会话决议" : "",
        primary: decision === "accept",
      };
    if ("acceptWithExecpolicyAmendment" in decision)
      return {
        decision,
        label: "允许并记住命令规则",
        detail:
          "命令前缀：" + decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(" "),
        primary: false,
      };
    const rule = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    return {
      decision,
      label: rule.action === "allow" ? "允许并记住此域名" : "禁止此域名",
      detail: rule.host,
      primary: false,
    };
  });
}

const optionSchema = z.object({ const: z.string(), title: z.string() });
const fieldSchema = z
  .object({
    type: z.enum(["string", "number", "integer", "boolean", "array"]),
    title: z.string().optional(),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    enumNames: z.array(z.string()).optional(),
    oneOf: z.array(optionSchema).optional(),
    items: z
      .object({
        type: z.literal("string").optional(),
        enum: z.array(z.string()).optional(),
        anyOf: z.array(optionSchema).optional(),
      })
      .strict()
      .optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    format: z.enum(["email", "uri", "date", "date-time"]).optional(),
    default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  })
  .strict()
  .refine((field) => field.type !== "array" || Boolean(field.items?.enum || field.items?.anyOf));
/** 支持 Codex MCP 的标准基本字段；复杂扩展表单仍保留显式 JSON 入口。 */
export const elicitationSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), fieldSchema),
    required: z.array(z.string()).optional(),
    $schema: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    additionalProperties: z.boolean().optional(),
  })
  .strict();
/** MCP 字段选项保留服务端值和显示名称。 */
export function fieldOptions(field: z.infer<typeof fieldSchema>) {
  if (field.oneOf)
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }));
  if (field.items?.anyOf)
    return field.items.anyOf.map((option) => ({ value: option.const, label: option.title }));
  return (field.enum ?? field.items?.enum)?.map((value, index) => ({
    value,
    label: field.enumNames?.[index] ?? value,
  }));
}
/** 用户填写的基本表单值，布尔值必须显式选择；不自动接受默认值。 */
export type ElicitationValues = Record<string, string | boolean | string[]>;
/** 校验必填、选项和范围后生成原生 content；空表单直接返回空对象。 */
export function elicitationContent(
  schema: z.infer<typeof elicitationSchema>,
  values: ElicitationValues,
): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = values[name];
    const title = field.title ?? name;
    const missing = value === undefined || value === "" || (Array.isArray(value) && !value.length);
    if (missing) {
      if (schema.required?.includes(name)) throw new Error("请填写" + title);
      else continue;
    }
    const options = fieldOptions(field);
    if (
      options &&
      (Array.isArray(value) ? value : [value]).some(
        (entry) => !options.some((option) => option.value === entry),
      )
    )
      throw new Error(title + "的选项无效");
    if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (
        typeof value !== "string" ||
        !value.trim() ||
        !Number.isFinite(number) ||
        (field.type === "integer" && !Number.isInteger(number)) ||
        (field.minimum !== undefined && number < field.minimum) ||
        (field.maximum !== undefined && number > field.maximum)
      )
        throw new Error(title + "的数值超出允许范围");
      content[name] = number;
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new Error("请选择" + title);
      content[name] = value;
    } else if (field.type === "array") {
      if (
        !Array.isArray(value) ||
        (field.minItems !== undefined && value.length < field.minItems) ||
        (field.maxItems !== undefined && value.length > field.maxItems)
      )
        throw new Error(title + "的选项数量不正确");
      content[name] = value;
    } else {
      if (
        typeof value !== "string" ||
        (field.minLength !== undefined && value.length < field.minLength) ||
        (field.maxLength !== undefined && value.length > field.maxLength)
      )
        throw new Error(title + "的长度不符合要求");
      if (
        (field.format === "email" && !z.email().safeParse(value).success) ||
        (field.format === "uri" && !z.url().safeParse(value).success) ||
        (field.format === "date" && !z.iso.date().safeParse(value).success) ||
        (field.format === "date-time" && !z.iso.datetime({ offset: true }).safeParse(value).success)
      )
        throw new Error(title + "的格式不正确");
      content[name] = value;
    }
  }
  return content;
}
