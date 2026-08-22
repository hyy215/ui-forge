/** 验证执行过程按协议声明的父子工具关系稳定分组。 */

import { describe, expect, it } from "vitest";
import type { AgentToolProgress } from "../model/conversationStreamState";
import { createProcessTree } from "./AgentProcess";

describe("createProcessTree", () => {
  it("nests the visual Subagent under planning while preserving sibling order", () => {
    const entries: AgentToolProgress[] = [
      tool("project", "inspect_project"),
      tool("plan", "plan_design_changes"),
      { ...tool("visual", "visual_component_subagent"), parentToolCallId: "plan" },
    ];

    const tree = createProcessTree(entries);

    expect(tree.map((node) => node.entry.toolName)).toEqual([
      "inspect_project",
      "plan_design_changes",
    ]);
    expect(tree[1]?.children.map((node) => node.entry.toolName)).toEqual([
      "visual_component_subagent",
    ]);
  });

  it("keeps a child with a missing parent visible at the top level", () => {
    const tree = createProcessTree([{
      ...tool("visual", "visual_component_subagent"),
      parentToolCallId: "missing-plan",
    }]);

    expect(tree[0]?.entry.toolName).toBe("visual_component_subagent");
  });
});

/** 创建不带指标的最小工具过程记录。 */
function tool(toolCallId: string, toolName: string): AgentToolProgress {
  return { toolCallId, toolName, summary: toolName, outcome: "running", metrics: null };
}
