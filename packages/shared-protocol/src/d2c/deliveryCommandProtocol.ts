/** 定义交付命令提议、精确批准及 Workspace 范围展示协议。 */

import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** 校验一条将以 shell=false 执行或交由人工复制的真实命令。 */
export const deliveryCommandSchema = z.object({
  commandId: z.string().min(1),
  purpose: z.enum([
    "install-dependencies",
    "build-typescript",
    "build-vite",
    "start-vite-preview",
  ]),
  cwd: z.string().min(1),
  executable: z.string().min(1),
  arguments: z.array(z.string()),
  displayCommand: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  networkAccess: z.enum(["none", "required"]),
  workspaceScope: z.enum(["within-workspace", "manual-only"]),
});

const deliveryCommandPlanBaseSchema = z.object({
  patchSetHash: sha256Schema,
  workspaceRoot: z.string().min(1),
  commandPlanHash: sha256Schema,
  commands: z.array(deliveryCommandSchema),
  summary: z.string().min(1),
  preparedAt: z.string().datetime({ offset: true }),
});

/** 校验快照中尚未准备、待批准、已批准或只能人工执行的命令状态。 */
export const deliveryCommandPlanViewModelSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  deliveryCommandPlanBaseSchema.extend({
    status: z.literal("approval_required"),
    commands: z.array(deliveryCommandSchema).min(1),
  }),
  deliveryCommandPlanBaseSchema.extend({
    status: z.literal("approved"),
    commands: z.array(deliveryCommandSchema).min(1),
    approvedAt: z.string().datetime({ offset: true }),
  }),
  deliveryCommandPlanBaseSchema.extend({
    status: z.literal("manual_only"),
    reason: z.string().min(1),
  }),
]);

/** 校验用户批准当前精确命令计划时必须回传的哈希。 */
export const approveD2CDeliveryCommandsInputSchema = d2cTaskCommandInputSchema.extend({
  commandPlanHash: sha256Schema,
});

/** 一条可审阅的真实交付命令。 */
export type DeliveryCommandViewModel = z.infer<typeof deliveryCommandSchema>;
/** 当前交付命令准备与批准状态。 */
export type DeliveryCommandPlanViewModel = z.infer<typeof deliveryCommandPlanViewModelSchema>;
/** 批准精确交付命令计划的请求。 */
export type ApproveD2CDeliveryCommandsInput = z.infer<typeof approveD2CDeliveryCommandsInputSchema>;
