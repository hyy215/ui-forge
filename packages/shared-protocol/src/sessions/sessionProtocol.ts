/** 定义 ui-forge 会话操作和原生事件信封，不定义第二套执行状态。 */
import { z } from "zod";
import {
  nativeNotificationSchema,
  nativeThreadSchema,
  pendingRequestSchema,
} from "./nativeMessages.js";

/** 第一方客户端共享的会话方法。 */
export const sessionMethods = {
  create: "ui-forge.session.create",
  read: "ui-forge.session.read",
  list: "ui-forge.session.list",
  send: "ui-forge.session.send",
  stop: "ui-forge.session.stop",
  respond: "ui-forge.session.respond",
  subscribe: "ui-forge.session.subscribe",
  status: "ui-forge.codex.status",
} as const;
/** 单张上传图片；限制长度以配合服务端 body limit。 */
export const imageInputSchema = z.strictObject({
  name: z.string().min(1).max(255),
  dataUrl: z
    .string()
    .max(7_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
});
/** 创建任务仅接受工作区与用户输入，不能从页面覆盖沙箱或审批。 */
export const createSessionSchema = z
  .strictObject({
    projectPath: z.string().min(1),
    prompt: z.string().max(200_000),
    images: z.array(imageInputSchema).max(4).default([]),
  })
  .refine((v) => v.prompt.trim() || v.images.length > 0, "请输入需求或添加设计图片。");
/** 会话操作的稳定身份，直接使用 Codex thread ID。 */
export const sessionIdSchema = z.strictObject({ taskId: z.string().min(1).max(200) });
/** 文字或图片补充输入；自动续接可要求仅在空闲时启动，不能覆盖已运行轮次。 */
export const sendSessionInputSchema = sessionIdSchema
  .extend({
    text: z.string().trim().max(200_000).default(""),
    images: z.array(imageInputSchema).max(4).default([]),
    startOnlyIfIdle: z.boolean().optional(),
  })
  .refine((input) => input.text.length > 0 || input.images.length > 0, "请输入需求或添加图片。");
/** 明确指定要停止的轮次，拒绝把旧的停止请求用于新轮次。 */
export const stopSessionSchema = sessionIdSchema.extend({ turnId: z.string().min(1) });
/** 回复只传原生响应体，由 codex-client 按对应请求 Schema 验证。 */
export const respondSessionSchema = sessionIdSchema.extend({
  token: z.string().min(1),
  result: z.json(),
});
/** 分页读取已由 ui-forge 创建的任务索引。 */
export const listSessionsSchema = z.strictObject({
  offset: z.number().int().nonnegative().default(0),
  projectPath: z.string().optional(),
});
/** 会话快照来自原生历史和当前待处理请求。 */
export const sessionSnapshotSchema = z.object({
  thread: nativeThreadSchema,
  pendingRequests: z.array(pendingRequestSchema),
});
/** 创建成功即返回身份；轮次启动出错仍可打开原会话检查，避免重复创建。 */
export const createdSessionSchema = z.object({
  taskId: z.string(),
  warning: z.string().optional(),
});
/** 会话操作成功不代表任务或验收完成。 */
export const sessionOperationResultSchema = z.object({ accepted: z.literal(true) });
/** 历史条目只缓存导航字段，状态和正文仍读取 Codex。 */
export const taskHistoryEntrySchema = z.object({
  taskId: z.string(),
  projectPath: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
/** 任务列表使用安装目录内索引，不展示用户其他 Codex 会话。 */
export const taskHistoryPageSchema = z.object({
  tasks: z.array(taskHistoryEntrySchema),
  nextOffset: z.number().int().nullable(),
});
/** 首条快照及后续原生通知、请求、连接错误。 */
export const sessionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: sessionSnapshotSchema }),
  z.object({ type: z.literal("notification"), notification: nativeNotificationSchema }),
  z.object({ type: z.literal("request"), pending: pendingRequestSchema }),
  z.object({ type: z.literal("resolved"), token: z.string() }),
  z.object({ type: z.literal("diagnostic"), message: z.string() }),
  z.object({ type: z.literal("close"), message: z.string() }),
]);
/** Codex 运行版本和登录状态，不传输账号凭据。 */
export const codexStatusSchema = z.object({
  runtimeVersion: z.string(),
  protocolVersion: z.string(),
  matches: z.boolean(),
  authenticated: z.boolean(),
});
/** 创建任务输入。 */
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
/** 同一任务的后续文字与图片输入。 */
export type SendSessionInput = z.infer<typeof sendSessionInputSchema>;
/** 会话快照。 */
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
/** 可订阅的会话事件。 */
export type SessionEvent = z.infer<typeof sessionEventSchema>;
/** 历史导航条目。 */
export type TaskHistoryEntry = z.infer<typeof taskHistoryEntrySchema>;
/** 历史导航分页。 */
export type TaskHistoryPage = z.infer<typeof taskHistoryPageSchema>;
