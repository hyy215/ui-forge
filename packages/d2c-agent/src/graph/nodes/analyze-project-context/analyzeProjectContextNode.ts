/** 将受控仓库扫描封装为组件识别与主规划之间的确定性 Graph 节点。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { ProjectContextAnalyzer } from "../../../project-context/projectContextAnalysis.js";
import type { SecondStepProgressReporter } from "../../../second-step/secondStepProgress.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** 项目上下文分析节点的稳定标识。 */
export const analyzeProjectContextNodeId = "analyzeProjectContext";

/** 创建只接受已通过项目门禁和设计候选的仓库分析节点。 */
export function createAnalyzeProjectContextNode(
  analyzer: ProjectContextAnalyzer,
  resolveReporter: (taskId: string) => SecondStepProgressReporter | undefined,
  resolveSignal: (taskId: string) => AbortSignal | undefined,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: analyzeProjectContextNodeId,
    execute: async (state) => {
      const inspection = state.execution?.projectInspection;
      const recognition = state.execution?.componentRecognition;
      if (!state.task || !inspection || inspection.kind === "unsupported" || !recognition) {
        throw new Error("项目上下文节点缺少已通过门禁的项目或组件候选。");
      }
      const reporter = resolveReporter(state.task.taskId);
      const signal = resolveSignal(state.task.taskId);
      throwIfAborted(signal);
      await reporter?.({ type: "project-context-analysis-start" });
      const startedAt = performance.now();
      const analysis = await analyzer.analyze({
        inspection: structuredClone(inspection),
        recognition: structuredClone(recognition),
        ...(signal ? { signal } : {}),
      });
      await reporter?.({
        type: "project-context-analysis-complete",
        analysis: structuredClone(analysis),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return {
        execution: {
          ...state.execution,
          projectContextAnalysis: analysis,
        },
      };
    },
  };
}

/** 计算仓库分析节点的非负整数毫秒耗时。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** 在进入目标仓库分析前响应任务取消。 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("目标仓库分析已由用户终止。", "AbortError");
}
