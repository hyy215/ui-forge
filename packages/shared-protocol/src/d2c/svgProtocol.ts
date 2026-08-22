/** 定义确定性 SVG 预览确认后的状态和展示协议。 */

import { z } from "zod";

/** 校验 SVG 预览确认阶段的公开状态。 */
export const svgD2CWorkflowStateSchema = z.object({
  phase: z.literal("svg"),
  status: z.literal("ready"),
});

/** 校验设计检查节点在 SVG 页面展示的工具证据。 */
export const svgToolSchema = z.object({
  name: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  summary: z.string().min(1),
  source: z.string().min(1),
  details: z.object({
    label: z.string().min(1),
    file: z.string().min(1),
    node: z.string().min(1),
    nodeCount: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
  }).optional(),
});

/** 校验 SVG 阶段发送给客户端的展示模型。 */
export const svgViewModelSchema = z.object({
  taskGoal: z.string(),
  statusMessage: z.string(),
  tools: z.array(svgToolSchema),
});

/** SVG 页面展示的设计工具证据。 */
export type SvgTool = z.infer<typeof svgToolSchema>;
/** SVG 阶段展示模型。 */
export type SvgViewModel = z.infer<typeof svgViewModelSchema>;
