/** 验证视觉 Subagent 将模型数组归一化为与权威候选严格一一对应的建议。 */

import { AgentCore } from "@ui-forge/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import { createVisualComponentSubagent } from "./visualComponentSubagent.js";

const catalog: ComponentCatalog = { components: [
  { id: "navigation", name: "Navigation", aliases: ["导航"] },
  { id: "select", name: "Select", aliases: ["选择"] },
] };
const recognition: DesignComponentRecognition = {
  status: "recognized",
  components: [{
    id: "component:3:00669",
    name: "导航",
    sourceNodeIds: ["3:00669"],
    instanceCount: 1,
    evidence: ["来源组件"],
    evidenceStrength: "explicit",
  }, {
    id: "component:3:00700",
    name: "选择器",
    sourceNodeIds: ["3:00700"],
    instanceCount: 1,
    evidence: ["来源组件"],
    evidenceStrength: "explicit",
  }],
  warnings: [],
};

describe("createVisualComponentSubagent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("merges compatible duplicates and restores authoritative candidate order", async () => {
    const agent = createAgent([{ candidateId: "component:3:00700", suggestedTypeId: "select", confidence: 0.8, evidence: ["下拉箭头"] },
      { candidateId: "component:3:00669", suggestedTypeId: "navigation", confidence: 0.7, evidence: ["纵向菜单"] },
      { candidateId: "component:3:00669", suggestedTypeId: "navigation", confidence: 0.9, evidence: ["纵向菜单", "多项入口"] }]);

    await expect(review(agent)).resolves.toEqual({
      designUnderstanding: {
        layout: { summary: "左右布局", regions: [], evidence: ["整体图"], warnings: [] },
        interactions: [],
        elements: [],
      },
      additionalCandidates: [],
      suggestions: [{
      candidateId: "component:3:00669",
      suggestedTypeId: "navigation",
      confidence: 0.9,
      evidence: ["纵向菜单", "多项入口"],
    }, {
      candidateId: "component:3:00700",
      suggestedTypeId: "select",
      confidence: 0.8,
      evidence: ["下拉箭头"],
      }],
    });
  });

  it("rejects conflicting duplicate types", async () => {
    const agent = createAgent([{ candidateId: "component:3:00669", suggestedTypeId: "navigation", confidence: 0.8, evidence: ["菜单"] },
      { candidateId: "component:3:00669", suggestedTypeId: "select", confidence: 0.7, evidence: ["箭头"] },
      { candidateId: "component:3:00700", suggestedTypeId: "select", confidence: 0.8, evidence: ["下拉"] }]);

    await expect(review(agent)).rejects.toThrow("返回了冲突类型：component:3:00669");
  });

  it("reports an unknown candidate separately", async () => {
    const agent = createAgent([{ candidateId: "component:unknown", confidence: 0.2, evidence: ["无法定位"] }]);

    await expect(review(agent)).rejects.toThrow("返回了未知候选：component:unknown");
  });

  it("reports every omitted candidate", async () => {
    const agent = createAgent([{ candidateId: "component:3:00669", suggestedTypeId: "navigation", confidence: 0.8, evidence: ["菜单"] }]);

    await expect(review(agent)).rejects.toThrow("遗漏了候选：component:3:00700");
  });

  it("rejects a type outside the configured catalog", async () => {
    const agent = createAgent([{ candidateId: "component:3:00669", suggestedTypeId: "table", confidence: 0.8, evidence: ["表格"] }]);

    await expect(review(agent)).rejects.toThrow("返回了目录外类型：table");
  });

  it("repairs one semantic validation failure and records only stable diagnostics", async () => {
    const diagnostics: AgentCore.ModelInvocationDiagnostic[] = [];
    const initialInvoke = vi.fn(async (_input: AgentCore.AgentInput) => ({
      response: "done",
      structuredResponse: createStructuredResponse([completeSuggestions()[0]]),
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    }));
    const repairInvoke = vi.fn(async (_input: AgentCore.AgentInput) => ({
      response: "done",
      structuredResponse: createStructuredResponse(completeSuggestions()),
      usage: { inputTokens: 80, outputTokens: 10, totalTokens: 90 },
    }));
    const createSpy = vi.spyOn(AgentCore, "createRestrictedDeepAgent")
      .mockReturnValueOnce({ invoke: initialInvoke })
      .mockReturnValueOnce({ invoke: repairInvoke });
    const agent = createVisualComponentSubagent({
      diagnosticStage: "visual-analysis",
      diagnosticReporter: (event) => { diagnostics.push(event); },
    });

    await expect(review(agent)).resolves.toMatchObject({
      suggestions: completeSuggestions(),
      tokenUsage: { inputTokens: 180, outputTokens: 30, totalTokens: 210 },
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      diagnosticStage: "visual-analysis.semantic-repair",
      systemPrompt: expect.stringContaining("唯一一次语义纠正"),
    }));
    expect(initialInvoke).toHaveBeenCalledOnce();
    expect(repairInvoke).toHaveBeenCalledOnce();
    expect(repairInvoke.mock.calls[0]?.[0].messages).toHaveLength(3);
    expect(repairInvoke.mock.calls[0]?.[0].messages[2]?.content).toContain(
      '"validationCode":"VISUAL_SUGGESTION_MISSING"',
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        stage: "visual-analysis.semantic-validation",
        attempt: 1,
        status: "semantic-output-invalid",
        errorCode: "VISUAL_SUGGESTION_MISSING",
        retryable: true,
        validationRules: ["suggestions.cover-all-candidates"],
      }),
      expect.objectContaining({
        attempt: 2,
        status: "semantic-output-repaired",
        errorCode: "VISUAL_SUGGESTION_MISSING",
        validationRules: ["suggestions.cover-all-candidates"],
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("component:3:00700");
  });

  it("stops after one failed semantic repair and marks the final rule non-retryable", async () => {
    const diagnostics: AgentCore.ModelInvocationDiagnostic[] = [];
    const initialInvoke = vi.fn(async (_input: AgentCore.AgentInput) => ({
      response: "done",
      structuredResponse: createStructuredResponse([completeSuggestions()[0]]),
    }));
    const repairInvoke = vi.fn(async (_input: AgentCore.AgentInput) => ({
      response: "done",
      structuredResponse: createStructuredResponse([{
        candidateId: "component:unknown", confidence: 0.8, evidence: ["无法定位"],
      }]),
    }));
    vi.spyOn(AgentCore, "createRestrictedDeepAgent")
      .mockReturnValueOnce({ invoke: initialInvoke })
      .mockReturnValueOnce({ invoke: repairInvoke });
    const agent = createVisualComponentSubagent({
      diagnosticReporter: (event) => { diagnostics.push(event); },
    });

    await expect(review(agent)).rejects.toThrow("视觉 Subagent 纠正后仍未通过业务校验");

    expect(initialInvoke).toHaveBeenCalledOnce();
    expect(repairInvoke).toHaveBeenCalledOnce();
    expect(diagnostics.at(-1)).toMatchObject({
      stage: "visual-analysis.semantic-validation",
      attempt: 2,
      status: "semantic-output-invalid",
      errorCode: "VISUAL_SUGGESTION_UNKNOWN_CANDIDATE",
      retryable: false,
      validationRules: ["suggestions.candidate-known"],
    });
    expect(JSON.stringify(diagnostics)).not.toContain("component:unknown");
  });

  it("accepts semantic layout IDs when their source nodes are authoritative", async () => {
    const agent = createAgent(completeSuggestions(), [{
      id: "left-panel",
      sourceNodeIds: ["3:00669"],
      name: "左侧导航区",
      role: "navigation",
      relationship: "位于主内容左侧",
      evidence: ["整体图与结构节点一致"],
    }]);

    await expect(review(agent)).resolves.toMatchObject({
      designUnderstanding: { layout: { regions: [{ id: "left-panel", sourceNodeIds: ["3:00669"] }] } },
    });
  });

  it("normalizes omitted compatibility collections, directions, and nullable optional strings", async () => {
    const createSpy = vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockReturnValue({
      invoke: async () => ({ response: "done", structuredResponse: {
        suggestions: completeSuggestions().map((suggestion) => ({
          ...suggestion,
          suggestedTypeId: suggestion.candidateId === "component:3:00669"
            ? null
            : suggestion.suggestedTypeId,
        })),
        layout: {
          summary: "左右布局",
          regions: [{
            id: "left-panel",
            sourceNodeIds: ["3:00669"],
            name: "左侧导航区",
            role: "navigation",
            relationship: "位于主内容左侧",
            parentRegionId: null,
            evidence: ["整体图"],
          }],
          evidence: ["整体图"],
        },
      } }),
    });
    const agent = createVisualComponentSubagent({});

    await expect(review(agent)).resolves.toMatchObject({
      suggestions: [{ candidateId: "component:3:00669" }, { suggestedTypeId: "select" }],
      additionalCandidates: [],
      designUnderstanding: {
        layout: { regions: [{ id: "left-panel", direction: "unknown" }], warnings: [] },
        interactions: [],
        elements: [],
      },
    });
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      repairSchemaInvalidResponse: true,
      systemPrompt: expect.stringContaining("不可信数据"),
    }));
  });

  it("rejects semantic layout regions that reference unknown source nodes", async () => {
    const agent = createAgent(completeSuggestions(), [{
      id: "left-panel",
      sourceNodeIds: ["unknown-node"],
      name: "左侧导航区",
      role: "navigation",
      relationship: "位于主内容左侧",
      evidence: ["整体图"],
    }]);

    await expect(review(agent)).rejects.toThrow("返回了未知布局来源节点：unknown-node");
  });

  it("downgrades a missing semantic parent to a top-level region and omits blank optional text", async () => {
    const agent = createAgent(completeSuggestions(), [{
      id: "left-panel",
      sourceNodeIds: ["3:00669"],
      name: "左侧导航区",
      role: "navigation",
      relationship: "位于页面左侧",
      parentRegionId: "page",
      evidence: ["整体图"],
    }], [], [{
      id: "element:navigation",
      sourceNodeIds: ["3:00669"],
      regionId: "left-panel",
      kind: "text",
      name: "导航文本",
      text: "   ",
      textStatus: "none",
      implementation: "required",
      evidence: ["整体图"],
    }]);

    const result = await review(agent);

    expect(result.designUnderstanding.layout.regions[0]).toEqual(expect.not.objectContaining({
      parentRegionId: expect.anything(),
    }));
    expect(result.designUnderstanding.layout.warnings).toContain(
      "布局区域 left-panel 引用了未返回的父区域 page，已降级为顶层区域。",
    );
    expect(result.designUnderstanding.elements?.[0]).toEqual(expect.not.objectContaining({
      text: expect.anything(),
    }));
  });

  it("returns required visual states and promotes an uncovered high-confidence component", async () => {
    const agent = createAgent(completeSuggestions(), [{
      id: "bottom-tabs", sourceNodeIds: ["tabs-node"], name: "底部页签", role: "tab-navigation",
      relationship: "位于整个页面底部", direction: "row", evidence: ["整体图"],
    }], [{
      id: "visual:bottom-tabs", sourceNodeIds: ["tabs-node"], name: "底部页签",
      suggestedTypeId: "select", confidence: 0.9, evidence: ["四个并列标签"],
    }], [{
      id: "element:bottom-tabs", sourceNodeIds: ["tabs-node"], regionId: "bottom-tabs",
      kind: "tabs", name: "底部页签", text: "tab1", textStatus: "exact",
      states: ["active"], implementation: "required", componentCandidateId: "visual:bottom-tabs",
      evidence: ["整体图底部"],
    }]);

    await expect(review(agent, {
      roots: [{ id: "tabs-node", name: "Tabs", kind: "container", children: [] }], truncated: false,
    })).resolves.toMatchObject({
      additionalCandidates: [{ id: "visual:bottom-tabs" }],
      designUnderstanding: { elements: [{ id: "element:bottom-tabs", states: ["active"] }] },
    });
  });
});

/** 使用固定结构化模型结果创建被测视觉 Agent。 */
function createAgent(
  suggestions: unknown[],
  regions: unknown[] = [],
  additionalCandidates: unknown[] = [],
  elements: unknown[] = [],
) {
  vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockReturnValue({
    invoke: async () => ({
      response: "done",
      structuredResponse: createStructuredResponse(suggestions, regions, additionalCandidates, elements),
    }),
  });
  return createVisualComponentSubagent({});
}

/** 创建可按用例覆盖候选、布局和元素集合的完整视觉响应。 */
function createStructuredResponse(
  suggestions: unknown[],
  regions: unknown[] = [],
  additionalCandidates: unknown[] = [],
  elements: unknown[] = [],
) {
  return {
    suggestions,
    additionalCandidates,
    layout: {
      summary: "左右布局",
      regions: regions.map((region) => ({ ...(region as object), direction: "unknown" })),
      evidence: ["整体图"],
      warnings: [],
    },
    interactions: [],
    elements,
  };
}

/** 返回覆盖全部权威候选的最小视觉建议。 */
function completeSuggestions() {
  return [{
    candidateId: "component:3:00669", suggestedTypeId: "navigation", confidence: 0.9, evidence: ["菜单"],
  }, {
    candidateId: "component:3:00700", suggestedTypeId: "select", confidence: 0.8, evidence: ["下拉"],
  }];
}

/** 使用最小受控图片证据执行一次视觉复核。 */
function review(
  agent: ReturnType<typeof createVisualComponentSubagent>,
  structure?: Parameters<ReturnType<typeof createVisualComponentSubagent>["review"]>[0]["structure"],
) {
  return agent.review({
    taskId: "task-1",
    recognition,
    catalog,
    images: [{ label: "整体图", dataUrl: "data:image/png;base64,aGVsbG8=" }],
    ...(structure ? { structure } : {}),
  });
}
