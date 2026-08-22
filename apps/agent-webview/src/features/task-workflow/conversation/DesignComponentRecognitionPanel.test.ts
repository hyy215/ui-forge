/** 验证 Tool 证据、视觉建议和主 Agent 结论分层展示。 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesignComponentRecognitionPanel } from "./DesignComponentRecognitionPanel";

describe("DesignComponentRecognitionPanel", () => {
  it("renders a compact final and visual summary while keeping evidence collapsed", () => {
    const markup = renderToStaticMarkup(createElement(DesignComponentRecognitionPanel, {
      status: "ready",
      recognition: {
        status: "recognized",
        components: [{
          id: "component:node-1",
          name: "筛选条件",
          instanceCount: 1,
          evidence: ["规则证据不足"],
          evidenceStrength: "weak",
          visualSuggestion: {
            suggestedTypeId: "select",
            confidence: 0.88,
            evidence: ["输入区域右侧存在下拉箭头"],
          },
          effectiveTypeId: "select",
          resolvedBy: "model",
          resolutionReason: "视觉证据比名称提示更明确",
        }],
        warnings: [],
      },
    }));

    expect(markup).toContain("1/1 已确认");
    expect(markup).toContain("视觉建议");
    expect(markup).toContain("88%");
    expect(markup).toContain("Select");
    expect(markup).toContain("查看判断依据");
    expect(markup).not.toContain("规则证据不足");
    expect(markup).not.toContain("输入区域右侧存在下拉箭头");
  });

  it("makes the pending relationship explicit while the main Agent is planning", () => {
    const markup = renderToStaticMarkup(createElement(DesignComponentRecognitionPanel, {
      status: "planning",
      recognition: {
        status: "recognized",
        components: [{
          id: "component:node-1",
          name: "筛选条件",
          instanceCount: 1,
          evidence: ["名称命中目录"],
          evidenceStrength: "weak",
        }],
        warnings: [],
      },
    }));

    expect(markup).toContain("确认中");
    expect(markup).toContain("视觉建议仅供主 Plan Agent 参考，不等于最终确认");
    expect(markup).toContain("等待主 Agent");
  });

  it("distinguishes a final unresolved decision from a pending candidate", () => {
    const markup = renderToStaticMarkup(createElement(DesignComponentRecognitionPanel, {
      status: "ready",
      recognition: {
        status: "recognized",
        components: [{
          id: "component:node-1",
          name: "业务控件",
          instanceCount: 1,
          evidence: ["证据冲突"],
          evidenceStrength: "weak",
          resolvedBy: "unresolved",
          resolutionReason: "目录与视觉建议冲突",
        }],
        warnings: [],
      },
    }));

    expect(markup).toContain("未解决");
    expect(markup).toContain("需关注");
  });
});
