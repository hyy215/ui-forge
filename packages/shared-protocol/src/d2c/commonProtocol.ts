/** 定义所有 D2C 业务阶段共同使用的任务标识、版本和公开阶段协议。 */
import { z } from "zod";

/** 客户端可观察的 D2C 工作流阶段集合。 */
export const d2cWorkflowPhases = [
  "draft",
  "svg_ready",
  "design_confirmed",
  "analysis_ready",
] as const;

/** 校验 Server 通过快照向客户端公开的 D2C 工作流阶段。 */
export const d2cWorkflowPhaseSchema = z.enum(d2cWorkflowPhases);

/** 校验所有针对已有任务的命令都携带任务标识和乐观并发版本。 */
export const d2cTaskCommandInputSchema = z.object({
  taskId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

/** 校验只读取任务快照所需的任务标识。 */
export const getD2CWorkflowSnapshotInputSchema = z.object({
  taskId: z.string().uuid(),
});

/** Server 快照向客户端公开的 D2C 工作流阶段。 */
export type D2CWorkflowPhase = z.infer<typeof d2cWorkflowPhaseSchema>;
/** 作用于已有 D2C 任务的通用命令参数。 */
export type D2CTaskCommandInput = z.infer<typeof d2cTaskCommandInputSchema>;
/** 读取已有 D2C 工作流快照的请求参数。 */
export type GetD2CWorkflowSnapshotInput = z.infer<typeof getD2CWorkflowSnapshotInputSchema>;
