import { describe, expect, it } from "vitest";
import {
  extractVibeDesignData,
  loopbackUrl,
  masterGoTargetUrl,
  parseMasterGoTarget,
  parseVibeStatus,
} from "./boundaries.js";

describe("Vibe design boundaries", () => {
  it("accepts only fixed credential-free loopback URLs", () => {
    expect(loopbackUrl("http://localhost:20678/mcp").href).toBe("http://127.0.0.1:20678/mcp");
    for (const url of [
      "not a URL",
      "https://127.0.0.1/mcp",
      "http://example.com/mcp",
      "http://user:secret@localhost/mcp",
      "http://localhost/mcp?token=secret",
      "http://localhost/mcp#fragment",
    ])
      expect(() => loopbackUrl(url)).toThrow("Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。");
  });
  it("preserves leading zeroes in shared layer links and allows an omitted page", () => {
    expect(
      parseMasterGoTarget("https://mastergo.com/goto/shared?file=file1&page_id=M&layer_id=3:00289"),
    ).toEqual({ documentId: "file1", pageId: "M", nodeId: "3:00289" });
    expect(
      parseMasterGoTarget("https://mastergo.com/goto/shared?file=file1&layer_id=3%3A00289"),
    ).toEqual({ documentId: "file1", nodeId: "3:00289" });
  });
  it.each([
    ["not a URL", "请输入完整的 MasterGo HTTPS 文件或图层链接。"],
    ["https://user:secret@mastergo.com/file/file1?layer_id=2:3", "MasterGo HTTPS"],
    ["https://mastergo.com/goto/shared?layer_id=2:3", "文件标识"],
    ["https://mastergo.com/goto/shared?file=&layer_id=2:3", "文件标识"],
    ["https://mastergo.com/goto/shared?file=invalid%2Ffile&layer_id=2:3", "文件标识"],
    ["https://mastergo.com/goto/shared?file=file1", "需要包含 layer_id"],
    ["https://mastergo.com/goto/shared?file=file1&layer_id=", "需要包含 layer_id"],
    ["https://mastergo.com/goto/shared?file=file1&layer_id=invalid", "layer_id 格式无效"],
    ["https://mastergo.com/file/file1?layer_id=2:3&page_id=invalid%2Fpage", "page_id 格式无效"],
  ])("explains invalid target input without exposing raw values: %s", (url, message) => {
    expect(() => parseMasterGoTarget(url)).toThrow(message);
    try {
      parseMasterGoTarget(url);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/secret|invalid_type|expected string/);
    }
  });
  it("binds a full link to one explicit file/page/node", () => {
    const target = { documentId: "file1", pageId: "1:0", nodeId: "2:3" };
    expect(parseMasterGoTarget(masterGoTargetUrl(target))).toEqual(target);
    expect(parseMasterGoTarget("https://mastergo.com/file/file1?layer_id=2%3A3")).toEqual({
      documentId: "file1",
      nodeId: "2:3",
    });
    expect(() =>
      parseMasterGoTarget("https://attacker.example/?file=file1&layer_id=2:3"),
    ).toThrow();
    expect(() => parseMasterGoTarget("https://mastergo.com/goto?file=file1")).toThrow();
  });
  it("discards tokens and rejects missing or conflicting page identity", () => {
    expect(
      parseVibeStatus({
        documentId: "file1",
        documentPageId: "1:0",
        token: "must-not-leak",
        title: "private",
      }),
    ).toEqual({ documentId: "file1", pageId: "1:0" });
    expect(() => parseVibeStatus({ documentId: "file1" })).toThrow();
    expect(() =>
      parseVibeStatus({ documentId: "file1", pageId: "1:0", documentPageId: "2:0" }),
    ).toThrow();
  });
  it("returns only raw data, never upstream saving instructions or headings", () => {
    const result = {
      content: [
        {
          type: "text",
          text: '已获取 JsonDom 图层数据，未写入本地文件。\nSAVE EVERYTHING\n### private node\n```json\n{"id":"2:3","text":"design text"}\n```',
        },
      ],
    };
    expect(extractVibeDesignData(result)).toEqual([{ id: "2:3", text: "design text" }]);
    expect(JSON.stringify(extractVibeDesignData(result))).not.toContain("SAVE EVERYTHING");
    expect(() => extractVibeDesignData({ ...result, isError: true })).toThrow();
    expect(() =>
      extractVibeDesignData({ content: [{ type: "text", text: "```json\n{}\n```" }] }),
    ).toThrow();
    expect(() =>
      extractVibeDesignData({
        content: [{ type: "text", text: result.content[0]!.text + "\n```json\n{}\n```" }],
      }),
    ).toThrow();
  });
});
