/** 验证目录驱动候选提取不会把名称规则伪装成最终语义。 */

import { describe, expect, it } from "vitest";
import type { DesignNodeEvidence } from "../design-context/designStructure.js";
import { createDeterministicDesignComponentRecognizer } from "./deterministicDesignComponentRecognizer.js";

const catalog = { components: [
  { id: "table", name: "Table", aliases: ["表格"] },
  { id: "navigation", name: "Navigation", aliases: ["导航"] },
  { id: "business-picker", name: "Business Picker", aliases: ["业务控件"] },
] };

describe("deterministic design component recognizer", () => {
  it("extracts candidates and only exposes catalog hints", () => {
    const recognizer = createDeterministicDesignComponentRecognizer(catalog);
    const result = recognizer.recognize({
      truncated: false,
      roots: [
        container("header", "第一行", [text("字段")]),
        container("row-1", "第二行", [text("内容")]),
        container("row-2", "第二行", [text("内容")]),
        sourceComponent("navigation", "component", "导航栏", "component-navigation"),
      ],
    }, catalog);

    expect(result.components.map((component) => component.typeHint?.typeId)).toEqual(["navigation", "table"]);
    expect(result.components.every((component) => component.effectiveTypeId === undefined)).toBe(true);
  });

  it("merges a definition and instance by source component id", () => {
    const recognizer = createDeterministicDesignComponentRecognizer(catalog);
    const result = recognizer.recognize({
      truncated: false,
      roots: [
        sourceComponent("definition", "component", "业务控件", "component-1"),
        sourceComponent("instance", "instance", "业务控件", "component-1"),
      ],
    }, catalog);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      typeHint: { typeId: "business-picker" },
      evidenceStrength: "explicit",
      instanceCount: 1,
      sourceNodeIds: ["definition", "instance"],
    });
  });

  it("merges a definition node whose id is the instance source component id", () => {
    const recognizer = createDeterministicDesignComponentRecognizer(catalog);
    const result = recognizer.recognize({
      truncated: false,
      roots: [
        definitionComponent("component-1", "业务控件"),
        sourceComponent("instance", "instance", "业务控件", "component-1"),
      ],
    }, catalog);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      id: "component:component-1",
      instanceCount: 1,
      sourceNodeIds: ["component-1", "instance"],
    });
  });

  it("keeps unclassified source components explicit and reports truncation", () => {
    const recognizer = createDeterministicDesignComponentRecognizer(catalog);
    const result = recognizer.recognize({
      truncated: true,
      roots: [sourceComponent("custom", "instance", "未配置控件", "component-2")],
    }, catalog);

    expect(result.components[0]?.typeHint).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});

function container(id: string, name: string, children: DesignNodeEvidence[]): DesignNodeEvidence {
  return { id, name, kind: "container", children };
}

function text(id: string): DesignNodeEvidence {
  return { id, name: id, kind: "text", text: id, children: [] };
}

function sourceComponent(
  id: string,
  kind: "component" | "instance",
  name: string,
  sourceComponentId: string,
): DesignNodeEvidence {
  return { id, kind, name, sourceComponentId, children: [text(`${id}-text`)] };
}

function definitionComponent(id: string, name: string): DesignNodeEvidence {
  return { id, kind: "component", name, children: [text(`${id}-text`)] };
}
