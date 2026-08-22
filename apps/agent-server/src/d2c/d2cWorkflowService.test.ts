/** 验证第二步内部项目与组件结果会在后续 subagent 完成前实时投影。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { d2cWorkflowMethods } from "@ui-forge/shared-protocol";
import { describe, expect, it } from "vitest";
import { D2CWorkflowService } from "./d2cWorkflowService.js";

const reviewablePlan = {
  status: "reviewable" as const,
  summary: "审阅方案",
  designUnderstanding: {
    layout: { summary: "页面布局", regions: [], evidence: ["设计结构"], warnings: [] },
    interactions: [],
  },
  reusableComponents: [],
  newComponents: [],
  componentDecisions: [],
  fileImpacts: [],
  steps: [{
    id: "step-1", kind: "layout" as const, targetId: "page-layout", title: "实现", description: "实现页面",
    decision: "create" as const, dependsOn: [], files: [], evidence: ["设计结构"], acceptanceCriteria: ["可审阅"], risks: [],
  }],
  files: [],
  contextGaps: ["缺少仓库文件证据"],
  stopConditions: ["不得直接写入"],
};

describe("D2CWorkflowService stream", () => {
  it("publishes project validation before component analysis finishes", async () => {
    let releaseComponentAnalysis = (): void => undefined;
    const componentGate = new Promise<void>((resolve) => {
      releaseComponentAnalysis = resolve;
    });
    const taskId = "11111111-1111-4111-8111-111111111111";
    const projectInspection = { kind: "empty" as const, projectRoot: "/workspace" };
    const componentRecognition = {
      status: "recognized" as const,
      components: [],
      warnings: [],
    };
    const task: D2CAgent.Task = {
      taskId,
      workspaceId: "workspace-1",
      revision: 2,
      status: "svg_ready",
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
      projectInspection,
      componentRecognition,
    };
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      reset: async () => task,
      analyzeSecondStep: async (_command, reportProgress) => {
        await reportProgress?.({ type: "project-inspection-start" });
        await reportProgress?.({
          type: "project-inspection-complete",
          inspection: projectInspection,
          durationMs: 12,
        });
        await componentGate;
        await reportProgress?.({ type: "component-recognition-start" });
        await reportProgress?.({
          type: "component-recognition-complete",
          recognition: componentRecognition,
          unknownCount: 0,
          durationMs: 4,
        });
        return task;
      },
    };
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });
    const iterator = workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId,
      expectedRevision: 1,
    })[Symbol.asyncIterator]();
    const earlyEvents = [];

    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error("项目结果返回前流已结束。");
      earlyEvents.push(next.value);
      if (next.value.type === "project-validation") break;
    }

    expect(earlyEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool-start", toolName: "inspect_project" }),
      expect.objectContaining({
        type: "tool-complete",
        outcome: "warning",
        metrics: { durationMs: 12 },
      }),
      expect.objectContaining({ type: "project-validation" }),
    ]));
    releaseComponentAnalysis();
    const remainingEvents = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remainingEvents.push(next.value);
    }
    expect(remainingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool-start", toolName: "recognize_design_components" }),
      expect.objectContaining({ type: "design-component-result" }),
      expect.objectContaining({ type: "message-complete" }),
    ]));
  });

  it("aborts the active DeepAgent run and emits a stopped terminal event", async () => {
    const taskId = "22222222-2222-4222-8222-222222222222";
    const task: D2CAgent.Task = {
      taskId,
      workspaceId: "workspace-1",
      revision: 1,
      status: "svg_ready",
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
    };
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      reset: async () => task,
      analyzeSecondStep: async (_command, reportProgress, signal) => {
        await reportProgress?.({ type: "planning-start" });
        await reportProgress?.({ type: "visual-review-start", candidateCount: 1 });
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("用户终止。", "AbortError"));
          }, { once: true });
        });
        return task;
      },
    };
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });
    const iterator = workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId,
      expectedRevision: 1,
    })[Symbol.asyncIterator]();
    const events = [];

    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error("终止前流已结束。");
      events.push(next.value);
      if (next.value.type === "tool-start") break;
    }
    await expect(workflow.handle(d2cWorkflowMethods.cancelConversation, { taskId }))
      .resolves.toEqual({ cancelled: true });
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool-complete", outcome: "warning" }),
      expect.objectContaining({ type: "message-stopped" }),
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message-complete" }),
    ]));
  });

  it("propagates an external transport abort to the active analysis", async () => {
    const taskId = "22222222-2222-4222-8222-333333333333";
    const task: D2CAgent.Task = {
      taskId,
      workspaceId: "workspace-1",
      revision: 1,
      status: "svg_ready",
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
    };
    let analysisSignal: AbortSignal | undefined;
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      reset: async () => task,
      analyzeSecondStep: async (_command, reportProgress, signal) => {
        analysisSignal = signal;
        await reportProgress?.({ type: "planning-start" });
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(
            new DOMException("传输连接已关闭。", "AbortError"),
          ), { once: true });
        });
        return task;
      },
    };
    const transportController = new AbortController();
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });
    const iterator = workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId,
      expectedRevision: 1,
    }, transportController.signal)[Symbol.asyncIterator]();
    const events = [];

    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new Error("传输终止前流已结束。");
      events.push(next.value);
      if (next.value.type === "plan-start") break;
    }
    transportController.abort();
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(analysisSignal?.aborted).toBe(true);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message-stopped" }),
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message-complete" }),
    ]));
  });

  it("publishes visual suggestions before the main Agent final decision and plan", async () => {
    const taskId = "33333333-3333-4333-8333-333333333333";
    const projectInspection = { kind: "empty" as const, projectRoot: "/workspace" };
    const deterministicRecognition = {
      status: "recognized" as const,
      components: [{
        id: "component:component-1",
        name: "业务组件",
        instanceCount: 1,
        sourceNodeIds: ["node-1"],
        evidence: ["确定性规则无法确认类型"],
        evidenceStrength: "weak" as const,
      }],
      warnings: [],
    };
    const task: D2CAgent.Task = {
      taskId,
      workspaceId: "workspace-1",
      revision: 2,
      status: "svg_ready",
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
      projectInspection,
      componentRecognition: deterministicRecognition,
    };
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      reset: async () => task,
      analyzeSecondStep: async (_command, reportProgress) => {
        await reportProgress?.({ type: "project-inspection-start" });
        await reportProgress?.({ type: "project-inspection-complete", inspection: projectInspection });
        await reportProgress?.({ type: "design-system-catalog-start" });
        await reportProgress?.({
          type: "design-system-catalog-complete",
          componentCount: 73,
          warnings: [],
          durationMs: 18,
        });
        await reportProgress?.({ type: "component-recognition-start" });
        await reportProgress?.({
          type: "component-recognition-complete",
          recognition: deterministicRecognition,
          unknownCount: 1,
        });
        await reportProgress?.({ type: "planning-start" });
        await reportProgress?.({ type: "visual-review-start", candidateCount: 1 });
        const finalRecognition = {
          ...deterministicRecognition,
          components: deterministicRecognition.components.map((component) => ({
            ...component,
            visualSuggestion: {
              suggestedTypeId: "select",
              confidence: 0.82,
              evidence: ["图片中存在输入区域和下拉箭头"],
            },
            effectiveTypeId: "select",
            resolvedBy: "model" as const,
            resolutionReason: "视觉证据明确",
          })),
        };
        await reportProgress?.({
          type: "visual-review-complete",
          outcome: "completed",
          durationMs: 120,
          tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        });
        await reportProgress?.({
          type: "design-system-query-start",
          queryId: "antd-select-1",
          componentId: "select",
          sections: ["info", "semantic"],
        });
        await reportProgress?.({
          type: "design-system-query-complete",
          queryId: "antd-select-1",
          componentId: "select",
          outcome: "completed",
          durationMs: 24,
        });
        await reportProgress?.({
          type: "planning-complete",
          recognition: finalRecognition,
          plan: reviewablePlan,
          durationMs: 80,
          tokenUsage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        });
        return task;
      },
    };
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });
    const events = [];

    for await (const event of workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId,
      expectedRevision: 1,
    })) events.push(event);

    const componentResults = events.filter((event) => event.type === "design-component-result");
    expect(componentResults).toHaveLength(2);
    expect(componentResults[0]?.result.components[0]).not.toHaveProperty("effectiveTypeId");
    expect(componentResults[1]).toMatchObject({
      result: { components: [expect.objectContaining({
        effectiveTypeId: "select",
        visualSuggestion: expect.objectContaining({ suggestedTypeId: "select" }),
      })] },
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool-start",
        toolName: "visual_component_subagent",
        parentToolCallId: expect.any(String),
        summary: "独立视觉 Subagent 正在读取受控整体预览与候选局部图。",
      }),
      expect.objectContaining({
        type: "tool-complete",
        summary: "视觉 Subagent 已返回组件建议，等待主 Plan Agent 最终确认。",
        metrics: {
          durationMs: 120,
          tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      }),
      expect.objectContaining({
        type: "tool-start",
        toolName: "antd_list",
        summary: "查询本地官方 Ant Design MCP 组件清单。",
      }),
      expect.objectContaining({
        type: "tool-start",
        toolName: "inspect_antd_component",
        parentToolCallId: expect.any(String),
      }),
    ]));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "plan-result", plan: reviewablePlan }),
    ]));
    const planningStart = events.find((event) => event.type === "tool-start"
      && event.toolName === "plan_design_changes");
    const visualStart = events.find((event) => event.type === "tool-start"
      && event.toolName === "visual_component_subagent");
    expect(visualStart).toMatchObject({ parentToolCallId: planningStart?.toolCallId });
  });

  it("marks unavailable component recognition as a warning", async () => {
    const taskId = "44444444-4444-4444-8444-444444444444";
    const projectInspection = { kind: "empty" as const, projectRoot: "/workspace" };
    const componentRecognition = {
      status: "unavailable" as const,
      components: [],
      warnings: ["缺少结构证据"],
    };
    const task: D2CAgent.Task = {
      taskId,
      workspaceId: "workspace-1",
      revision: 2,
      status: "svg_ready",
      projectPath: "/workspace",
      taskGoal: "实现客户列表",
      projectInspection,
      componentRecognition,
    };
    const service: D2CAgent.Service = {
      initialize: async () => task,
      getTask: async () => task,
      inspectDesign: async () => task,
      reset: async () => task,
      analyzeSecondStep: async (_command, reportProgress) => {
        await reportProgress?.({ type: "component-recognition-start" });
        await reportProgress?.({
          type: "component-recognition-complete",
          recognition: componentRecognition,
          unknownCount: 0,
          durationMs: 2,
        });
        return task;
      },
    };
    const workflow = new D2CWorkflowService({ service, designProvider: "mastergo" });
    const events = [];

    for await (const event of workflow.stream(d2cWorkflowMethods.streamConversation, {
      taskId,
      expectedRevision: 1,
    })) events.push(event);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool-complete",
        outcome: "warning",
        summary: "当前设计缺少可识别的结构证据。",
      }),
    ]));
  });
});
