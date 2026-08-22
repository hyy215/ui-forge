/** 验证 MasterGo MCP 分段读取、标准化、输入拒绝和资源释放。 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MasterGoMcpAdapter } from "./masterGoMcpAdapter.js";
import type { McpClient } from "./stdioMcpClient.js";
import { rawDesignPayloadSchema } from "./types.js";

/** 将未知数据包装成 MCP 文本工具结果。 */
function toolResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

describe("MasterGoMcpAdapter", () => {
  it("normalizes the captured table-filter fixture without a live MCP connection", async () => {
    const fixtureUrl = new URL("../../../fixtures/design-cases/mastergo-table-filter.json", import.meta.url);
    const fixture = rawDesignPayloadSchema.parse(JSON.parse(readFileSync(fixtureUrl, "utf8")));
    const adapter = new MasterGoMcpAdapter();

    const context = await adapter.normalize(fixture);

    expect(context).toMatchObject({
      source: { provider: "mastergo", reference: "fixture://mastergo-table-filter" },
      name: "容器 13",
      nodeCount: 177,
      structurePreview: { width: 980, height: 440 },
      warnings: [],
    });
    expect(context.regions).toHaveLength(23);
    expect(fixture.sections).toHaveLength(23);
  });

  it("reads every design section and normalizes regions and tokens", async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async (_name: string, argumentsValue: Record<string, unknown>) => {
      if (argumentsValue.sectionIndex === undefined) {
        return toolResult({
          totalSections: 2,
          rootMetadata: {
            name: "客户管理",
            width: 1440,
            height: 900,
            preview: {
              url: "/api/design-preview/customer-list.png",
              width: 1440,
              height: 900,
            },
          },
          sections: [
            { id: "12:1", name: "筛选区", nodeCount: 3, type: "form", x: 24, y: 24, width: 1392, height: 120 },
            { id: "12:2", name: "表格区", nodeCount: 7, type: "table", x: 24, y: 168, width: 1392, height: 708 },
          ],
          rootContainer: { background: "#FFFFFF" },
        });
      }
      return toolResult({
        dsl: {
          nodes: [{ _token: "Text/Primary", _color: "#1d2129" }],
          globalVars: { spacingMedium: 16 },
        },
      });
    });
    const client: McpClient = { callTool, close };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    const { context } = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(context).toMatchObject({
      name: "客户管理",
      nodeCount: 10,
      tokens: { "Text/Primary": "#1d2129", spacingMedium: 16 },
      preview: {
        url: "https://mastergo.com/api/design-preview/customer-list.png",
        width: 1440,
        height: 900,
      },
      structurePreview: {
        width: 1440,
        height: 900,
        background: "#FFFFFF",
        regions: [
          { id: "12:1", x: 24, y: 24, width: 1392, height: 120 },
          { id: "12:2", x: 24, y: 168, width: 1392, height: 708 },
        ],
      },
      regions: [
        { id: "12:1", name: "筛选区", role: "form", x: 24, y: 24, width: 1392, height: 120 },
        { id: "12:2", name: "表格区", role: "table", x: 24, y: 168, width: 1392, height: 708 },
      ],
    });
    expect(callTool).toHaveBeenCalledTimes(4);
    expect(callTool).toHaveBeenNthCalledWith(2, "getDesignSections", {
      fileId: "123",
      layerId: "12:48",
      sectionIndex: 0,
      format: "json",
    });
    expect(callTool).toHaveBeenNthCalledWith(4, "extractSvg", {
      fileId: "123",
      layerId: "12:48",
      page: 0,
      pageSize: 100,
      format: "json",
    });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("returns transport provenance through the D2C Agent design port", async () => {
    const client: McpClient = {
      callTool: async (_name, argumentsValue) => toolResult(
        argumentsValue.sectionIndex === undefined
          ? { totalSections: 0, rootMetadata: { name: "客户管理" }, sections: [] }
          : {},
      ),
      close: async () => undefined,
    };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    const inspection = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(inspection.context.name).toBe("客户管理");
    expect(inspection.provenance).toEqual({
      provider: "MasterGo",
      transport: "MCP",
      operations: ["getDesignSections"],
    });
  });

  it("builds a deterministic high-fidelity preview from section text and extracted SVG", async () => {
    const callTool = vi.fn(async (name: string, argumentsValue: Record<string, unknown>) => {
      if (name === "extractSvg") {
        return toolResult({
          totalCount: 2,
          count: 2,
          page: 0,
          pageSize: 100,
          hasMore: false,
          svgs: [
            {
              id: "S0#0",
              name: "navigation-icon",
              svg: "<?xml version=\"1.0\"?><svg viewBox=\"-1 -2 16 18\"><path d=\"M1 1L13 13\" fill=\"none\" stroke=\"#333333\"/></svg>",
            },
            {
              id: "arrow-resource",
              name: "dropdown-arrow",
              svg: "<svg viewBox=\"0 0 8 4\"><path d=\"M0 0L4 4L8 0\" fill=\"none\" stroke=\"#333333\"/></svg>",
            },
          ],
        });
      }
      if (argumentsValue.sectionIndex === undefined) {
        return toolResult({
          totalSections: 1,
          rootMetadata: { name: "Search page", width: 320, height: 180 },
          rootContainer: { background: "#ffffff" },
          sections: [{ id: "section", name: "Content", x: 20, y: 30, width: 280, height: 120 }],
        });
      }
      return toolResult({
        dsl: {
          styles: {
            text: { value: { family: "Arial", size: 14, weight: "400", lineHeight: "18px" } },
            validation: {
              value: { family: "Source Han Sans", size: 12, weight: "400", lineHeight: "14px" },
            },
          },
          nodes: [{
            type: "FRAME",
            id: "section",
            layoutStyle: { width: 280, height: 120, relativeX: 0, relativeY: 0 },
            fill: "#ffffff",
            children: [
              {
                type: "TEXT",
                id: "title",
                layoutStyle: { width: 120, height: 24, relativeX: 12, relativeY: 10 },
                fill: "#333333",
                text: [{ text: "Search users", font: "text" }],
              },
              {
                type: "TEXT",
                id: "validation-message",
                layoutStyle: { width: 184, height: 28, relativeX: 12, relativeY: 44 },
                fill: "#333333",
                text: [{ text: "输入参数内容2，不符合该字段校验规则2", font: "validation" }],
                textMode: "auto-height",
              },
              {
                type: "PATH",
                id: "icon-frame",
                name: "navigation-icon-node",
                svgShortKey: "S0#0",
                layoutStyle: { width: 14, height: 14, relativeX: 250, relativeY: 12 },
              },
              {
                type: "FRAME",
                id: "arrow-frame",
                name: "dropdown-arrow",
                layoutStyle: { width: 14, height: 14, relativeX: 230, relativeY: 12 },
                children: [{
                  type: "FRAME",
                  id: "arrow-padding",
                  layoutStyle: { width: 14, height: 14, relativeX: 0, relativeY: 0 },
                  children: [{
                    type: "PATH",
                    id: "arrow-node",
                    name: "arrow-vector",
                    layoutStyle: { width: 8, height: 4, relativeX: 3, relativeY: 5 },
                  }],
                }],
              },
            ],
          }],
        },
      });
    });
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({ callTool, close: async () => undefined }),
    });

    const inspection = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(inspection.provenance.operations).toEqual(["getDesignSections", "extractSvg"]);
    expect(inspection.context.preview).toMatchObject({ width: 320, height: 180 });
    const encoded = inspection.context.preview?.url.split(",", 2)[1];
    expect(encoded).toBeTruthy();
    const previewSvg = Buffer.from(encoded ?? "", "base64").toString("utf8");
    expect(previewSvg).toContain("Search users");
    expect(previewSvg).toContain("M1 1L13 13");
    expect(previewSvg).toContain("M0 0L4 4L8 0");
    expect(previewSvg).toContain('viewBox="-1 -2 16 18"');
    expect(previewSvg).toContain('viewBox="0 0 8 4"');
    expect(previewSvg).toContain(
      '<svg width="14" height="14" viewBox="-1 -2 16 18" preserveAspectRatio="none"',
    );
    expect(previewSvg).toContain(
      '<svg width="8" height="4" viewBox="0 0 8 4" preserveAspectRatio="none"',
    );
    expect(previewSvg).toContain(
      '<g transform="translate(230 12)"><g><g transform="translate(3 5)"><svg width="8" height="4"',
    );
    expect(previewSvg).not.toContain(
      '<g transform="translate(230 12)"><svg width="14" height="14"',
    );
    expect(previewSvg).not.toContain("<?xml");
    expect(inspection.context.warnings).toEqual([]);
    const textLines = [...previewSvg.matchAll(/<tspan\b[^>]*>(.*?)<\/tspan>/g)]
      .map((match) => match[1]);
    expect(textLines).toEqual([
      "Search users",
      "输入参数内容2，不符合该字段校",
      "验规则2",
    ]);
  });

  it("extracts a bounded SVG page from the task design reference", async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async () => toolResult({
      total: 1,
      svgs: [{ id: "12:48", svg: "<svg><path d=\"M0 0\" /></svg>" }],
    }));
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({ callTool, close }),
    });

    const result = await adapter.extractSvg(
      "https://mastergo.com/file/123?layer_id=12%3A48",
      { page: 1, pageSize: 10 },
    );

    expect(result.byteSize).toBeGreaterThan(0);
    expect(callTool).toHaveBeenCalledWith("extractSvg", {
      fileId: "123",
      layerId: "12:48",
      page: 1,
      pageSize: 10,
      format: "json",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("warns when an extracted SVG cannot be placed reliably", async () => {
    const callTool = vi.fn(async (name: string, argumentsValue: Record<string, unknown>) => {
      if (name === "extractSvg") {
        return toolResult({
          count: 1,
          hasMore: false,
          svgs: [{
            id: "unmatched-icon",
            name: "unmatched-icon",
            svg: "<svg viewBox=\"0 0 12 12\"><path d=\"M0 0L12 12\"/></svg>",
          }],
        });
      }
      if (argumentsValue.sectionIndex === undefined) {
        return toolResult({
          totalSections: 1,
          rootMetadata: { name: "Warning page", width: 100, height: 80 },
          sections: [{ id: "section", x: 0, y: 0, width: 100, height: 80 }],
        });
      }
      return toolResult({
        dsl: {
          styles: {},
          nodes: [{
            type: "FRAME",
            id: "section",
            layoutStyle: { width: 100, height: 80 },
            fill: "#ffffff",
          }],
        },
      });
    });
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({ callTool, close: async () => undefined }),
    });

    const inspection = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(inspection.context.warnings).toContain(
      "1 个 MasterGo SVG 资源缺少可靠布局，预览可能缺少图标细节。",
    );
  });

  it("rejects executable markup returned by the SVG tool", async () => {
    const close = vi.fn(async () => undefined);
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({
        callTool: async () => toolResult({ svg: "<svg onload=\"alert(1)\"></svg>" }),
        close,
      }),
    });

    await expect(adapter.extractSvg(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    )).rejects.toThrow("包含不允许的可执行标记");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects external resources returned by the SVG tool", async () => {
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({
        callTool: async () => toolResult({
          svg: "<svg><image href=\"https://attacker.example/tracker.png\" /></svg>",
        }),
        close: async () => undefined,
      }),
    });

    await expect(adapter.extractSvg(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    )).rejects.toThrow("包含不允许的可执行标记");
  });

  it("rejects external stylesheet imports returned by the SVG tool", async () => {
    const adapter = new MasterGoMcpAdapter({
      clientFactory: () => ({
        callTool: async () => toolResult({
          svg: '<svg><style>@import "https://attacker.example/tracker.css";</style></svg>',
        }),
        close: async () => undefined,
      }),
    });

    await expect(adapter.extractSvg(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    )).rejects.toThrow("包含不允许的可执行标记");
  });

  it("rejects executable preview URLs from untrusted metadata", async () => {
    const client: McpClient = {
      callTool: async (_name, argumentsValue) => toolResult(
        argumentsValue.sectionIndex === undefined
          ? {
              totalSections: 0,
              rootMetadata: { name: "恶意预览", previewUrl: "javascript:alert(1)" },
              sections: [],
            }
          : {},
      ),
      close: async () => undefined,
    };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    const { context } = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(context.preview).toBeUndefined();
  });

  it("rejects cross-origin preview URLs from untrusted metadata", async () => {
    const client: McpClient = {
      callTool: async (_name, argumentsValue) => toolResult(
        argumentsValue.sectionIndex === undefined
          ? {
              totalSections: 0,
              rootMetadata: {
                name: "外部预览",
                previewUrl: "https://attacker.example/tracking.png",
              },
              sections: [],
            }
          : {},
      ),
      close: async () => undefined,
    };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    const { context } = await adapter.inspect(
      "https://mastergo.com/file/123?layer_id=12%3A48",
    );

    expect(context.preview).toBeUndefined();
  });

  it("rejects untrusted design origins before starting MCP", async () => {
    const clientFactory = vi.fn<() => McpClient>();
    const adapter = new MasterGoMcpAdapter({ clientFactory });

    await expect(adapter.load({
      kind: "mastergo",
      reference: "https://attacker.example/file/123?layer_id=12:48",
    })).rejects.toThrow("必须属于 https://mastergo.com");
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("stops when the design exceeds the configured section budget", async () => {
    const close = vi.fn(async () => undefined);
    const client: McpClient = {
      callTool: vi.fn(async () => toolResult({ totalSections: 3, sections: [] })),
      close,
    };
    const adapter = new MasterGoMcpAdapter({ maxSections: 2, clientFactory: () => client });

    await expect(adapter.load({
      kind: "mastergo",
      reference: "https://mastergo.com/file/123?layer_id=12:48",
    })).rejects.toThrow("超过读取上限 2");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed MCP payloads and still closes the client", async () => {
    const close = vi.fn(async () => undefined);
    const client: McpClient = {
      callTool: vi.fn(async () => ({ content: [{ type: "image" }] })),
      close,
    };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    await expect(adapter.load({
      kind: "mastergo",
      reference: "https://mastergo.com/file/123?layer_id=12:48",
    })).rejects.toThrow("未返回文本数据");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not expose raw MCP error text to callers", async () => {
    const close = vi.fn(async () => undefined);
    const client: McpClient = {
      callTool: vi.fn(async () => ({
        isError: true,
        content: [{ type: "text", text: "upstream secret-token and private payload" }],
      })),
      close,
    };
    const adapter = new MasterGoMcpAdapter({ clientFactory: () => client });

    const request = adapter.load({
      kind: "mastergo",
      reference: "https://mastergo.com/file/123?layer_id=12:48",
    });

    await expect(request).rejects.toThrow("MasterGo MCP 工具调用失败");
    await expect(request).rejects.not.toThrow("secret-token");
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails before spawning MCP when the runtime token is missing", async () => {
    const adapter = new MasterGoMcpAdapter();

    await expect(adapter.load({
      kind: "mastergo",
      reference: "https://mastergo.com/file/123?layer_id=12:48",
    })).rejects.toThrow("缺少 MG_MCP_TOKEN");
  });
});
