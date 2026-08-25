/** 将确定性目标项目检查封装为独立 D2C Graph 前置节点。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { ProjectInspector } from "../../../project-context/projectInspector.js";
import type { SecondStepProgressReporter } from "../../../second-step/secondStepProgress.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** 确定性项目检查节点的稳定标识。 */
export const inspectProjectNodeId = "inspectProject";

/** 创建只读取最小工程证据的项目检查节点。 */
export function createInspectProjectNode(
  inspector: ProjectInspector,
  resolveReporter: (taskId: string) => SecondStepProgressReporter | undefined,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: inspectProjectNodeId,
    execute: async (state) => {
      if (!state.task?.inspectedDesign) {
        throw new Error("项目检查节点缺少已持久化的设计检查结果。");
      }
      const reporter = resolveReporter(state.task.taskId);
      await reporter?.({ type: "project-inspection-start" });
      const startedAt = performance.now();
      const inspection = await inspector.inspect(state.task.projectPath);
      await reporter?.({
        type: "project-inspection-complete",
        inspection: structuredClone(inspection),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return {
        execution: {
          ...state.execution,
          inspection: structuredClone(state.task.inspectedDesign),
          projectInspection: inspection,
        },
      };
    },
  };
}

/** 计算项目节点的非负整数毫秒耗时。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
