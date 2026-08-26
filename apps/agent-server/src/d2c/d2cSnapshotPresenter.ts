/** 将两步 D2C 任务裁剪并投影为 shared-protocol 快照。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type {
  D2CWorkflowSnapshot,
  D2CWorkflowStatus,
  DesignComponentRecognition,
  PlanningResult,
  ProjectValidation,
  SvgTool,
  TaskWorkflowViewModel,
  CodeGenerationViewModel,
} from "@ui-forge/shared-protocol";

/** 穷尽定义领域任务状态到公开协议状态的真实适配边界。 */
const workflowStatusByTaskStatus = {
  draft: "draft",
  svg_ready: "svg_ready",
  design_confirmed: "design_confirmed",
  analysis_ready: "analysis_ready",
  plan_approved: "plan_approved",
  patch_ready: "patch_ready",
  patch_applied: "patch_applied",
  command_approval_required: "command_approval_required",
  command_approved: "command_approved",
  validation_blocked: "validation_blocked",
  delivery_ready: "delivery_ready",
} satisfies Record<D2CAgent.TaskStatus, D2CWorkflowStatus>;

/** 将内部任务转换为 Webview 可安全消费的权威快照。 */
export function toD2CWorkflowSnapshot(task: D2CAgent.Task): D2CWorkflowSnapshot {
  return {
    taskId: task.taskId,
    revision: task.revision,
    status: workflowStatusByTaskStatus[task.status],
    viewModel: createViewModel(task),
  };
}

/** 创建只包含设计输入与 SVG 预览的客户端模型。 */
function createViewModel(task: D2CAgent.Task): TaskWorkflowViewModel {
  const inspected = task.inspectedDesign;
  const context = inspected?.context;
  const designReference = task.designSource?.reference ?? "";
  return {
    setup: {
      projectPath: task.projectPath,
      taskGoal: task.taskGoal,
      designUrl: designReference,
      designSummary: context
        ? createInspectedDesignSummary(context, inspected?.artifact)
        : null,
    },
    svg: {
      taskGoal: task.taskGoal,
      statusMessage: createSvgStatusMessage(task),
      tools: inspected ? [createDesignTool(designReference, inspected)] : [],
    },
    conversation: {
      initialUserMessage: task.taskGoal,
      planStatus: createPlanStatus(task.projectInspection, task.plan),
      projectValidation: task.projectInspection
        ? toProjectValidation(task.projectInspection)
        : null,
      designComponentRecognition: task.componentRecognition
        ? toDesignComponentRecognition(task.componentRecognition)
        : null,
      plan: task.plan ? toPlanningResult(task.plan) : null,
      planApproval: createPlanApprovalViewModel(task),
    },
    codeGeneration: toCodeGenerationViewModel(
      task.codeGeneration,
      task.patchApplication,
      task.deliveryCommandPlan,
      task.deliveryCommandApproval,
      task.deliveryValidation,
    ),
  };
}

/** 将内部版本化 Plan 与可选批准记录投影为可恢复的精确批准状态。 */
function createPlanApprovalViewModel(
  task: D2CAgent.Task,
): TaskWorkflowViewModel["conversation"]["planApproval"] {
  const plan = task.evolvingPlan;
  if (!plan) return null;
  const approval = task.planApproval;
  if (approval?.planVersion === plan.planVersion && approval.planHash === plan.planHash) {
    return {
      status: "approved",
      planVersion: approval.planVersion,
      planHash: approval.planHash,
      approvedAt: approval.approvedAt,
      executionMode: approval.executionMode,
    };
  }
  return {
    status: "pending",
    planVersion: plan.planVersion,
    planHash: plan.planHash,
  };
}

/** 将内部候选 Patch 裁剪为不含待写入完整内容的公开审阅模型。 */
export function toCodeGenerationViewModel(
  outcome: D2CAgent.CodeGenerationOutcome | undefined,
  application?: D2CAgent.PatchApplicationOutcome,
  commandPlan?: D2CAgent.DeliveryCommandPlan,
  commandApproval?: D2CAgent.DeliveryCommandApproval,
  deliveryValidation?: D2CAgent.ProjectDeliveryValidationOutcome,
): CodeGenerationViewModel {
  if (!outcome) return { status: "idle" };
  if (outcome.status === "blocked") {
    return {
      status: "blocked",
      summary: outcome.summary,
      reasons: [...outcome.reasons],
      warnings: [...outcome.warnings],
    };
  }
  return {
    status: "ready",
    patchSet: {
      patchSetHash: outcome.patchSet.patchSetHash,
      planVersion: outcome.patchSet.planVersion,
      planHash: outcome.patchSet.planHash,
      summary: outcome.patchSet.summary,
      patches: outcome.patchSet.patches.map((patch) => ({
        stepId: patch.stepId,
        patchHash: patch.patchHash,
        operations: patch.operations.map((operation) => ({
          path: operation.path,
          action: operation.action,
          beforeHash: operation.beforeHash,
          afterHash: operation.afterHash,
          reviewDiff: operation.reviewDiff,
        })),
      })),
      warnings: [...outcome.patchSet.warnings],
    },
    application: toPatchApplicationViewModel(application),
    deliveryCommands: toDeliveryCommandPlanViewModel(commandPlan, commandApproval),
    deliveryValidation: deliveryValidation
      ? structuredClone(deliveryValidation)
      : { status: "pending" },
  };
}

/** 将内部命令计划与批准记录投影为不包含环境变量的真实命令展示。 */
function toDeliveryCommandPlanViewModel(
  plan: D2CAgent.DeliveryCommandPlan | undefined,
  approval: D2CAgent.DeliveryCommandApproval | undefined,
): Extract<CodeGenerationViewModel, { status: "ready" }>["deliveryCommands"] {
  if (!plan) return { status: "pending" };
  const base = {
    patchSetHash: plan.patchSetHash,
    workspaceRoot: plan.workspaceRoot,
    commandPlanHash: plan.commandPlanHash,
    commands: plan.commands.map((command) => structuredClone(command)),
    summary: plan.summary,
    preparedAt: plan.preparedAt,
  };
  if (plan.status === "manual_only") {
    return { status: "manual_only", ...base, reason: plan.reason };
  }
  if (approval?.commandPlanHash === plan.commandPlanHash) {
    return { status: "approved", ...base, approvedAt: approval.approvedAt };
  }
  return { status: "approval_required", ...base };
}

/** 把内部写入结论裁剪为不含绝对路径、源码和恢复细节的公开状态。 */
function toPatchApplicationViewModel(
  application: D2CAgent.PatchApplicationOutcome | undefined,
): Extract<CodeGenerationViewModel, { status: "ready" }>["application"] {
  if (!application) return { status: "pending" };
  if (application.status === "blocked") {
    return {
      status: "blocked",
      patchSetHash: application.patchSetHash,
      summary: application.summary,
      reasons: [...application.reasons],
      manualActionRequired: true,
      blockedAt: application.blockedAt,
    };
  }
  return {
    status: "applied",
    patchSetHash: application.patchSetHash,
    files: application.files.map((file) => ({ ...file })),
    alreadyApplied: application.alreadyApplied,
    appliedAt: application.appliedAt,
  };
}

/** 将领域识别结果裁剪为不包含原始节点和供应商载荷的公开模型。 */
export function toDesignComponentRecognition(
  recognition: D2CAgent.DesignComponentRecognition,
): DesignComponentRecognition {
  return {
    status: recognition.status,
    components: recognition.components.map((component) => ({
      id: component.id,
      name: component.name,
      instanceCount: component.instanceCount,
      evidence: [...component.evidence],
      evidenceStrength: component.evidenceStrength,
      ...(component.typeHint ? { typeHint: structuredClone(component.typeHint) } : {}),
      ...(component.visualSuggestion
        ? { visualSuggestion: structuredClone(component.visualSuggestion) }
        : {}),
      ...(component.effectiveTypeId ? { effectiveTypeId: component.effectiveTypeId } : {}),
      ...(component.resolvedBy ? { resolvedBy: component.resolvedBy } : {}),
      ...(component.resolutionReason ? { resolutionReason: component.resolutionReason } : {}),
    })),
    warnings: [...recognition.warnings],
  };
}

/** 将内部项目检查结果裁剪为不暴露绝对路径的客户端模型。 */
export function toProjectValidation(
  inspection: D2CAgent.ProjectInspection,
): ProjectValidation {
  switch (inspection.kind) {
    case "empty":
      return {
        kind: "empty",
        message: "检测到空项目；实施前需要初始化 React + TypeScript + Ant Design 项目。",
      };
    case "react_antd":
      return {
        kind: "react_antd",
        message: "项目校验通过，当前项目支持 React + Ant Design D2C 工作流。",
        ...(inspection.reactVersion ? { reactVersion: inspection.reactVersion } : {}),
        ...(inspection.antdVersion ? { antdVersion: inspection.antdVersion } : {}),
      };
    case "unsupported":
      return {
        kind: "unsupported",
        message: `当前项目不支持：${inspection.reasons.join("；")}`,
        reasons: [...inspection.reasons],
      };
  }
}

/** 根据项目校验状态创建第二步当前可恢复阶段。 */
function createPlanStatus(
  inspection: D2CAgent.ProjectInspection | undefined,
  plan: D2CAgent.PlanningResult | undefined,
): TaskWorkflowViewModel["conversation"]["planStatus"] {
  if (!inspection) return "idle";
  if (inspection.kind === "unsupported") return "unsupported";
  return plan ? "ready" : "validated";
}

/** 将领域方案复制为共享协议允许的审阅型结果。 */
function toPlanningResult(plan: D2CAgent.PlanningResult): PlanningResult {
  return structuredClone(plan);
}

/** 创建 SVG 预览确认提示。 */
function createSvgStatusMessage(task: D2CAgent.Task): string {
  switch (task.status) {
    case "draft": return "请先读取并确认设计预览。";
    case "svg_ready": return "直接展示设计读取阶段返回的 SVG。";
    case "design_confirmed": return "设计已确认，等待项目与组件分析。";
    case "analysis_ready": return "设计已确认，方案分析已完成。";
    case "plan_approved": return "整体修改方案已批准，等待生成候选代码。";
    case "patch_ready": return "候选代码 Patch 已生成，但自动应用需要人工处理。";
    case "patch_applied": return "候选代码已安全应用到目标项目。";
    case "command_approval_required": return "代码已落盘，请审阅系统将执行的真实命令。";
    case "command_approved": return "真实交付命令已批准，等待用户继续执行。";
    case "validation_blocked": return "代码已落盘，自动交付验收需要人工处理。";
    case "delivery_ready": return "代码已通过构建、页面渲染和视觉验收。";
  }
}

/** 将设计读取证据映射为 SVG 页面工具记录。 */
function createDesignTool(
  designReference: string,
  inspected: NonNullable<D2CAgent.Task["inspectedDesign"]>,
): SvgTool {
  const context = inspected.context;
  const firstRegion = context.regions[0];
  return {
    name: `${inspected.provenance.provider} 设计读取`,
    durationMs: inspected.durationMs,
    summary: `已读取 ${context.regions.length} 个设计区域、${context.nodeCount} 个节点`,
    source: `${inspected.provenance.provider} · ${inspected.provenance.transport}`,
    details: {
      label: "查看标准化设计结果",
      file: designReference,
      node: firstRegion?.id ?? "unknown",
      nodeCount: context.nodeCount,
      payload: {
        designName: context.name,
        regionCount: context.regions.length,
        tokenCount: Object.keys(context.tokens).length,
        operations: inspected.provenance.operations,
        warnings: context.warnings,
      },
    },
  };
}

/** 将设计上下文裁剪为设置页允许展示的摘要。 */
function createInspectedDesignSummary(
  context: D2CAgent.DesignContext,
  artifact: D2CAgent.DesignArtifactReference | undefined,
) {
  const firstRegion = context.regions[0];
  return {
    name: context.name,
    nodeId: firstRegion?.id ?? "unknown",
    nodeName: firstRegion?.name ?? firstRegion?.id ?? "未识别区域",
    regionCount: context.regions.length,
    nodeCount: context.nodeCount,
    tokenCount: Object.keys(context.tokens).length,
    preview: context.preview ?? null,
    structurePreview: context.structurePreview ?? null,
    designData: artifact ?? null,
    warnings: context.warnings,
  };
}
