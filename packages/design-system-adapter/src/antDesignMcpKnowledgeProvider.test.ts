/** 验证 Ant Design MCP Adapter 的目录合并、查询白名单、降级和连接生命周期。 */

import { describe, expect, it, vi } from "vitest";
import {
  AntDesignMcpKnowledgeProvider,
  type AntDesignMcpConnection,
} from "./antDesignMcpKnowledgeProvider.js";

const inspection = { kind: "react_antd" as const, projectRoot: "/workspace", antdVersion: "^6.0.0" };
const baseCatalog = { components: [{
  id: "tree",
  name: "Tree",
  aliases: ["目录树"],
  implementation: { packageName: "antd", exportName: "Tree" },
}] };

describe("AntDesignMcpKnowledgeProvider", () => {
  it("merges official components with curated aliases and reuses one connection", async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async (name: string) => name === "antd_list"
      ? [{ name: "Tree", nameZh: "树形控件" }, { name: "InputNumber", nameZh: "数字输入框" }]
      : { name: "Tree", props: [] });
    const connection: AntDesignMcpConnection = { callTool, close };
    const createConnection = vi.fn(async () => connection);
    const provider = new AntDesignMcpKnowledgeProvider({ createConnection });

    const resolution = await provider.resolveCatalog({ inspection, baseCatalog });
    const records = await provider.queryComponent({
      inspection,
      componentName: "Tree.DirectoryTree",
      sections: ["info", "semantic"],
    });
    await provider.dispose();

    expect(resolution.warnings).toEqual([]);
    expect(resolution.catalog.components.find((entry) => entry.id === "tree")?.aliases)
      .toEqual(["目录树", "Tree", "树形控件"]);
    expect(resolution.catalog.components).toContainEqual({
      id: "input-number",
      name: "InputNumber",
      aliases: ["InputNumber", "数字输入框"],
      implementation: { packageName: "antd", exportName: "InputNumber" },
    });
    expect(records.map((record) => record.toolName)).toEqual(["antd_info", "antd_semantic"]);
    expect(callTool).toHaveBeenCalledWith("antd_info", { component: "Tree", detail: true });
    expect(createConnection).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns the static catalog with an explicit warning when MCP startup fails", async () => {
    const provider = new AntDesignMcpKnowledgeProvider({
      createConnection: async () => { throw new Error("stdio closed"); },
    });

    await expect(provider.resolveCatalog({ inspection, baseCatalog })).resolves.toEqual({
      catalog: baseCatalog,
      warnings: ["Ant Design MCP 目录查询失败，已回退静态目录：stdio closed"],
    });
  });

  it("propagates cancellation instead of disguising it as a catalog fallback", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async (_name: string, _argumentsValue: Record<string, unknown>, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      throw new DOMException("cancelled", "AbortError");
    });
    const provider = new AntDesignMcpKnowledgeProvider({
      createConnection: async () => ({ callTool, close: async () => undefined }),
    });

    const pending = provider.resolveCatalog({ inspection, baseCatalog, signal: controller.signal });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(callTool).toHaveBeenCalledOnce();
  });

  it("rejects non-JSON component knowledge before returning it to the planning model", async () => {
    const provider = new AntDesignMcpKnowledgeProvider({
      createConnection: async () => ({
        callTool: async () => ({ unsafe: () => "instruction" }),
        close: async () => undefined,
      }),
    });

    await expect(provider.queryComponent({
      inspection,
      componentName: "Tree",
      sections: ["info"],
    })).rejects.toThrow("非 JSON 数据类型");
  });

  it("crops oversized component knowledge and marks the degraded record", async () => {
    const provider = new AntDesignMcpKnowledgeProvider({
      createConnection: async () => ({
        callTool: async () => ({ description: "x".repeat(100_000) }),
        close: async () => undefined,
      }),
    });

    const records = await provider.queryComponent({
      inspection,
      componentName: "Tree",
      sections: ["info"],
    });

    expect(records[0]?.data).toMatchObject({ __uiForgeTruncated: true });
    expect(JSON.stringify(records[0]?.data).length).toBeLessThan(64 * 1024);
  });
});
