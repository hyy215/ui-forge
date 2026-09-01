/** 定义 Patch 落盘后可审阅、可哈希绑定且受 Workspace 范围约束的命令计划。 */

import { createHash } from "node:crypto";

/** 自动交付阶段允许提出的有限命令用途。 */
export type DeliveryCommandPurpose =
  | "install-dependencies"
  | "build-typescript"
  | "build-vite"
  | "start-vite-preview";

/** 一条即将由宿主以 shell=false 执行的精确命令。 */
export interface DeliveryCommand {
  commandId: string;
  purpose: DeliveryCommandPurpose;
  cwd: string;
  executable: string;
  arguments: string[];
  displayCommand: string;
  timeoutMs: number;
  networkAccess: "none" | "required";
  workspaceScope: "within-workspace" | "manual-only";
}

/** 允许在当前 Workspace 内经精确批准后执行的命令计划。 */
export interface ApprovableDeliveryCommandPlan {
  status: "approval_required";
  patchSetHash: string;
  workspaceRoot: string;
  commandPlanHash: string;
  commands: DeliveryCommand[];
  summary: string;
  preparedAt: string;
}

/** 因目录或运行时策略不允许自动执行、只能由用户手工操作的命令计划。 */
export interface ManualDeliveryCommandPlan {
  status: "manual_only";
  patchSetHash: string;
  workspaceRoot: string;
  commandPlanHash: string;
  commands: DeliveryCommand[];
  summary: string;
  reason: string;
  preparedAt: string;
}

/** Patch 落盘后持久化的完整命令准备结果。 */
export type DeliveryCommandPlan = ApprovableDeliveryCommandPlan | ManualDeliveryCommandPlan;

/** 用户对精确命令计划的持久化批准。 */
export interface DeliveryCommandApproval {
  commandPlanHash: string;
  approvedAt: string;
}

/** 命令执行器向宿主安全审计边界报告的有限事件。 */
export type DeliveryCommandAuditEvent =
  | {
      type: "proposed";
      taskId: string;
      commandPlanHash: string;
      commands: DeliveryCommand[];
    }
  | {
      type: "approved";
      taskId: string;
      commandPlanHash: string;
      commands: DeliveryCommand[];
    }
  | {
      type: "started";
      taskId: string;
      commandPlanHash: string;
      command: DeliveryCommand;
    }
  | {
      type: "completed";
      taskId: string;
      commandPlanHash: string;
      command: DeliveryCommand;
      exitCode: number | null;
      durationMs: number;
    }
  | {
      type: "blocked";
      taskId: string;
      commandPlanHash: string;
      command?: DeliveryCommand;
      reasonCode: string;
    };

/** 对用户看到并将被执行的命令字段计算稳定 SHA-256，仅排除计划说明和时间戳。 */
export function calculateDeliveryCommandPlanHash(input: {
  patchSetHash: string;
  workspaceRoot: string;
  commands: readonly DeliveryCommand[];
}): string {
  return createHash("sha256").update(JSON.stringify({
    patchSetHash: input.patchSetHash,
    workspaceRoot: input.workspaceRoot,
    commands: input.commands.map((command) => ({
      commandId: command.commandId,
      purpose: command.purpose,
      cwd: command.cwd,
      executable: command.executable,
      arguments: command.arguments,
      displayCommand: command.displayCommand,
      timeoutMs: command.timeoutMs,
      networkAccess: command.networkAccess,
      workspaceScope: command.workspaceScope,
    })),
  })).digest("hex");
}

/** 校验持久化命令计划仍与自身哈希及 Patch 绑定一致。 */
export function assertDeliveryCommandPlanIntegrity(plan: DeliveryCommandPlan): void {
  const actual = calculateDeliveryCommandPlanHash(plan);
  if (actual !== plan.commandPlanHash) {
    throw new Error("交付命令计划内容与哈希不一致，已拒绝执行。");
  }
  if (plan.status === "approval_required" && plan.commands.length === 0) {
    throw new Error("可批准的交付命令计划不能为空。");
  }
}
