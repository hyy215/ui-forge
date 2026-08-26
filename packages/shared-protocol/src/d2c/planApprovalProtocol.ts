/** 定义绑定精确 Plan 内容的显式人工批准命令与可恢复展示状态。 */

import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";

const planHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** 校验客户端批准当前权威 Plan 时必须回传的版本与内容哈希。 */
export const approveD2CPlanInputSchema = d2cTaskCommandInputSchema.extend({
  planVersion: z.number().int().positive(),
  planHash: planHashSchema,
  executionMode: z.literal("generate-and-apply"),
});

/** 校验快照中当前 Plan 的待批准或已批准状态。 */
export const planApprovalViewModelSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    planVersion: z.number().int().positive(),
    planHash: planHashSchema,
  }),
  z.object({
    status: z.literal("approved"),
    planVersion: z.number().int().positive(),
    planHash: planHashSchema,
    approvedAt: z.string().datetime({ offset: true }),
    executionMode: z.literal("generate-and-apply"),
  }),
]);

/** 批准当前权威 Plan 的命令参数。 */
export type ApproveD2CPlanInput = z.infer<typeof approveD2CPlanInputSchema>;
/** 当前 Plan 面向客户端的可恢复批准状态。 */
export type PlanApprovalViewModel = z.infer<typeof planApprovalViewModelSchema>;
