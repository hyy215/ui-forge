/** 传输 Codex 原生载荷；仅约束展示所需字段，保留其余原生字段。完整协议由 codex-client 校验。 */
import { z } from "zod";

/** 原生消息参数必须可序列化，不在通信层重写字段。 */
export const nativeParamsSchema = z.record(z.string(), z.json());
/** 原生 item 的稳定身份；具体内容由展示端按类型读取。 */
export const nativeItemSchema = z.object({ id: z.string(), type: z.string() }).catchall(z.json());
/** 原生 turn 及其实际状态，不映射为 D2C 阶段。 */
export const nativeTurnSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    items: z.array(nativeItemSchema),
    error: z.json().nullable(),
  })
  .catchall(z.json());
/** 原生 thread 历史；保留所有 Codex 附加字段。 */
export const nativeThreadSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string(),
    preview: z.string(),
    name: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    status: z.object({ type: z.string() }).catchall(z.json()),
    turns: z.array(nativeTurnSchema),
  })
  .catchall(z.json());
/** 原生服务端通知，包括未来新增的方法。 */
export const nativeNotificationSchema = z.object({
  method: z.string(),
  params: nativeParamsSchema.optional(),
});
/** 待回答或审批请求的连接令牌；令牌只能使用一次。 */
export const pendingRequestSchema = z.object({
  token: z.string().min(1),
  request: z.object({
    id: z.union([z.string(), z.number()]),
    method: z.string(),
    params: nativeParamsSchema,
  }),
});
/** 原生 item 的可序列化表示。 */
export type NativeItem = z.infer<typeof nativeItemSchema>;
/** 原生 turn 的可序列化表示。 */
export type NativeTurn = z.infer<typeof nativeTurnSchema>;
/** 原生 thread 的可序列化表示。 */
export type NativeThread = z.infer<typeof nativeThreadSchema>;
/** 原生通知的可序列化表示。 */
export type NativeNotification = z.infer<typeof nativeNotificationSchema>;
/** 当前连接仍在等待的交互请求。 */
export type PendingRequest = z.infer<typeof pendingRequestSchema>;
