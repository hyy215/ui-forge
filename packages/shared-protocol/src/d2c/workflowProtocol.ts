/** 组合各 D2C 业务阶段协议，形成统一展示模型和权威快照。 */
import { z } from "zod";
import { d2cWorkflowStatusSchema } from "./commonProtocol.js";
import { conversationViewModelSchema } from "./conversationProtocol.js";
import { setupViewModelSchema } from "./setupProtocol.js";
import { svgViewModelSchema } from "./svgProtocol.js";

/** 校验 Server 向客户端提供的 D2C 各阶段展示数据。 */
export const taskWorkflowViewModelSchema = z.object({
  setup: setupViewModelSchema,
  svg: svgViewModelSchema,
  conversation: conversationViewModelSchema,
});

/** 校验 Server 每次命令完成后返回的权威 D2C 工作流快照。 */
export const d2cWorkflowSnapshotSchema = z.object({
  taskId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  status: d2cWorkflowStatusSchema,
  viewModel: taskWorkflowViewModelSchema,
});

/** 完整描述 D2C 工作流各阶段所需展示数据的只读模型。 */
export type TaskWorkflowViewModel = z.infer<typeof taskWorkflowViewModelSchema>;
/** Server 返回给客户端的权威 D2C 工作流快照。 */
export type D2CWorkflowSnapshot = z.infer<typeof d2cWorkflowSnapshotSchema>;
