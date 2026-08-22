import { describe, expect, it } from "vitest";
import { SharpDesignVisualEvidenceProvider } from "./sharpDesignVisualEvidenceProvider.js";

describe("SharpDesignVisualEvidenceProvider", () => {
  it("renders an overview and candidate crop as bounded PNG data URLs", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80" fill="#fff"/><rect x="10" y="20" width="40" height="20" fill="#1677ff"/></svg>';
    const artifact = {
      reference: { artifactId: "11111111-1111-4111-8111-111111111111", sectionCount: 0, byteSize: 1 },
      content: {
        source: { provider: "mastergo", reference: "design" },
        name: "设计",
        nodeCount: 1,
        regions: [],
        tokens: {},
        structure: {
          truncated: false,
          roots: [{ id: "node-1", name: "组件", kind: "instance" as const, bounds: { x: 10, y: 20, width: 40, height: 20 }, children: [] }],
        },
        sections: [],
      },
    };
    const provider = new SharpDesignVisualEvidenceProvider({
      read: async () => artifact,
      readSection: async () => ({ id: "section", label: "section", data: {} }),
    });

    const result = await provider.create({
      context: {
        source: artifact.content.source,
        name: "设计",
        nodeCount: 1,
        tokens: {},
        regions: [],
        preview: { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, width: 100, height: 80 },
        warnings: [],
      },
      provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
      artifact: artifact.reference,
    }, {
      status: "recognized",
      components: [{ id: "component:node-1", name: "组件", sourceNodeIds: ["node-1"], instanceCount: 1, evidence: ["未知"], evidenceStrength: "weak" }],
      warnings: [],
    });

    expect(result.images).toHaveLength(2);
    expect(result.images.every((image) => image.dataUrl.startsWith("data:image/png;base64,"))).toBe(true);
    expect(result.images[1]).toMatchObject({ candidateId: "component:node-1" });
  });

  it("rejects SVG containing external resources", async () => {
    const provider = new SharpDesignVisualEvidenceProvider({
      read: async () => { throw new Error("should not read"); },
      readSection: async () => ({ id: "section", label: "section", data: {} }),
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>';

    const result = await provider.create({
      context: { source: { provider: "mastergo", reference: "design" }, name: "设计", nodeCount: 0, tokens: {}, regions: [], preview: { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` }, warnings: [] },
      provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
    }, { status: "recognized", components: [], warnings: [] });

    expect(result.images).toEqual([]);
    expect(result.warnings[0]).toContain("安全 SVG");
  });

  it("rejects an already-aborted visual evidence request before reading artifacts", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new SharpDesignVisualEvidenceProvider({
      read: async () => { throw new Error("should not read"); },
      readSection: async () => ({ id: "section", label: "section", data: {} }),
    });

    await expect(provider.create({
      context: { source: { provider: "mastergo", reference: "design" }, name: "设计", nodeCount: 0, tokens: {}, regions: [], warnings: [] },
      provenance: { provider: "MasterGo", transport: "MCP", operations: [] },
    }, { status: "recognized", components: [], warnings: [] }, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
