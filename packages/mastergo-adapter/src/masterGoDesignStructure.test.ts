/** 验证 MasterGo DSL 只被转换为平台无关且受限的结构证据。 */

import { describe, expect, it } from "vitest";
import { createMasterGoDesignStructure } from "./masterGoDesignStructure.js";
import type { RawDesignPayload } from "./types.js";

describe("createMasterGoDesignStructure", () => {
  it("normalizes provider node types, geometry and component identity", () => {
    const structure = createMasterGoDesignStructure(payloadWithNodes([{
      type: "INSTANCE",
      id: "instance-1",
      name: "搜索",
      componentId: "component-1",
      layoutStyle: { relativeX: 10, relativeY: 20, width: 155, height: 32 },
      children: [{
        type: "TEXT",
        id: "text-1",
        name: "输入文本",
        text: [{ text: "输入过滤器文本" }],
      }],
    }]));

    expect(structure).toEqual({
      truncated: false,
      roots: [{
        id: "instance-1",
        name: "搜索",
        kind: "instance",
        sourceComponentId: "component-1",
        bounds: { x: 10, y: 20, width: 155, height: 32 },
        children: [{
          id: "text-1",
          name: "输入文本",
          kind: "text",
          text: "输入过滤器文本",
          children: [],
        }],
      }],
    });
  });

  it("does not expose placeholder text as semantic evidence", () => {
    const structure = createMasterGoDesignStructure(payloadWithNodes([{
      type: "TEXT",
      id: "placeholder",
      name: "text",
      _placeholder: true,
      text: [{ text: "Hillstone Design" }],
    }]));

    expect(structure.roots[0]).not.toHaveProperty("text");
  });

  it("converts section and parent-relative positions to global preview bounds", () => {
    const payload = payloadWithNodes([{
      type: "FRAME",
      id: "parent",
      layoutStyle: { relativeX: 10, relativeY: 20, width: 100, height: 80 },
      children: [{
        type: "INSTANCE",
        id: "child",
        layoutStyle: { relativeX: 5, relativeY: 6, width: 20, height: 10 },
      }],
    }]);
    payload.sectionList = { sections: [{ x: 100, y: 200 }] };

    const structure = createMasterGoDesignStructure(payload);

    expect(structure.roots[0]?.bounds).toEqual({ x: 110, y: 220, width: 100, height: 80 });
    expect(structure.roots[0]?.children[0]?.bounds).toEqual({ x: 115, y: 226, width: 20, height: 10 });
  });
});

function payloadWithNodes(nodes: unknown[]): RawDesignPayload {
  return {
    source: { kind: "fixture", reference: "test" },
    sectionList: {},
    sections: [{ dsl: { nodes } }],
  };
}
