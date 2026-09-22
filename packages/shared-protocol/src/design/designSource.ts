/** 区分设计来源与平台接入方式；连接配置不携带凭据、命令或执行权限。 */
import { z } from "zod";

/** 设计接入检查只验证连接和目标身份，不创建任务。 */
export const designMethods = { check: "ui-forge.design.check" } as const;
/** 本机已验证的 Vibe HTTP MCP 默认地址，只有选择 Vibe 后才使用。 */
export const defaultVibeEndpoint = "http://127.0.0.1:20678/mcp";
/** MasterGo 本机守护服务的只读画布状态地址，不是 MCP 地址。 */
export const defaultVibeStatusEndpoint = "http://127.0.0.1:30678/api/status";

/** 只接收明确的回环 HTTP 服务地址，禁止凭据、查询参数和片段。 */
export const localDesignEndpointSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "本地设计服务仅支持无凭据的回环 HTTP 地址。");

const mastergoUrl = z
  .string()
  .trim()
  .max(4096)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        ["mastergo.com", "www.mastergo.com"].includes(url.hostname) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "请输入 MasterGo 的 HTTPS 设计链接。");

/** MasterGo 内部接入选择；未来平台使用独立分支，不复用本平台字段。 */
export const mastergoConnectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("magic") }),
  z.strictObject({
    kind: z.literal("vibe"),
    endpoint: localDesignEndpointSchema.default(defaultVibeEndpoint),
    statusEndpoint: localDesignEndpointSchema.default(defaultVibeStatusEndpoint),
  }),
]);

/** local 使用图片或需求文字，不自动接入任何设计平台。 */
export const designSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local") }),
  z.strictObject({
    kind: z.literal("mastergo"),
    url: mastergoUrl,
    connection: mastergoConnectionSchema,
  }),
]);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.:-]+$/);
/** 平台返回的稳定设计身份；Vibe 绑定必须包含明确页面。 */
export const designTargetSchema = z.strictObject({
  documentId: identifier,
  pageId: identifier.optional(),
  nodeId: identifier,
});
/** 已创建任务持久化的接入绑定；旧任务缺失本字段时沿用 Magic。 */
export const designBindingSchema = z
  .strictObject({
    bindingId: z.string().uuid(),
    source: designSourceSchema,
    target: designTargetSchema.optional(),
  })
  .superRefine((binding, context) => {
    if (
      binding.source.kind === "mastergo" &&
      binding.source.connection.kind === "vibe" &&
      !binding.target?.pageId
    ) {
      context.addIssue({
        code: "custom",
        message: "Vibe 任务必须绑定文件、页面和节点。",
        path: ["target"],
      });
    }
    if (binding.source.kind === "local" && binding.target) {
      context.addIssue({
        code: "custom",
        message: "本地图片或文字来源不能绑定平台节点。",
        path: ["target"],
      });
    }
  });
/** 输入只允许选择已有适配器，不接受任意 MCP 配置或 shell 命令。 */
export const checkDesignConnectionSchema = z.strictObject({ source: designSourceSchema });
/** 检查成功后的白名单结果，不包含设计内容、服务 token 或原始错误。 */
export const designConnectionCheckSchema = z.strictObject({
  source: designSourceSchema,
  target: designTargetSchema.optional(),
  tools: z.array(z.string().min(1).max(256)),
  serverVersion: z.string().min(1).max(128).optional(),
});
/** 创建时选择的来源和接入方式。 */
export type DesignSource = z.infer<typeof designSourceSchema>;
/** 用于恢复和展示的任务绑定。 */
export type DesignBinding = z.infer<typeof designBindingSchema>;
/** 只读连接检查结果。 */
export type DesignConnectionCheck = z.infer<typeof designConnectionCheckSchema>;
/** 已解析的平台文件、页面和节点身份。 */
export type DesignTarget = z.infer<typeof designTargetSchema>;
