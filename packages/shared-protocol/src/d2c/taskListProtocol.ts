/** 定义 Workspace 任务列表、分类、重命名、软归档和永久删除通信协议。 */

import { z } from "zod";
import {
  d2cTaskCommandInputSchema,
  d2cWorkflowStatusSchema,
} from "./commonProtocol.js";

/** 任务在侧边栏展示的稳定业务阶段。 */
export const d2cTaskStageSchema = z.enum([
  "design",
  "planning",
  "delivery",
  "validation",
]);

/** 任务在侧边栏的用户注意力分类。 */
export const d2cTaskAttentionSchema = z.enum([
  "required",
  "resumable",
  "completed",
]);

/** 单个 Workspace 任务的可查询摘要，不包含完整 Plan、Patch 或绝对路径。 */
export const d2cTaskSummarySchema = z.object({
  taskId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120),
  status: d2cWorkflowStatusSchema,
  revision: z.number().int().nonnegative(),
  stage: d2cTaskStageSchema,
  attention: d2cTaskAttentionSchema,
  nextAction: z.string().min(1).max(120),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  blockingReason: z.string().min(1).max(500).optional(),
});

/** 查询当前 Workspace 任务列表所需的分页和归档条件。 */
export const listD2CTasksInputSchema = z.object({
  projectPath: z.string().optional(),
  includeArchived: z.boolean().optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** 一页按更新时间倒序排列的任务摘要。 */
export const d2cTaskSummaryPageSchema = z.object({
  items: z.array(d2cTaskSummarySchema).max(100),
  nextCursor: z.string().nullable(),
});

/** 重命名任务时同时携带乐观并发版本和可信宿主补充的项目路径。 */
export const renameD2CTaskInputSchema = d2cTaskCommandInputSchema.extend({
  displayName: z.string().trim().min(1).max(120),
  projectPath: z.string().optional(),
});

/** 归档或恢复任务时使用的 Workspace 受限命令。 */
export const changeD2CTaskArchiveInputSchema = d2cTaskCommandInputSchema.extend({
  projectPath: z.string().optional(),
});

/** 永久删除任务时使用的 Workspace 和 revision 受限命令。 */
export const deleteD2CTaskInputSchema = d2cTaskCommandInputSchema.extend({
  projectPath: z.string().optional(),
});

/** 永久删除完成后返回不再可读取的任务标识。 */
export const deleteD2CTaskResultSchema = z.object({
  taskId: z.string().uuid(),
  deleted: z.literal(true),
});

/** 任务侧边栏业务阶段。 */
export type D2CTaskStage = z.infer<typeof d2cTaskStageSchema>;
/** 任务侧边栏用户注意力分类。 */
export type D2CTaskAttention = z.infer<typeof d2cTaskAttentionSchema>;
/** 一个不泄漏完整任务内容的 Workspace 任务摘要。 */
export type D2CTaskSummary = z.infer<typeof d2cTaskSummarySchema>;
/** 查询任务列表的条件。 */
export type ListD2CTasksInput = z.infer<typeof listD2CTasksInputSchema>;
/** 分页任务摘要结果。 */
export type D2CTaskSummaryPage = z.infer<typeof d2cTaskSummaryPageSchema>;
/** 重命名任务请求。 */
export type RenameD2CTaskInput = z.infer<typeof renameD2CTaskInputSchema>;
/** 归档或恢复任务请求。 */
export type ChangeD2CTaskArchiveInput = z.infer<typeof changeD2CTaskArchiveInputSchema>;
/** 永久删除任务请求。 */
export type DeleteD2CTaskInput = z.infer<typeof deleteD2CTaskInputSchema>;
/** 永久删除任务结果。 */
export type DeleteD2CTaskResult = z.infer<typeof deleteD2CTaskResultSchema>;
