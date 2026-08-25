/** 将多模态视觉复核封装为 Plan DeepAgent Graph 节点。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { PlanDeepAgent } from "../../../second-step/planDeepAgent.js";
import type { SecondStepProgressReporter } from "../../../second-step/secondStepProgress.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** Plan DeepAgent 节点的稳定标识。 */
export const planDeepAgentNodeId = "planDeepAgent";

/** 创建消费前置项目与组件结果的多模态节点。 */
export function createPlanDeepAgentNode(
  agent: PlanDeepAgent,
  resolveReporter: (taskId: string) => SecondStepProgressReporter | undefined,
  resolveSignal: (taskId: string) => AbortSignal | undefined,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: planDeepAgentNodeId,
    execute: async (state) => {
      const execution = state.execution;
      if (!state.task || !execution?.inspection || !execution.projectInspection
        || !execution.componentRecognition || !execution.projectContextAnalysis
        || !execution.componentCatalog) {
        throw new Error("Plan DeepAgent 节点缺少前置项目或组件结果。");
      }
      const reportProgress = resolveReporter(state.task.taskId);
      const signal = resolveSignal(state.task.taskId);
      const result = await agent.plan({
        taskId: state.task.taskId,
        taskGoal: state.task.taskGoal,
        inspection: structuredClone(execution.inspection),
        projectInspection: structuredClone(execution.projectInspection),
        recognition: structuredClone(execution.componentRecognition),
        projectContext: structuredClone(execution.projectContextAnalysis),
        catalog: structuredClone(execution.componentCatalog),
        designSystemWarnings: [...(execution.designSystemWarnings ?? [])],
        ...(reportProgress ? { reportProgress } : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        execution: {
          ...execution,
          componentRecognition: structuredClone(result.componentRecognition),
          plan: structuredClone(result.plan),
        },
      };
    },
  };
}
