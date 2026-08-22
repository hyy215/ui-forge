/** 验证第二步流事件区分过程证据、组件结果和真实方案结果。 */

import { describe, expect, it } from "vitest";
import {
  conversationStreamEventSchema,
  conversationViewModelSchema,
  planningComponentDecisionSchema,
} from "./conversationProtocol.js";

describe("conversation protocol", () => {
  it("validates project progress without exposing arbitrary reasoning fields", () => {
    const event = conversationStreamEventSchema.parse({
      type: "agent-progress",
      messageId: "assistant-1",
      phase: "project-validation",
      title: "检查目标项目",
      summary: "正在校验 package.json 中的受支持依赖。",
    });

    expect(event.type).toBe("agent-progress");
    expect(conversationStreamEventSchema.safeParse({
      ...event,
      type: "hidden-reasoning",
      chainOfThought: "private",
    }).success).toBe(false);
  });

  it("keeps plan absent after real project validation", () => {
    const viewModel = conversationViewModelSchema.parse({
      initialUserMessage: "请结合当前项目与客户列表设计生成整体修改方案。",
      planStatus: "validated",
      projectValidation: {
        kind: "react_antd",
        message: "项目校验通过。",
        reactVersion: "^19.0.0",
        antdVersion: "^6.0.0",
      },
      designComponentRecognition: null,
      plan: null,
    });

    expect(viewModel.plan).toBeNull();
  });

  it("validates open component IDs and the final decision audit fields", () => {
    const event = conversationStreamEventSchema.parse({
      type: "design-component-result",
      messageId: "assistant-1",
      result: {
        status: "recognized",
        components: [{
          id: "component:node-1",
          name: "业务组件",
          instanceCount: 1,
          evidence: ["节点名称包含选择控件语义"],
          evidenceStrength: "weak",
          typeHint: { typeId: "business-widget", matchedAlias: "业务组件" },
          visualSuggestion: {
            suggestedTypeId: "navigation",
            confidence: 0.82,
            evidence: ["图片中存在横向菜单结构"],
          },
          effectiveTypeId: "navigation",
          resolvedBy: "model",
          resolutionReason: "视觉证据更明确",
        }],
        warnings: [],
      },
    });

    expect(event.type).toBe("design-component-result");
    expect(conversationStreamEventSchema.safeParse({
      ...event,
      result: {
        ...event.result,
        components: [{ ...event.result.components[0], effectiveTypeId: "Invalid Type" }],
      },
    }).success).toBe(false);
  });

  it("rejects unresolved decisions that still expose an effective type", () => {
    expect(conversationStreamEventSchema.safeParse({
      type: "design-component-result",
      messageId: "assistant-1",
      result: {
        status: "recognized",
        components: [{
          id: "component:node-1",
          name: "主导航",
          instanceCount: 1,
          evidence: ["导航结构"],
          evidenceStrength: "structural",
          effectiveTypeId: "navigation",
          resolvedBy: "unresolved",
          resolutionReason: "证据冲突",
        }],
        warnings: [],
      },
    }).success).toBe(false);
  });

  it("validates tool metrics and an explicit stopped event", () => {
    expect(conversationStreamEventSchema.parse({
      type: "tool-start",
      messageId: "assistant-1",
      toolCallId: "visual-tool",
      parentToolCallId: "plan-tool",
      toolName: "visual_component_subagent",
      summary: "正在分析图片。",
    })).toMatchObject({ parentToolCallId: "plan-tool" });
    expect(conversationStreamEventSchema.parse({
      type: "tool-complete",
      messageId: "assistant-1",
      toolCallId: "tool-1",
      summary: "组件分析完成。",
      outcome: "success",
      metrics: {
        durationMs: 1234,
        tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      },
    })).toMatchObject({ metrics: { durationMs: 1234 } });
    expect(conversationStreamEventSchema.parse({
      type: "message-stopped",
      messageId: "assistant-1",
    }).type).toBe("message-stopped");
  });

  it("validates layout, inferred interactions, reuse decisions and atomic plan steps", () => {
    const event = conversationStreamEventSchema.parse({
      type: "plan-result",
      messageId: "assistant-1",
      plan: {
        status: "reviewable",
        summary: "实现客户列表",
        designUnderstanding: {
          layout: { summary: "筛选区位于表格上方", regions: [{
            id: "filter", sourceNodeIds: ["search"], name: "筛选区", role: "toolbar",
            relationship: "位于表格上方", direction: "row", evidence: ["设计结构"],
          }], evidence: ["设计结构"], warnings: [] },
          interactions: [{
            id: "search-submit", triggerNodeIds: ["search"], trigger: "submit",
            expectedEffect: "提交搜索条件", confidence: 0.8, evidence: ["搜索按钮"], status: "inferred",
          }],
          elements: [{
            id: "element-search", sourceNodeIds: ["search"], regionId: "filter", kind: "input",
            name: "搜索框", text: "输入过滤文本", textStatus: "exact", states: ["default"],
            implementation: "required", evidence: ["整体图"],
          }],
        },
        reusableComponents: [],
        newComponents: [],
        componentDecisions: [{
          candidateId: "table", action: "create-new", source: "new",
          reason: "没有仓库候选", evidence: ["检索结果为空"],
        }],
        fileImpacts: [{
          path: "src/CustomerTable.tsx", action: "create", reason: "新增表格", affectedSymbols: ["CustomerTable"],
          downstreamConsumers: [], risk: "low", evidence: ["组件决策"],
        }],
        steps: [{
          id: "layout", kind: "layout", targetId: "page", title: "建立布局", description: "创建外部容器",
          decision: "create", dependsOn: [], files: [], designElementIds: ["element-search"],
          evidence: ["设计结构"], acceptanceCriteria: ["布局明确"], risks: [],
        }],
        files: ["src/CustomerTable.tsx"],
        contextGaps: [],
        stopConditions: ["验证失败时停止"],
      },
    });
    expect(event.type).toBe("plan-result");
  });

  it("rejects component reuse decisions whose source and identifiers conflict", () => {
    const base = {
      candidateId: "table",
      reason: "测试来源约束",
      evidence: ["受控证据"],
    };
    expect(conversationStreamEventSchema.safeParse({
      type: "plan-result",
      messageId: "assistant-1",
      plan: {
        status: "blocked",
        summary: "来源冲突",
        designUnderstanding: {
          layout: { summary: "未知", regions: [], evidence: ["设计结构"], warnings: [] },
          interactions: [],
        },
        reusableComponents: [],
        newComponents: [],
        componentDecisions: [{
          ...base,
          action: "reuse-directly",
          source: "catalog",
          catalogComponentId: "table",
          repositoryComponentId: "src/Table.tsx#Table",
        }],
        fileImpacts: [],
        steps: [{
          id: "validation", kind: "validation", targetId: "plan", title: "验证", description: "验证来源",
          decision: "validate", dependsOn: [], files: [], evidence: ["约束"], acceptanceCriteria: ["拒绝冲突"], risks: [],
        }],
        files: [],
        contextGaps: [],
        stopConditions: ["来源冲突时停止"],
      },
    }).success).toBe(false);
    expect(planningComponentDecisionSchema.safeParse({
      ...base,
      action: "create-new",
      source: "new",
      catalogComponentId: "table",
    }).success).toBe(false);
    expect(planningComponentDecisionSchema.safeParse({
      ...base,
      action: "unresolved",
      source: "unresolved",
      repositoryComponentId: "src/Table.tsx#Table",
    }).success).toBe(false);
  });
});
