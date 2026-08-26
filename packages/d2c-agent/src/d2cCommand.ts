/** 定义 D2C Service 修改设计、授权与交付权威状态时接受的领域命令。 */

import type { DesignSource } from "./design-context/designSource.js";

/** 约束所有修改已有 D2C 任务的命令。 */
export interface D2CTaskCommand {
  taskId: string;
  expectedRevision: number;
}

/** 读取并缓存用户指定设计来源的命令。 */
export interface InspectDesignCommand extends D2CTaskCommand {
  source: DesignSource;
}

/** 将人工确认作为独立持久化命令提交。 */
export interface ConfirmDesignCommand extends D2CTaskCommand {
  confirmation: string;
}

/** 将人工批准绑定到当前权威 Plan 版本与内容哈希。 */
export interface ApprovePlanCommand extends D2CTaskCommand {
  planVersion: number;
  planHash: string;
  executionMode: "generate-and-apply";
}

/** 将人工批准绑定到 Patch 后准备出的精确交付命令计划。 */
export interface ApproveDeliveryCommandsCommand extends D2CTaskCommand {
  commandPlanHash: string;
}

/** 将任务展示名称更新为用户明确指定的非空文本。 */
export interface RenameTaskCommand extends D2CTaskCommand {
  displayName: string;
}
