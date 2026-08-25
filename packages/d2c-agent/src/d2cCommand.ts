/** 定义设计读取、人工确认与方案分析 Service 修改权威任务时接受的领域命令。 */

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
  confirmation: "确认设计";
}
