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
      "https://127.0.0.1/mcp",
      "http://example.com/mcp",
      "http://user:secret@localhost/mcp",
      "http://localhost/mcp?token=secret",
      "http://localhost/mcp#fragment",
    ])
      expect(() => loopbackUrl(url)).toThrow();
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
