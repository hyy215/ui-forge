/** 定义设计读取、规划、代码生成与受控应用流程的权威任务状态。 */

import type { DesignInspection } from "./design-context/designInspection.js";
import type { DesignSource } from "./design-context/designSource.js";
import type { DesignComponentRecognition } from "./design-components/designComponentRecognition.js";
import type { ProjectInspection } from "./project-context/projectInspection.js";
import type { PlanningResult } from "./planning/planningResult.js";
import type { EvolvingPlanningResult } from "./planning/evolvingPlan.js";
import type { CodeGenerationOutcome } from "./code-generation/codePatch.js";
import type { PatchApplicationOutcome } from "./code-application/projectPatchApplier.js";
import type { ProjectDeliveryValidationOutcome } from "./delivery-validation/projectDeliveryValidator.js";
import type {
  DeliveryCommandApproval,
  DeliveryCommandPlan,
} from "./delivery-validation/deliveryCommand.js";

/** 当前 D2C 工作流允许持久化的显式业务状态。 */
export type D2CTaskStatus =
  | "draft"
  | "svg_ready"
  | "design_confirmed"
  | "analysis_ready"
  | "plan_approved"
  | "patch_ready"
  | "patch_applied"
  | "command_approval_required"
  | "command_approved"
  | "validation_blocked"
  | "delivery_ready";

/** 记录用户明确批准的精确 Plan 内容与批准时间。 */
export interface PlanApproval {
  planVersion: number;
  planHash: string;
  executionMode: "generate-and-apply";
  approvedAt: string;
}

/** D2C Service 保存的当前权威任务。 */
export interface D2CTask {
  /** 持久任务结构版本；旧 Checkpoint 可能暂时缺失并在读取时迁移。 */
  schemaVersion?: number;
  taskId: string;
  workspaceId: string;
  /** 侧边栏和工作台展示名称。 */
  displayName?: string;
  /** 区分系统生成名称和人工重命名，避免设计刷新覆盖人工意图。 */
  displayNameSource?: "generated" | "user";
  /** 任务首次创建时间；旧 Checkpoint 在迁移后补齐。 */
  createdAt?: string;
  /** 最近一次权威状态提交时间；旧 Checkpoint 在迁移后补齐。 */
  updatedAt?: string;
  /** 软归档时间；存在时任务不允许继续执行领域命令。 */
  archivedAt?: string;
  revision: number;
  status: D2CTaskStatus;
  projectPath: string;
  taskGoal: string;
  designSource?: DesignSource;
  inspectedDesign?: DesignInspection & { durationMs: number };
  projectInspection?: ProjectInspection;
  componentRecognition?: DesignComponentRecognition;
  plan?: PlanningResult;
  evolvingPlan?: EvolvingPlanningResult;
  planApproval?: PlanApproval;
  codeGeneration?: CodeGenerationOutcome;
  patchApplication?: PatchApplicationOutcome;
  deliveryCommandPlan?: DeliveryCommandPlan;
  deliveryCommandApproval?: DeliveryCommandApproval;
  deliveryValidation?: ProjectDeliveryValidationOutcome;
}
