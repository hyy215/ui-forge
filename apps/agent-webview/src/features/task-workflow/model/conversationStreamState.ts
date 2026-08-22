/** 管理第二步项目校验、组件识别、可审计过程和未来方案的局部状态机。 */

import type {
  ConversationStreamEvent,
  ConversationViewModel,
  DesignComponentRecognition,
  PlanningResult,
  ProjectValidation,
  ToolExecutionMetrics,
} from "@ui-forge/shared-protocol";

/** 对话区展示的一次受控工具调用状态。 */
export interface AgentToolProgress {
  toolCallId: string;
  parentToolCallId?: string;
  toolName: string;
  summary: string;
  outcome: "running" | "success" | "warning" | "error";
  metrics: ToolExecutionMetrics | null;
}

/** 对话流中可用于错误归因的公开执行阶段。 */
export type ConversationFailureStage =
  | "project-validation"
  | "design-analysis"
  | "project-analysis"
  | "visual-analysis"
  | "planning";

/** 第二步对话流可直接渲染的完整局部状态。 */
export interface ConversationStreamState {
  status: ConversationViewModel["planStatus"];
  streamStartedAt: number | null;
  streamFinishedAt: number | null;
  streamActive: boolean;
  processEntries: AgentToolProgress[];
  projectValidation: ProjectValidation | null;
  designComponentRecognition: DesignComponentRecognition | null;
  plan: PlanningResult | null;
  errorMessage: string | null;
  activeStage: ConversationFailureStage | null;
  failureStage: ConversationFailureStage | null;
}

/** 对话状态机接受的领域事件与客户端生命周期动作。 */
export type ConversationStreamAction =
  | { type: "stream-started" }
  | { type: "stream-event"; event: ConversationStreamEvent }
  | { type: "stream-failed"; message: string }
  | { type: "reset"; viewModel: ConversationViewModel };

/** 从权威快照创建没有演示数据的第二步局部状态。 */
export function createConversationStreamState(
  viewModel: ConversationViewModel,
): ConversationStreamState {
  return {
    status: viewModel.planStatus,
    streamStartedAt: null,
    streamFinishedAt: null,
    streamActive: false,
    processEntries: [],
    projectValidation: viewModel.projectValidation,
    designComponentRecognition: viewModel.designComponentRecognition,
    plan: viewModel.plan,
    errorMessage: null,
    activeStage: null,
    failureStage: null,
  };
}

/** 按服务端事件顺序更新第二步展示状态，不推导隐藏模型思维。 */
export function reduceConversationStreamState(
  state: ConversationStreamState,
  action: ConversationStreamAction,
): ConversationStreamState {
  if (action.type === "reset") return createConversationStreamState(action.viewModel);
  if (action.type === "stream-started") {
    return {
      ...state,
      status: "validating_project",
      streamStartedAt: Date.now(),
      streamFinishedAt: null,
      streamActive: true,
      processEntries: [],
      designComponentRecognition: null,
      errorMessage: null,
      activeStage: "project-validation",
      failureStage: null,
    };
  }
  if (action.type === "stream-failed") {
    return {
      ...state,
      status: "error",
      streamFinishedAt: Date.now(),
      streamActive: false,
      errorMessage: action.message,
      activeStage: null,
      failureStage: state.activeStage,
    };
  }

  const event = action.event;
  switch (event.type) {
    case "message-start":
      return state;
    case "agent-progress":
      return {
        ...state,
        status: event.phase === "design-analysis" ? "analyzing_design" : state.status,
        activeStage: event.phase,
      };
    case "tool-start": {
      const tool: AgentToolProgress = {
        toolCallId: event.toolCallId,
        ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
        toolName: event.toolName,
        summary: event.summary,
        outcome: "running",
        metrics: null,
      };
      return {
        ...state,
        processEntries: [...state.processEntries, tool],
        activeStage: event.toolName === "visual_component_subagent"
          ? "visual-analysis"
          : state.activeStage,
      };
    }
    case "tool-complete": {
      const completedTool = state.processEntries.find(
        (tool) => tool.toolCallId === event.toolCallId,
      );
      const updateTool = (tool: AgentToolProgress): AgentToolProgress =>
        tool.toolCallId === event.toolCallId
          ? {
            ...tool,
            summary: event.summary,
            outcome: event.outcome,
            metrics: event.metrics ? structuredClone(event.metrics) : null,
          }
          : tool;
      return {
        ...state,
        processEntries: state.processEntries.map(updateTool),
        activeStage: completedTool?.toolName === "visual_component_subagent"
          ? "planning"
          : state.activeStage,
      };
    }
    case "project-validation":
      return {
        ...state,
        projectValidation: event.result,
        status: event.result.kind === "unsupported" ? "unsupported" : "validated",
      };
    case "design-component-result":
      return {
        ...state,
        designComponentRecognition: structuredClone(event.result),
        status: "validated",
      };
    case "plan-start":
      return {
        ...state,
        status: "planning",
        plan: null,
        activeStage: "planning",
      };
    case "plan-result":
      return {
        ...state,
        status: "ready",
        plan: event.plan,
      };
    case "message-complete":
      return {
        ...state,
        streamFinishedAt: Date.now(),
        streamActive: false,
        activeStage: null,
      };
    case "message-stopped":
      return {
        ...state,
        status: "stopped",
        streamFinishedAt: Date.now(),
        streamActive: false,
        errorMessage: null,
        activeStage: null,
        failureStage: null,
      };
  }
}

/** 按失败发生时的真实阶段返回对话错误标题。 */
export function createConversationFailureTitle(stage: ConversationFailureStage | null): string {
  switch (stage) {
    case "project-validation": return "项目校验失败";
    case "design-analysis": return "设计组件识别失败";
    case "project-analysis": return "目标仓库分析失败";
    case "visual-analysis": return "视觉分析失败";
    case "planning": return "方案生成失败";
    case null: return "分析失败";
  }
}
