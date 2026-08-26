/** 验证主 Plan Agent 通过唯一工具委派视觉 Subagent 并生成审阅型方案。 */

import { AgentCore } from "@ui-forge/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import { createPlanDeepAgent } from "./planDeepAgent.js";
import type { SecondStepProgressEvent } from "./secondStepProgress.js";

const catalog: ComponentCatalog = { components: [
  { id: "navigation", name: "Navigation", aliases: ["导航"], implementation: { packageName: "antd", exportName: "Menu" } },
  { id: "select", name: "Select", aliases: ["选择"], implementation: { packageName: "antd", exportName: "Select" } },
  { id: "tabs", name: "Tabs", aliases: ["页签"], implementation: { packageName: "antd", exportName: "Tabs" } },
] };
const inspection = {
  context: { source: { provider: "mastergo", reference: "design" }, name: "客户列表", nodeCount: 2, tokens: {}, regions: [], warnings: [] },
  provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
};
const projectInspection = { kind: "react_antd" as const, projectRoot: "/workspace", packageJsonPath: "/workspace/package.json" };
const projectContext = { kind: "react_antd" as const, files: [], filesComplete: true, matches: [], warnings: [] };
const designUnderstanding = {
  layout: { summary: "上下布局", regions: [], evidence: ["整体图"], warnings: [] },
  interactions: [],
};
const recognition: DesignComponentRecognition = {
  status: "recognized",
  components: [{
    id: "component:1", name: "导航栏", sourceNodeIds: ["1"], instanceCount: 1,
    evidence: ["来源组件"], evidenceStrength: "explicit",
    typeHint: { typeId: "navigation", matchedAlias: "导航" },
  }, {
    id: "component:2", name: "业务选择器", sourceNodeIds: ["2"], instanceCount: 1,
    evidence: ["来源组件"], evidenceStrength: "explicit",
  }],
  warnings: [],
};

describe("createPlanDeepAgent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delegates images and lets the main agent publish final decisions and a plan", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [{ candidateId: "component:1", suggestedTypeId: "navigation", confidence: 0.96, evidence: ["菜单排列"] },
        { candidateId: "component:2", suggestedTypeId: "select", confidence: 0.87, evidence: ["下拉箭头"] }],
      designUnderstanding,
      tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        expect(options).not.toHaveProperty("responseSchema");
        expect(options?.systemPrompt).toContain("不可信数据");
        await executePlanSubmission(options, input, createResponse());
        return {
          response: "done",
          usage: { inputTokens: 200, outputTokens: 40, totalTokens: 240 },
        };
      },
    }));
    const progress: SecondStepProgressEvent[] = [];
    const agent = createPlanDeepAgent({
      create: async () => ({ images: [{ label: "整体图", dataUrl: "data:image/png;base64,aGVsbG8=" }], warnings: [] }),
    }, catalog, {}, visualSubagent);

    const result = await agent.plan({
      taskId: "task-1", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext,
      reportProgress: (event) => { progress.push(event); },
    });

    expect(visualSubagent.review).toHaveBeenCalledOnce();
    expect(result.componentRecognition.components[1]).toMatchObject({
      effectiveTypeId: "select", resolvedBy: "model",
      visualSuggestion: { suggestedTypeId: "select" },
    });
    expect(result.plan.status).toBe("reviewable");
    expect(progress.map((event) => event.type)).toEqual([
      "planning-start", "visual-review-start", "visual-review-complete", "planning-complete",
    ]);
  });

  it("requires official MCP evidence before accepting an Ant Design catalog reuse", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    const queryComponent = vi.fn(async () => [{
      toolName: "antd_info",
      componentName: "Select",
      data: { name: "Select", props: [] },
    }]);
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        const query = await requireTool(tools, "inspect_antd_component").execute({
          catalogComponentId: "select",
          sections: ["semantic"],
        });
        expect(query).toMatchObject({ ok: true, catalogComponentId: "select" });
        await requireTool(tools, "submit_plan").execute(createResponse());
        return { response: "done" };
      },
    }));
    const progress: SecondStepProgressEvent[] = [];
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent, {
      resolveCatalog: async ({ baseCatalog }) => ({ catalog: baseCatalog, warnings: [] }),
      queryComponent,
    });

    await expect(agent.plan({
      taskId: "task-antd-mcp", taskGoal: "实现客户列表", inspection, projectInspection,
      recognition, projectContext, reportProgress: (event) => { progress.push(event); },
    })).resolves.toMatchObject({ plan: { status: "reviewable" } });

    expect(queryComponent).toHaveBeenCalledWith(expect.objectContaining({
      componentName: "Select",
      sections: ["info", "semantic"],
    }));
    expect(progress.map((event) => event.type)).toContain("design-system-query-complete");
  });

  it("rejects catalog reuse when the model skips the configured Ant Design MCP", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        await executePlanSubmission(options, input, createResponse());
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent, {
      resolveCatalog: async ({ baseCatalog }) => ({ catalog: baseCatalog, warnings: [] }),
      queryComponent: async () => [],
    });

    await expect(agent.plan({
      taskId: "task-antd-mcp-missing", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).rejects.toThrow("Ant Design 目录复用缺少 MCP 查询证据：select");
  });

  it("propagates cancellation from an Ant Design MCP query", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        await requireTool(tools, "inspect_antd_component").execute({
          catalogComponentId: "select",
          sections: ["info"],
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent, {
      resolveCatalog: async ({ baseCatalog }) => ({ catalog: baseCatalog, warnings: [] }),
      queryComponent: async () => { throw new DOMException("cancelled", "AbortError"); },
    });

    await expect(agent.plan({
      taskId: "task-antd-mcp-cancel", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps planning honest when images are unavailable", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          decisions: [response.decisions[0], {
            candidateId: "component:2", resolvedBy: "unresolved", reason: "没有图片证据",
          }],
          plan: {
            ...response.plan,
            componentDecisions: response.plan.componentDecisions.map((decision) => decision.candidateId === "component:2"
              ? {
                  candidateId: decision.candidateId,
                  action: "unresolved" as const,
                  source: "unresolved" as const,
                  reason: "没有图片证据",
                  evidence: ["视觉证据不可用"],
              }
              : decision),
            steps: response.plan.steps
              .filter((step) => step.targetId !== "component:2")
              .map((step) => step.kind === "validation"
                ? { ...step, dependsOn: step.dependsOn.filter((dependency) => dependency !== "step-component-1") }
                : step),
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    const result = await agent.plan({ taskId: "task-2", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext });

    expect(result.componentRecognition.components[1]).toMatchObject({ resolvedBy: "unresolved" });
    expect(result.componentRecognition.warnings[0]).toContain("未配置设计图片证据");
  });

  it("shares one visual review across concurrent and sequential repeated tool calls", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      designUnderstanding,
    })) };
    const visualEvidenceProvider = {
      create: vi.fn(async () => ({
        images: [{ label: "整体图", dataUrl: "data:image/png;base64,aGVsbG8=" }],
        warnings: [],
      })),
    };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        const visualTool = requireTool(tools, "review_visual_components");
        const [first, second] = await Promise.all([visualTool.execute({}), visualTool.execute({})]);
        const third = await visualTool.execute({});
        expect(first).toMatchObject({ cached: false, suggestions: [] });
        expect(second).toMatchObject({ cached: true });
        expect(third).toMatchObject({ cached: true });
        await requireTool(tools, "submit_plan").execute(createResponse());
        return { response: "done" };
      },
    }));
    const progress: SecondStepProgressEvent[] = [];
    const agent = createPlanDeepAgent(visualEvidenceProvider, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-repeated-visual", taskGoal: "实现客户列表", inspection, projectInspection,
      recognition, projectContext, reportProgress: (event) => { progress.push(event); },
    })).resolves.toMatchObject({ plan: { status: "reviewable" } });

    expect(visualEvidenceProvider.create).toHaveBeenCalledOnce();
    expect(visualSubagent.review).toHaveBeenCalledOnce();
    expect(progress.filter((event) => event.type === "visual-review-start")).toHaveLength(1);
    expect(progress.filter((event) => event.type === "visual-review-complete")).toHaveLength(1);
  });

  it("rejects a main-agent response that bypasses the visual Subagent", async () => {
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockReturnValue({
      invoke: async () => ({ response: "done" }),
    });
    const agent = createPlanDeepAgent(undefined, catalog, {}, { review: async () => ({ suggestions: [], designUnderstanding }) });

    await expect(agent.plan({
      taskId: "task-3", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext,
    })).rejects.toThrow("必须先调用视觉 Subagent");
  });

  it("rejects a plan without any reviewable implementation step", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, { ...response, plan: { ...response.plan, steps: [] } });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-4", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext,
    })).rejects.toThrow();
  });

  it("requires initialization only for an empty target project", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            fileImpacts: ["package.json", "index.html", "tsconfig.json", "src/main.tsx"].map((path) => ({
              path, action: "create" as const, reason: "初始化 Vite React TypeScript 工程",
              affectedSymbols: [], downstreamConsumers: [], risk: "low" as const,
              evidence: ["目标目录为空"],
            })),
            steps: [{
              id: "step-initialize", kind: "initialize", targetId: "vite-react-ts", title: "初始化项目",
              description: "使用 Vite 创建 React + TypeScript + Ant Design 工程。", decision: "create", dependsOn: [],
              files: ["package.json", "index.html", "tsconfig.json", "src/main.tsx"].map((path) => ({ path, action: "create" as const })),
              designElementIds: [],
              evidence: ["目标目录为空"], acceptanceCriteria: ["项目初始化范围明确"], risks: [],
            }, ...response.plan.steps.map((step) => ({
              ...step,
              dependsOn: step.kind === "layout" ? ["step-initialize"] : step.dependsOn,
            }))],
            files: ["package.json", "index.html", "tsconfig.json", "src/main.tsx"],
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);
    const result = await agent.plan({
      taskId: "task-empty", taskGoal: "实现客户列表", inspection,
      projectInspection: { kind: "empty", projectRoot: "/workspace" }, recognition,
      projectContext: { kind: "empty", files: [], filesComplete: true, matches: [], warnings: [] },
    });
    expect(result.plan.steps[0]?.kind).toBe("initialize");
    expect(result.plan.componentDecisions[1]).toMatchObject({
      source: "catalog", catalogComponentId: "select", action: "reuse-configured",
    });
  });

  it("accepts a repository component only when it is matched to the same design candidate", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            componentDecisions: response.plan.componentDecisions.map((decision) => decision.candidateId === "component:1"
              ? {
                  candidateId: decision.candidateId,
                  action: "reuse-directly" as const,
                  source: "repository" as const,
                  repositoryComponentId: "src/Navigation.tsx#Navigation",
                  reason: "仓库检索命中",
                  evidence: ["名称与组合结构匹配"],
                }
              : decision),
            steps: response.plan.steps.map((step) => step.targetId === "component:1"
              ? { ...step, decision: "reuse" as const }
              : step),
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);
    const result = await agent.plan({
      taskId: "task-repository", taskGoal: "实现客户列表", inspection, projectInspection, recognition,
      projectContext: {
        ...projectContext,
        matches: [{
          designCandidateId: "component:1",
          component: {
            id: "src/Navigation.tsx#Navigation", name: "Navigation", sourcePath: "src/Navigation.tsx",
            exportName: "Navigation", props: [], composition: ["Menu"], styleFiles: [], tokens: [], consumers: [],
          },
          score: 0.9,
          matchedBy: ["name" as const],
        }],
      },
    });

    expect(result.plan.componentDecisions[0]).toMatchObject({
      source: "repository", repositoryComponentId: "src/Navigation.tsx#Navigation",
    });
  });

  it("normalizes unique consumer shorthand before validating file impacts", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            fileImpacts: [{
              path: "src/components/Table.tsx",
              action: "modify" as const,
              reason: "调整表格布局",
              affectedSymbols: ["Table"],
              downstreamConsumers: ["App.tsx", "router"],
              risk: "medium" as const,
              evidence: ["仓库文件清单"],
            }],
            steps: response.plan.steps.map((step, index) => index === 0
              ? { ...step, files: [{ path: "src/components/Table.tsx", action: "modify" as const }] }
              : step),
            files: ["src/components/Table.tsx"],
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    const result = await agent.plan({
      taskId: "task-consumer-paths", taskGoal: "实现客户列表", inspection, projectInspection, recognition,
      projectContext: {
        ...projectContext,
        files: ["src/App.tsx", "src/router/index.tsx", "src/components/Table.tsx"],
      },
    });

    expect(result.plan.fileImpacts[0]?.downstreamConsumers).toEqual([
      "src/App.tsx", "src/router/index.tsx",
    ]);
  });

  it("keeps a reviewable plan when a new component file was mislabeled as modify", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            fileImpacts: [{
              path: "src/components/NavigationTree.tsx",
              action: "modify" as const,
              reason: "实现设计中的左侧导航树",
              affectedSymbols: ["NavigationTree"],
              downstreamConsumers: [],
              risk: "low" as const,
              evidence: ["视觉区域 left-panel"],
            }],
            steps: response.plan.steps.map((step) => step.targetId === "component:1"
              ? {
                  ...step,
                  decision: "create" as const,
                  files: [{ path: "src/components/NavigationTree.tsx", action: "modify" as const }],
                }
              : step),
            files: ["src/components/NavigationTree.tsx"],
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    const result = await agent.plan({
      taskId: "task-new-navigation", taskGoal: "实现客户列表", inspection, projectInspection,
      recognition, projectContext,
    });

    expect(result.plan.fileImpacts[0]).toMatchObject({
      path: "src/components/NavigationTree.tsx",
      action: "create",
    });
    expect(result.plan.steps.find((step) => step.targetId === "component:1")?.files[0])
      .toEqual({ path: "src/components/NavigationTree.tsx", action: "create" });
  });

  it("rejects catalog and repository identifiers that are mixed across sources", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            componentDecisions: response.plan.componentDecisions.map((decision) => decision.candidateId === "component:2"
              ? { ...decision, repositoryComponentId: "component:2" }
              : decision),
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-mixed-source", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext,
    })).rejects.toThrow("无效的目录组件");
  });

  it("rejects a reviewable plan that omits an inferred interaction", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      designUnderstanding: {
        ...designUnderstanding,
        interactions: [{
          id: "interaction-search", triggerNodeIds: ["2"], trigger: "submit" as const,
          expectedEffect: "提交搜索条件", confidence: 0.8, evidence: ["搜索输入和按钮"], status: "inferred" as const,
        }],
      },
    })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        await executePlanSubmission(options, input, createResponse());
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);
    await expect(agent.plan({
      taskId: "task-interaction", taskGoal: "实现客户列表", inspection, projectInspection, recognition, projectContext,
    })).rejects.toThrow("遗漏了已识别交互");
  });

  it("rejects a layout region used as a component candidate and accepts a corrected resubmission", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      designUnderstanding: {
        ...designUnderstanding,
        layout: {
          ...designUnderstanding.layout,
          regions: [{
            id: "bottom-tabs", sourceNodeIds: ["3"], name: "底部页签", role: "footer",
            relationship: "位于主内容下方", evidence: ["整体图底部区域"],
          }],
        },
      },
    })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        const invalid = createResponse();
        const rejected = await requireTool(tools, "submit_plan").execute({
          ...invalid,
          plan: {
            ...invalid.plan,
            componentDecisions: [{
              candidateId: "bottom-tabs", action: "create-new", source: "new",
              reason: "误把布局区域当成组件", evidence: ["底部区域"],
            }, ...invalid.plan.componentDecisions.slice(1)],
          },
        });
        expect(rejected).toMatchObject({
          accepted: false,
          error: "方案返回了无效组件复用决策：bottom-tabs",
          allowedCandidateIds: ["component:1", "component:2"],
          layoutRegionIds: ["bottom-tabs"],
        });
        await requireTool(tools, "submit_plan").execute(createResponse());
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-layout-component-id", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).resolves.toMatchObject({ plan: { status: "reviewable" } });

    expect(visualSubagent.review).toHaveBeenCalledOnce();
  });

  it("rejects cross-kind target ID collisions before accepting the Plan pause point", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        const response = createResponse();
        const invalid = {
          ...response,
          plan: {
            ...response.plan,
            steps: response.plan.steps.map((step) => step.kind === "layout"
              ? { ...step, targetId: "component:1" }
              : step),
          },
        };
        await expect(requireTool(tools, "submit_plan").execute(invalid)).resolves.toMatchObject({
          accepted: false,
          error: "方案意图目标 ID 在 layout 与 component 间重复：component:1",
        });
        await requireTool(tools, "submit_plan").execute(response);
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-intent-target-collision",
      taskGoal: "实现客户列表",
      inspection,
      projectInspection,
      recognition,
      projectContext,
    })).resolves.toMatchObject({ plan: { status: "reviewable" } });

    expect(visualSubagent.review).toHaveBeenCalledOnce();
  });

  it("promotes an uncovered visual component into a formal decision and atomic component step", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      additionalCandidates: [{
        id: "visual:bottom-tabs", sourceNodeIds: ["3"], name: "底部页签",
        suggestedTypeId: "tabs", confidence: 0.95, evidence: ["页面底部四个并列标签"],
      }],
      designUnderstanding: {
        layout: { summary: "上下布局", regions: [{
          id: "bottom-tabs", sourceNodeIds: ["3"], name: "底部页签", role: "tab-navigation",
          relationship: "位于整个页面底部", direction: "row" as const, evidence: ["整体图"],
        }], evidence: ["整体图"], warnings: [] },
        interactions: [],
        elements: [{
          id: "element:bottom-tabs", sourceNodeIds: ["3"], regionId: "bottom-tabs", kind: "tabs" as const,
          name: "底部页签", textStatus: "uncertain" as const, states: ["active" as const],
          implementation: "required" as const, componentCandidateId: "visual:bottom-tabs", evidence: ["整体图"],
        }],
      },
    })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        const response = createResponse();
        const validation = response.plan.steps.at(-1)!;
        const submitted = await requireTool(tools, "submit_plan").execute({
          ...response,
          decisions: [...response.decisions, {
            candidateId: "visual:bottom-tabs", effectiveTypeId: "tabs", resolvedBy: "model", reason: "视觉证据明确",
          }],
          plan: {
            ...response.plan,
            reusableComponents: [...response.plan.reusableComponents, {
              typeId: "tabs", name: "Tabs", description: "使用 Ant Design Tabs",
            }],
            componentDecisions: [...response.plan.componentDecisions, {
              candidateId: "visual:bottom-tabs", action: "reuse-configured", source: "catalog",
              catalogComponentId: "tabs", reason: "目录提供 Tabs", evidence: ["视觉补充候选"],
            }],
            steps: [...response.plan.steps.slice(0, -1), {
              id: "step-bottom-tabs", kind: "component", targetId: "visual:bottom-tabs", title: "实现底部页签",
              description: "配置 Tabs", decision: "configure", dependsOn: ["step-layout"], files: [],
              designElementIds: ["element:bottom-tabs"], evidence: ["整体图"], acceptanceCriteria: ["页签位于页面底部"], risks: [],
            }, { ...validation, dependsOn: [...validation.dependsOn, "step-bottom-tabs"] }],
          },
        });
        expect(submitted).toMatchObject({ accepted: true });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    const result = await agent.plan({
      taskId: "task-promoted-tabs", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    });

    expect(result.componentRecognition.components).toContainEqual(expect.objectContaining({ id: "visual:bottom-tabs" }));
    expect(result.plan.steps).toContainEqual(expect.objectContaining({
      kind: "component", targetId: "visual:bottom-tabs", designElementIds: ["element:bottom-tabs"],
    }));
  });

  it("supplements repository matches for a visual-only component candidate", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      additionalCandidates: [{
        id: "visual:bottom-tabs", sourceNodeIds: ["3"], name: "BottomTabs",
        suggestedTypeId: "tabs", confidence: 0.95, evidence: ["底部页签清晰可见"],
      }],
      designUnderstanding: {
        layout: { summary: "上下布局", regions: [], evidence: ["整体图"], warnings: [] },
        interactions: [], elements: [],
      },
    })) };
    const analyze = vi.fn(async ({ recognition: analyzedRecognition }) => ({
      kind: "react_antd" as const,
      files: ["src/BottomTabs.tsx"],
      filesComplete: true,
      matches: [{
        designCandidateId: analyzedRecognition.components[0]!.id,
        component: {
          id: "src/BottomTabs.tsx#BottomTabs", name: "BottomTabs", sourcePath: "src/BottomTabs.tsx",
          exportName: "BottomTabs", props: [], composition: ["Tabs"], styleFiles: [], tokens: [], consumers: [],
        },
        score: 1,
        matchedBy: ["name" as const],
      }],
      warnings: [],
    }));
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        const visualReview = await requireTool(tools, "review_visual_components").execute({});
        expect(visualReview).toMatchObject({
          supplementalRepositoryMatches: [{
            designCandidateId: "visual:bottom-tabs",
            component: { id: "src/BottomTabs.tsx#BottomTabs" },
          }],
        });
        const response = createResponse();
        const validation = response.plan.steps.at(-1)!;
        const submitted = await requireTool(tools, "submit_plan").execute({
          ...response,
          decisions: [...response.decisions, {
            candidateId: "visual:bottom-tabs", effectiveTypeId: "tabs", resolvedBy: "model", reason: "视觉证据明确",
          }],
          plan: {
            ...response.plan,
            componentDecisions: [...response.plan.componentDecisions, {
              candidateId: "visual:bottom-tabs", action: "reuse-directly", source: "repository",
              repositoryComponentId: "src/BottomTabs.tsx#BottomTabs", reason: "仓库存在同名组件", evidence: ["增量检索"],
            }],
            steps: [...response.plan.steps.slice(0, -1), {
              id: "step-bottom-tabs", kind: "component", targetId: "visual:bottom-tabs", title: "复用底部页签",
              description: "直接复用仓库组件", decision: "reuse", dependsOn: ["step-layout"], files: [],
              designElementIds: [], evidence: ["增量检索"], acceptanceCriteria: ["页签正确展示"], risks: [],
            }, { ...validation, dependsOn: [...validation.dependsOn, "step-bottom-tabs"] }],
          },
        });
        expect(submitted).toMatchObject({ accepted: true });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(
      undefined,
      catalog,
      {},
      visualSubagent,
      undefined,
      { analyze },
    );

    const result = await agent.plan({
      taskId: "task-visual-repository", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      recognition: expect.objectContaining({
        components: [expect.objectContaining({ id: "visual:bottom-tabs" })],
      }),
    }));
    expect(result.plan.componentDecisions).toContainEqual(expect.objectContaining({
      candidateId: "visual:bottom-tabs", source: "repository",
    }));
  });

  it("rejects a step file omitted from the file impact review", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            steps: response.plan.steps.map((step, index) => index === 0
              ? { ...step, files: [{ path: "src/Hidden.tsx", action: "create" as const }] }
              : step),
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-hidden-step-file", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).rejects.toThrow("实施步骤文件缺少对应影响记录：src/Hidden.tsx");
  });

  it("rejects an impacted file that no implementation step references", async () => {
    const visualSubagent = { review: vi.fn(async () => ({ suggestions: [], designUnderstanding })) };
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const response = createResponse();
        await executePlanSubmission(options, input, {
          ...response,
          plan: {
            ...response.plan,
            fileImpacts: [{
              path: "src/Orphan.tsx", action: "create", reason: "孤立影响",
              affectedSymbols: [], downstreamConsumers: [], risk: "low", evidence: ["模型提交"],
            }],
            files: ["src/Orphan.tsx"],
          },
        });
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-orphan-impact", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).rejects.toThrow("文件影响没有对应实施步骤：src/Orphan.tsx");
  });

  it("returns all missing required visual elements in one rejected submission", async () => {
    const visualSubagent = { review: vi.fn(async () => ({
      suggestions: [],
      designUnderstanding: {
        ...designUnderstanding,
        elements: ["left-search", "validation-feedback"].map((id, index) => ({
          id, sourceNodeIds: [String(index + 1)], regionId: "page", kind: index === 0 ? "input" as const : "feedback" as const,
          name: id, textStatus: "none" as const, states: index === 0 ? ["default" as const] : ["warning" as const],
          implementation: "required" as const, evidence: ["整体图"],
        })),
      },
    })) };
    let rejection: unknown;
    vi.spyOn(AgentCore, "createRestrictedDeepAgent").mockImplementation((options) => ({
      invoke: async (input) => {
        const tools = createInvocationTools(options, input);
        await requireTool(tools, "review_visual_components").execute({});
        rejection = await requireTool(tools, "submit_plan").execute(createResponse());
        return { response: "done" };
      },
    }));
    const agent = createPlanDeepAgent(undefined, catalog, {}, visualSubagent);

    await expect(agent.plan({
      taskId: "task-all-coverage-errors", taskGoal: "实现客户列表", inspection,
      projectInspection, recognition, projectContext,
    })).rejects.toThrow("遗漏了必须实现的视觉元素");

    expect(rejection).toMatchObject({
      accepted: false,
      errors: [
        "方案遗漏了必须实现的视觉元素：left-search",
        "方案遗漏了必须实现的视觉元素：validation-feedback",
      ],
    });
  });
});

/** 创建一次模型调用可见的全部任务绑定工具。 */
function createInvocationTools(
  options: AgentCore.ModelAgentOptions | undefined,
  input: AgentCore.AgentInput,
): readonly AgentCore.AgentTool[] {
  return options?.toolFactories?.flatMap((factory) => factory.create(input.context)) ?? [];
}

/** 从测试调用上下文中读取指定受控工具。 */
function requireTool(tools: readonly AgentCore.AgentTool[], name: string): AgentCore.AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`缺少测试工具：${name}`);
  return tool;
}

/** 模拟主 Agent 先读取视觉结果，再通过受控工具提交方案。 */
async function executePlanSubmission(
  options: AgentCore.ModelAgentOptions | undefined,
  input: AgentCore.AgentInput,
  response: unknown,
): Promise<unknown> {
  const tools = createInvocationTools(options, input);
  await requireTool(tools, "review_visual_components").execute({});
  return requireTool(tools, "submit_plan").execute(response);
}

function createResponse() {
  return {
    decisions: [
      { candidateId: "component:1", effectiveTypeId: "navigation", resolvedBy: "catalog" as const, reason: "目录与视觉一致" },
      { candidateId: "component:2", effectiveTypeId: "select", resolvedBy: "model" as const, reason: "视觉证据明确" },
    ],
    plan: {
      status: "reviewable" as const,
      summary: "实现客户列表结构",
      reusableComponents: [{ typeId: "select", name: "Select", description: "使用目录中的 Ant Design 映射" }],
      newComponents: [],
      componentDecisions: recognition.components.map((component) => component.id === "component:2"
        ? {
            candidateId: component.id,
            action: "reuse-configured" as const,
            source: "catalog" as const,
            catalogComponentId: "select",
            reason: "目录提供 Ant Design 实现映射",
            evidence: ["select implementation=antd.Select"],
          }
        : {
            candidateId: component.id,
            action: "create-new" as const,
            source: "new" as const,
            reason: "仓库没有匹配证据",
            evidence: ["仓库候选为空"],
          }),
      fileImpacts: [],
      steps: [{
        id: "step-layout", kind: "layout" as const, targetId: "page-layout", title: "建立页面布局", description: "按设计搭建外部容器",
        decision: "create" as const, dependsOn: [], files: [], designElementIds: [], evidence: ["整体图"], acceptanceCriteria: ["布局可审阅"], risks: [],
      }, ...recognition.components.map((component, index) => ({
        id: `step-component-${index}`, kind: "component" as const, targetId: component.id, title: `实现${component.name}`, description: "实现单个组件",
        decision: component.id === "component:2" ? "configure" as const : "create" as const,
        dependsOn: ["step-layout"], files: [], designElementIds: [], evidence: component.evidence, acceptanceCriteria: ["组件结构可审阅"], risks: [],
      })), {
        id: "step-validation", kind: "validation" as const, targetId: "final-validation", title: "验证方案", description: "验证类型与视觉结果",
        decision: "validate" as const, dependsOn: recognition.components.map((_component, index) => `step-component-${index}`), files: [], designElementIds: [], evidence: ["计划约束"], acceptanceCriteria: ["验证范围明确"], risks: [],
      }],
      files: [],
      contextGaps: ["尚未读取仓库组件索引和文件清单"],
      stopConditions: ["不得在用户批准 Patch 前写入文件"],
    },
  };
}
