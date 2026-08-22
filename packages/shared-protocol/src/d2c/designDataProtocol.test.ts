/** 验证设计 Artifact 浏览协议会接受分层响应并拒绝非法 Section 请求。 */

import { describe, expect, it } from "vitest";
import {
  designDataIndexSchema,
  designDataSectionSchema,
  getDesignDataSectionInputSchema,
} from "./designDataProtocol.js";

const artifactId = "6f71eaf4-b217-49e3-a4ba-f6d2f9277314";

describe("design data protocol", () => {
  it("keeps raw section data out of the lightweight index", () => {
    const index = designDataIndexSchema.parse({
      artifactId,
      provider: "mastergo-fixture",
      reference: "table-filter",
      name: "筛选表格",
      nodeCount: 12,
      byteSize: 1024,
      regions: [],
      tokens: { colorPrimary: "#1677ff" },
      sections: [{ index: 0, id: "section-list", label: "Section List", byteSize: 128 }],
    });

    expect(index.sections[0]).not.toHaveProperty("data");
  });

  it("accepts unknown JSON-compatible raw content in one section", () => {
    expect(designDataSectionSchema.parse({
      artifactId,
      index: 0,
      id: "section-list",
      label: "Section List",
      byteSize: 128,
      data: { sections: [{ id: "3:00289" }] },
    }).data).toEqual({ sections: [{ id: "3:00289" }] });
  });

  it("rejects negative section indexes", () => {
    expect(getDesignDataSectionInputSchema.safeParse({
      taskId: "3f566a42-9f11-4db5-91cf-16f99cb20e16",
      artifactId,
      sectionIndex: -1,
    }).success).toBe(false);
  });
});
