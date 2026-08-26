/** 将 Workspace 权威 D2C 任务投影为可分页、可分类的侧边栏摘要。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type {
  D2CTaskAttention,
  D2CTaskStage,
  D2CTaskSummary,
  D2CTaskSummaryPage,
} from "@ui-forge/shared-protocol";

const defaultPageSize = 20;
const legacyTimestamp = new Date(0).toISOString();

/** 查询任务列表所需的领域服务端口。 */
export interface D2CTaskListQueryServiceOptions {
  service: Pick<D2CAgent.Service, "listTasks">;
}

/** 从唯一任务事实来源生成不包含完整 Plan、Patch 或项目路径的分页摘要。 */
export class D2CTaskListQueryService {
  /** 保存只读领域服务依赖。 */
  constructor(private readonly options: D2CTaskListQueryServiceOptions) {}

  /** 查询、投影并按不透明游标分页当前 Workspace 任务。 */
  async list(input: {
    workspaceId: string;
    includeArchived?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<D2CTaskSummaryPage> {
    const tasks = await this.options.service.listTasks({
      workspaceId: input.workspaceId,
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
    });
    const start = input.cursor ? findCursorStart(tasks, decodeCursor(input.cursor)) : 0;
    const limit = input.limit ?? defaultPageSize;
    const pageTasks = tasks.slice(start, start + limit);
    const nextTask = tasks[start + limit];
    return {
      items: pageTasks.map(toTaskSummary),
      nextCursor: nextTask
        ? encodeCursor(pageTasks.at(-1) ?? nextTask)
        : null,
    };
  }
}

/** 将一个权威任务状态映射为侧边栏摘要。 */
export function toTaskSummary(task: D2CAgent.Task): D2CTaskSummary {
  const classification = classifyTask(task);
  return {
    taskId: task.taskId,
    displayName: task.displayName?.trim()
      || task.inspectedDesign?.context.regions[0]?.name?.trim()
      || task.inspectedDesign?.context.name.trim()
      || "新任务",
    status: task.status,
    revision: task.revision,
    stage: classification.stage,
    attention: classification.attention,
    nextAction: classification.nextAction,
    updatedAt: task.updatedAt ?? task.createdAt ?? legacyTimestamp,
    ...(task.archivedAt ? { archivedAt: task.archivedAt } : {}),
    ...(classification.blockingReason
      ? { blockingReason: classification.blockingReason }
      : {}),
  };
}

/** 按持久业务状态派生侧边栏阶段、注意力和下一步，不保存重复分类。 */
function classifyTask(task: D2CAgent.Task): {
  stage: D2CTaskStage;
  attention: D2CTaskAttention;
  nextAction: string;
  blockingReason?: string;
} {
  if (task.deliveryValidation?.status === "blocked") {
    return {
      stage: "validation",
      attention: "required",
      nextAction: "处理验收问题后继续",
      blockingReason: task.deliveryValidation.reasons[0] ?? task.deliveryValidation.summary,
    };
  }
  if (task.patchApplication?.status === "blocked") {
    return {
      stage: "delivery",
      attention: "required",
      nextAction: "处理文件问题后继续",
      blockingReason: task.patchApplication.reasons[0] ?? task.patchApplication.summary,
    };
  }
  if (task.codeGeneration?.status === "blocked") {
    return {
      stage: "delivery",
      attention: "required",
      nextAction: "处理生成问题后继续",
      blockingReason: task.codeGeneration.reasons[0] ?? task.codeGeneration.summary,
    };
  }
  switch (task.status) {
    case "draft": return { stage: "design", attention: "required", nextAction: "填写设计地址" };
    case "svg_ready": return { stage: "design", attention: "required", nextAction: "确认设计" };
    case "design_confirmed": return { stage: "planning", attention: "resumable", nextAction: "继续分析" };
    case "analysis_ready": return { stage: "planning", attention: "required", nextAction: "审阅并批准方案" };
    case "plan_approved": return { stage: "delivery", attention: "resumable", nextAction: "继续生成代码" };
    case "patch_ready": return { stage: "delivery", attention: "resumable", nextAction: "继续安全落盘" };
    case "patch_applied": return { stage: "validation", attention: "resumable", nextAction: "继续自动验收" };
    case "command_approval_required": return { stage: "validation", attention: "required", nextAction: "审阅并批准真实命令" };
    case "command_approved": return { stage: "validation", attention: "resumable", nextAction: "执行已批准命令" };
    case "validation_blocked": return { stage: "validation", attention: "required", nextAction: "处理问题后继续" };
    case "delivery_ready": return { stage: "delivery", attention: "completed", nextAction: "查看交付结果" };
  }
}

/** 将当前页最后一项编码为不透明稳定游标。 */
function encodeCursor(task: D2CAgent.Task): string {
  return Buffer.from(JSON.stringify({
    updatedAt: task.updatedAt ?? task.createdAt ?? legacyTimestamp,
    taskId: task.taskId,
  }), "utf8").toString("base64url");
}

/** 解码并校验客户端传回的游标。 */
function decodeCursor(cursor: string): { updatedAt: string; taskId: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("invalid cursor");
    const record = value as Record<string, unknown>;
    if (typeof record.updatedAt !== "string" || typeof record.taskId !== "string") {
      throw new Error("invalid cursor");
    }
    return { updatedAt: record.updatedAt, taskId: record.taskId };
  } catch {
    throw new Error("任务列表游标无效或已经过期。");
  }
}

/** 在确定性排序结果中定位游标后的第一项。 */
function findCursorStart(
  tasks: readonly D2CAgent.Task[],
  cursor: { updatedAt: string; taskId: string },
): number {
  const index = tasks.findIndex((task) => (
    (task.updatedAt ?? task.createdAt ?? legacyTimestamp) === cursor.updatedAt
    && task.taskId === cursor.taskId
  ));
  if (index < 0) throw new Error("任务列表游标无效或已经过期。");
  return index + 1;
}
