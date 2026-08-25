/** 将设计来源 Resolver 封装为 D2C Graph 的设计检查节点。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { DesignContextResolver } from "../../../design-context/designSourceAdapter.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** 设计检查节点的稳定标识。 */
export const inspectDesignNodeId = "inspectDesign";

/** 创建通过注入 Resolver 读取标准化设计上下文的节点。 */
export function createInspectDesignNode(
  resolver: DesignContextResolver,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: inspectDesignNodeId,
    execute: async (state) => {
      const source = state.execution?.designSource;
      if (!source) throw new Error("D2C Graph 设计检查节点缺少设计来源。");
      return {
        execution: {
          ...state.execution,
          inspection: await resolver.inspect(source),
        },
      };
    },
  };
}
