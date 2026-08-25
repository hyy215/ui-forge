/** 将两步 D2C 任务裁剪并投影为 shared-protocol 快照。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type {
  D2CWorkflowPhase,
  D2CWorkflowSnapshot,
  D2CWorkflowState,
  DesignComponentRecognition,
  PlanningResult,
  ProjectValidation,
  SvgTool,
  TaskWorkflowViewModel,
} from "@ui-forge/shared-protocol";

/** 将内部任务转换为 Webview 可安全消费的权威快照。 */
export function toD2CWorkflowSnapshot(task: D2CAgent.Task): D2CWorkflowSnapshot {
  return {
    taskId: task.taskId,
    revision: task.revision,
    workflowPhase: createWorkflowPhase(task.status),
    state: createWorkflowState(task),
    viewModel: createViewModel(task),
  };
}

/** 将领域状态映射为公开工作流阶段。 */
function createWorkflowPhase(status: D2CAgent.TaskStatus): D2CWorkflowPhase {
  switch (status) {
    case "draft": return "draft";
    case "svg_ready": return "svg_ready";
    case "design_confirmed": return "design_confirmed";
    case "analysis_ready": return "analysis_ready";
  }
}

/** 将领域持久化状态一对一投影为客户端页面阶段判别联合。 */
function createWorkflowState(task: D2CAgent.Task): D2CWorkflowState {
  switch (task.status) {
    case "draft": return { phase: "setup", status: "draft" };
    case "svg_ready": return { phase: "svg", status: "svg_ready" };
    case "design_confirmed": return { phase: "conversation", status: "design_confirmed" };
    case "analysis_ready": return { phase: "conversation", status: "analysis_ready" };
  }
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
    },
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
