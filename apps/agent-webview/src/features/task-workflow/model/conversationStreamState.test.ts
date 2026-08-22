/** 验证项目校验、工具过程和未来真实方案替换的局部状态转换。 */

import { describe, expect, it, vi } from "vitest";
import {
  createConversationFailureTitle,
  createConversationStreamState,
  reduceConversationStreamState,
} from "./conversationStreamState";

const initial = createConversationStreamState({
  initialUserMessage: "请生成方案。",
  planStatus: "idle",
  projectValidation: null,
  designComponentRecognition: null,
  plan: null,
});

describe("conversation stream state", () => {
  it("uses safe progress to update phase without duplicating the tool timeline", () => {
    const started = reduceConversationStreamState(initial, { type: "stream-started" });
    const progressed = reduceConversationStreamState(started, {
      type: "stream-event",
      event: {
        type: "agent-progress",
        messageId: "message-1",
        phase: "project-validation",
        title: "检查项目",
        summary: "校验依赖。",
      },
    });
    const validated = reduceConversationStreamState(progressed, {
      type: "stream-event",
      event: {
        type: "project-validation",
        messageId: "message-1",
        result: { kind: "empty", message: "检测到空项目。" },
      },
    });

    expect(validated.status).toBe("validated");
    expect(validated.processEntries).toHaveLength(0);
    expect(validated.plan).toBeNull();
  });

  it("tracks deterministic design analysis and stores its real result", () => {
    const analyzing = reduceConversationStreamState(initial, {
      type: "stream-event",
      event: {
        type: "agent-progress",
        messageId: "message-1",
        phase: "design-analysis",
        title: "识别设计组件",
        summary: "执行确定性规则。",
      },
    });
    const recognized = reduceConversationStreamState(analyzing, {
      type: "stream-event",
      event: {
        type: "design-component-result",
        messageId: "message-1",
        result: {
          status: "recognized",
          components: [{
            id: "select:node-1",
            name: "选择框",
            instanceCount: 1,
            evidence: ["包含选择控件结构"],
            evidenceStrength: "structural",
            effectiveTypeId: "select",
            resolvedBy: "model",
            resolutionReason: "模型判断",
          }],
          warnings: [],
        },
      },
    });

    expect(analyzing.status).toBe("analyzing_design");
    expect(recognized.status).toBe("validated");
    expect(recognized.designComponentRecognition?.components[0]?.effectiveTypeId).toBe("select");
  });

  it("replaces planning state only after a real plan result event", () => {
    const planning = reduceConversationStreamState(initial, {
      type: "stream-event",
      event: { type: "plan-start", messageId: "message-1" },
    });
    const ready = reduceConversationStreamState(planning, {
      type: "stream-event",
      event: {
        type: "plan-result",
        messageId: "message-1",
        plan: {
          status: "reviewable",
          summary: "实现页面",
          designUnderstanding: {
            layout: { summary: "页面布局", regions: [], evidence: ["设计结构"], warnings: [] },
            interactions: [],
          },
          reusableComponents: [],
          newComponents: [],
          componentDecisions: [],
          fileImpacts: [],
          steps: [{
            id: "step-1",
            kind: "layout",
            targetId: "page-layout",
            title: "实现页面",
            description: "实现真实页面。",
            decision: "create",
            dependsOn: [],
            files: [],
            evidence: ["设计结构"],
            acceptanceCriteria: ["页面可访问"],
            risks: [],
          }],
          files: [],
          contextGaps: ["缺少文件证据"],
          stopConditions: ["验证失败时停止"],
        },
      },
    });

    expect(planning.status).toBe("planning");
    expect(ready.status).toBe("ready");
    expect(ready.plan?.steps[0]?.title).toBe("实现页面");
  });

  it("stores tool metrics and reaches stopped without discarding partial results", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const started = reduceConversationStreamState(initial, { type: "stream-started" });
    const withTool = reduceConversationStreamState(started, {
      type: "stream-event",
      event: {
        type: "tool-start",
        messageId: "message-1",
        toolCallId: "tool-1",
        toolName: "review_design_components_visually",
        summary: "正在分析。",
      },
    });
    const completed = reduceConversationStreamState(withTool, {
      type: "stream-event",
      event: {
        type: "tool-complete",
        messageId: "message-1",
        toolCallId: "tool-1",
        summary: "分析完成。",
        outcome: "success",
        metrics: {
          durationMs: 1_250,
          tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        },
      },
    });
    now.mockReturnValue(4_250);
    const stopped = reduceConversationStreamState(completed, {
      type: "stream-event",
      event: { type: "message-stopped", messageId: "message-1" },
    });

    expect(completed.processEntries[0]?.metrics).toEqual({
      durationMs: 1_250,
      tokenUsage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
    });
    expect(completed.processEntries[0]).toMatchObject({
      toolCallId: "tool-1",
      outcome: "success",
      summary: "分析完成。",
    });
    expect(stopped.status).toBe("stopped");
    expect(stopped.streamStartedAt).toBe(1_000);
    expect(stopped.streamFinishedAt).toBe(4_250);
    expect(stopped.streamActive).toBe(false);
    expect(stopped.processEntries).toEqual(completed.processEntries);
    now.mockRestore();
  });

  it("keeps one timeline entry for each tool call", () => {
    const events = [{
      type: "agent-progress" as const,
      messageId: "message-1",
      phase: "project-validation" as const,
      title: "识别目标项目",
      summary: "开始项目识别。",
    }, {
      type: "tool-start" as const,
      messageId: "message-1",
      toolCallId: "project-tool",
      toolName: "inspect_project",
      summary: "读取项目证据。",
    }, {
      type: "agent-progress" as const,
      messageId: "message-1",
      phase: "design-analysis" as const,
      title: "识别设计组件",
      summary: "开始组件识别。",
    }, {
      type: "tool-start" as const,
      messageId: "message-1",
      toolCallId: "component-tool",
      toolName: "recognize_design_components",
      summary: "读取设计结构。",
    }];
    const result = events.reduce((state, event) => reduceConversationStreamState(state, {
      type: "stream-event",
      event,
    }), initial);

    expect(result.processEntries.map((entry) => entry.toolName)).toEqual([
      "inspect_project",
      "recognize_design_components",
    ]);
  });

  it("retains an explicit parent tool relationship", () => {
    const result = reduceConversationStreamState(initial, {
      type: "stream-event",
      event: {
        type: "tool-start",
        messageId: "message-1",
        toolCallId: "visual-tool",
        parentToolCallId: "plan-tool",
        toolName: "visual_component_subagent",
        summary: "读取图片。",
      },
    });

    expect(result.processEntries[0]).toMatchObject({
      toolCallId: "visual-tool",
      parentToolCallId: "plan-tool",
    });
  });

  it("keeps timing active through partial results and freezes it on message completion", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const started = reduceConversationStreamState(initial, { type: "stream-started" });
    const partiallyValidated = reduceConversationStreamState(started, {
      type: "stream-event",
      event: {
        type: "project-validation",
        messageId: "message-1",
        result: { kind: "empty", message: "项目识别完成。" },
      },
    });

    expect(partiallyValidated.status).toBe("validated");
    expect(partiallyValidated.streamActive).toBe(true);
    expect(partiallyValidated.streamFinishedAt).toBeNull();

    now.mockReturnValue(12_600);
    const finished = reduceConversationStreamState(partiallyValidated, {
      type: "stream-event",
      event: { type: "message-complete", messageId: "message-1" },
    });
    expect(finished.streamActive).toBe(false);
    expect(finished.streamStartedAt).toBe(10_000);
    expect(finished.streamFinishedAt).toBe(12_600);
    now.mockRestore();
  });

  it("retains the visual subagent stage when the stream fails", () => {
    const started = reduceConversationStreamState(initial, { type: "stream-started" });
    const planning = reduceConversationStreamState(started, {
      type: "stream-event",
      event: { type: "plan-start", messageId: "message-1" },
    });
    const visual = reduceConversationStreamState(planning, {
      type: "stream-event",
      event: {
        type: "tool-start",
        messageId: "message-1",
        toolCallId: "visual-tool",
        parentToolCallId: "plan-tool",
        toolName: "visual_component_subagent",
        summary: "正在读取图片。",
      },
    });
    const failed = reduceConversationStreamState(visual, {
      type: "stream-failed",
      message: "模型连接中断。",
    });

    expect(failed.failureStage).toBe("visual-analysis");
    expect(createConversationFailureTitle(failed.failureStage)).toBe("视觉分析失败");
  });

  it("uses the active deterministic or planning stage in failure titles", () => {
    expect(createConversationFailureTitle("project-validation")).toBe("项目校验失败");
    expect(createConversationFailureTitle("project-analysis")).toBe("目标仓库分析失败");
    expect(createConversationFailureTitle("planning")).toBe("方案生成失败");
    expect(createConversationFailureTitle(null)).toBe("分析失败");
  });
});
