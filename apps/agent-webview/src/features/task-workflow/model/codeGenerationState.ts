/** 管理候选代码 Patch 流的局部进度、取消、失败和权威结果。 */

import type {
  CodeGenerationStreamEvent,
  CodeGenerationViewModel,
  ToolExecutionMetrics,
} from "@ui-forge/shared-protocol";

/** 一条可展示的代码生成阶段进度。 */
export interface CodeGenerationProgressEntry {
  phase: "reading-context" | "generating-code" | "validating-patch" | "applying-patch"
    | "building-project" | "rendering-page" | "evaluating-visual";
  summary: string;
  metrics: ToolExecutionMetrics | null;
}

/** Webview 可直接渲染的代码生成局部状态。 */
export interface CodeGenerationState {
  status: "idle" | "generating" | "blocked" | "ready" | "stopped" | "error";
  streamActive: boolean;
  progress: CodeGenerationProgressEntry[];
  result: CodeGenerationViewModel;
  errorMessage: string | null;
}

/** 代码生成状态机接受的客户端生命周期与领域事件。 */
export type CodeGenerationAction =
  | { type: "stream-started" }
  | { type: "stream-event"; event: CodeGenerationStreamEvent }
  | { type: "stream-failed"; message: string }
  | { type: "reset"; viewModel: CodeGenerationViewModel };

/** 从服务端快照创建没有模拟数据的代码生成状态。 */
export function createCodeGenerationState(
  viewModel: CodeGenerationViewModel,
): CodeGenerationState {
  return {
    status: viewModel.status,
    streamActive: false,
    progress: [],
    result: structuredClone(viewModel),
    errorMessage: null,
  };
}

/** 按有序流事件更新代码生成展示状态。 */
export function reduceCodeGenerationState(
  state: CodeGenerationState,
  action: CodeGenerationAction,
): CodeGenerationState {
  if (action.type === "reset") return createCodeGenerationState(action.viewModel);
  if (action.type === "stream-started") {
    return {
      status: "generating",
      streamActive: true,
      progress: [],
      result: { status: "idle" },
      errorMessage: null,
    };
  }
  if (action.type === "stream-failed") {
    return {
      ...state,
      status: "error",
      streamActive: false,
      errorMessage: action.message,
    };
  }
  const event = action.event;
  switch (event.type) {
    case "code-generation-start":
      return { ...state, status: "generating", streamActive: true };
    case "code-generation-progress":
      return {
        ...state,
        progress: [...state.progress, {
          phase: event.phase,
          summary: event.summary,
          metrics: event.metrics ? structuredClone(event.metrics) : null,
        }],
      };
    case "code-generation-result":
      return {
        ...state,
        status: event.result.status,
        result: structuredClone(event.result),
      };
    case "code-generation-complete":
      return { ...state, streamActive: false };
    case "code-generation-stopped":
      return {
        ...state,
        status: "stopped",
        streamActive: false,
        errorMessage: null,
      };
  }
}
