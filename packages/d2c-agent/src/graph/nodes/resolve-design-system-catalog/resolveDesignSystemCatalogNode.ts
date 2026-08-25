/** 使用注入的设计系统知识端口解析当前项目版本对应的组件目录。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { ComponentCatalog } from "../../../design-components/componentCatalog.js";
import type { DesignSystemKnowledgeProvider } from "../../../design-system/designSystemKnowledge.js";
import type { SecondStepProgressReporter } from "../../../second-step/secondStepProgress.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** 版本化设计系统目录节点的稳定标识。 */
export const resolveDesignSystemCatalogNodeId = "resolveDesignSystemCatalog";

/** 创建在项目校验后运行的只读设计系统知识节点。 */
export function createResolveDesignSystemCatalogNode(
  provider: DesignSystemKnowledgeProvider | undefined,
  baseCatalog: ComponentCatalog,
  resolveReporter: (taskId: string) => SecondStepProgressReporter | undefined,
  resolveSignal: (taskId: string) => AbortSignal | undefined,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: resolveDesignSystemCatalogNodeId,
    execute: async (state) => {
      const inspection = state.execution?.projectInspection;
      if (!state.task || !inspection || inspection.kind === "unsupported") {
        throw new Error("设计系统目录节点缺少已通过门禁的目标项目。");
      }
      const reporter = resolveReporter(state.task.taskId);
      const signal = resolveSignal(state.task.taskId);
      throwIfAborted(signal);
      await reporter?.({ type: "design-system-catalog-start" });
      const startedAt = performance.now();
      const resolution = provider
        ? await provider.resolveCatalog({
            inspection: structuredClone(inspection),
            baseCatalog: structuredClone(baseCatalog),
            ...(signal ? { signal } : {}),
          })
        : {
            catalog: structuredClone(baseCatalog),
            warnings: ["当前未配置 Ant Design MCP，已使用静态组件目录。"],
          };
      await reporter?.({
        type: "design-system-catalog-complete",
        componentCount: resolution.catalog.components.length,
        warnings: [...resolution.warnings],
        durationMs: elapsedMilliseconds(startedAt),
      });
      return {
        execution: {
          ...state.execution,
          componentCatalog: structuredClone(resolution.catalog),
          designSystemWarnings: [...resolution.warnings],
        },
      };
    },
  };
}

/** 计算目录解析耗时。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** 在进入外部设计系统查询前响应任务取消。 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("设计系统目录查询已由用户终止。", "AbortError");
}
