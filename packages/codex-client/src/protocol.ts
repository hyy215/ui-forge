/** 用 Codex 生成的 Schema 校验协议边界，保持原始载荷不变。 */
import { z } from "zod";
import schemas from "./generated/schemas.json" with { type: "json" };

/** 已生成的请求和响应 Schema 名称；协议升级时由脚本更新。 */
export const nativeSchemas = {
  clientMethods: schemas.clientMethods,
  serverReplies: schemas.serverReplies,
};
/** 生成当前协议的 Codex CLI 版本；用于检查命令报告兼容性。 */
export const codexProtocolVersion = schemas.version;
/** 官方协议已声明的通知方法；未知方法不作为已知消息解析。 */
export const nativeNotificationMethods: ReadonlySet<string> = new Set(schemas.notificationMethods);
const validators = new Map<string, z.ZodType>();

/** 校验原生载荷；不应用默认值、删除字段或改写权限。 */
export function validateNative(name: string, value: unknown): void {
  let validator = validators.get(name);
  if (!validator) {
    validator = z.fromJSONSchema(
      {
        $ref: `#/definitions/${name}`,
        definitions: schemas.definitions,
      },
      { defaultTarget: "draft-7" },
    );
    validators.set(name, validator);
  }
  const result = validator.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Invalid Codex ${name}: ${issue?.path.join(".") || "payload"} (${issue?.code})`,
    );
  }
}
