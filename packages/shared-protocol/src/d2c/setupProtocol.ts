/** 定义 D2C 任务初始化和提交目标阶段的请求、状态与展示协议。 */
import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";
import { designArtifactReferenceSchema } from "./designDataProtocol.js";

/** 校验客户端首次连接 D2C 运行时所携带的宿主上下文。 */
export const initializeD2CWorkflowInputSchema = z.object({
  projectPath: z.string().optional(),
});

/** 校验任务设置阶段读取 MasterGo 设计摘要的请求。 */
export const inspectD2CDesignInputSchema = d2cTaskCommandInputSchema.extend({
  designUrl: z.string().trim().min(1),
});

/** 校验任务尚未启动时的工作流状态。 */
export const setupD2CWorkflowStateSchema = z.object({
  phase: z.literal("setup"),
  status: z.literal("draft"),
});

/** 校验目标图层的可选设计预览。 */
export const designPreviewSchema = z.object({
  url: z.string().min(1).max(7 * 1024 * 1024).refine((value) => {
    if (/^\/(?!\/)/.test(value)) return true;
    if (/^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,/i.test(value)) return true;
    return /^https?:\/\/[^\s]+$/i.test(value);
  }, "设计预览必须使用同源相对地址、HTTP(S) 或 Server 校验后的图片 data URL。"),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

/** 校验由 MasterGo 分段坐标生成的非像素级结构预览。 */
export const designStructurePreviewSchema = z.object({
  width: z.number().positive().max(100_000),
  height: z.number().positive().max(100_000),
  background: z.string().regex(/^#[\da-f]{3,8}$/i).optional(),
  regions: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })).max(100),
});

/** 校验 Server 已读取并允许用户确认的 MasterGo 设计摘要。 */
export const inspectedDesignSummarySchema = z.object({
  name: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  regionCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  tokenCount: z.number().int().nonnegative(),
  preview: designPreviewSchema.nullable(),
  structurePreview: designStructurePreviewSchema.nullable(),
  designData: designArtifactReferenceSchema.nullable(),
  warnings: z.array(z.string()),
});

/** 校验任务设置阶段传输给客户端的展示数据。 */
export const setupViewModelSchema = z.object({
  projectPath: z.string(),
  taskGoal: z.string(),
  designUrl: z.string(),
  designSummary: inspectedDesignSummarySchema.nullable(),
});

/** 首次连接 D2C 运行时的请求参数。 */
export type InitializeD2CWorkflowInput = z.infer<typeof initializeD2CWorkflowInputSchema>;

/** 读取任务设计摘要的请求参数。 */
export type InspectD2CDesignInput = z.infer<typeof inspectD2CDesignInputSchema>;

/** 任务设置阶段展示的 MasterGo 设计摘要。 */
export type InspectedDesignSummary = z.infer<typeof inspectedDesignSummarySchema>;

/** 任务设置阶段传输给客户端的展示数据。 */
export type SetupViewModel = z.infer<typeof setupViewModelSchema>;
