import { describe, expect, it } from "vitest";
import { defaultVibeEndpoint, defaultVibeStatusEndpoint } from "@ui-forge/shared-protocol";
import { readDesignSourceOptions } from "./designSourceOptions.js";

const url = "https://mastergo.com/file/file?layer_id=2:3&page_id=1:0";
describe("CLI design source options", () => {
  it("defaults only text/image tasks to local", () => {
    expect(readDesignSourceOptions({})).toEqual({ kind: "local" });
  });
  it("preserves Magic file links without interpreting a Vibe target", () => {
    expect(
      readDesignSourceOptions({
        designSource: "mastergo",
        designUrl: "  https://mastergo.com/file/file  ",
        mastergoConnection: "magic",
      }),
    ).toEqual({
      kind: "mastergo",
      url: "https://mastergo.com/file/file",
      connection: { kind: "magic" },
    });
  });
  it("uses Vibe defaults only after explicit selection", () => {
    expect(
      readDesignSourceOptions({
        designSource: "mastergo",
        designUrl: url,
        mastergoConnection: "vibe",
      }),
    ).toEqual({
      kind: "mastergo",
      url,
      connection: {
        kind: "vibe",
        endpoint: defaultVibeEndpoint,
        statusEndpoint: defaultVibeStatusEndpoint,
      },
    });
  });
  it("preserves explicit loopback Vibe addresses", () => {
    expect(
      readDesignSourceOptions({
        designSource: "mastergo",
        designUrl: url,
        mastergoConnection: "vibe",
        vibeEndpoint: "http://localhost:1234/mcp",
        vibeStatusEndpoint: "http://localhost:1235/status",
      }),
    ).toMatchObject({
      connection: {
        endpoint: "http://localhost:1234/mcp",
        statusEndpoint: "http://localhost:1235/status",
      },
    });
  });
  it.each([
    { designUrl: url },
    { designSource: "local", designUrl: url },
    { mastergoConnection: "magic" },
    { vibeEndpoint: defaultVibeEndpoint },
    { vibeStatusEndpoint: defaultVibeStatusEndpoint },
    { designSource: "mastergo", designUrl: url },
    { designSource: "mastergo", mastergoConnection: "magic" },
    {
      designSource: "mastergo",
      designUrl: url,
      mastergoConnection: "magic",
      vibeEndpoint: defaultVibeEndpoint,
    },
    {
      designSource: "mastergo",
      designUrl: url,
      mastergoConnection: "magic",
      vibeStatusEndpoint: defaultVibeStatusEndpoint,
    },
    { designSource: "figma", designUrl: url },
    {
      designSource: "mastergo",
      designUrl: "https://figma.com/design/file",
      mastergoConnection: "magic",
    },
    {
      designSource: "mastergo",
      designUrl: url,
      mastergoConnection: "vibe",
      vibeEndpoint: "https://remote.example/mcp",
    },
  ])("rejects ambiguous or incompatible options %j", (options) => {
    expect(() => readDesignSourceOptions(options)).toThrow();
  });

  it.each([
    [{ designSource: "figma" }, "--design-source 只能为 local 或 mastergo。"],
    [{ designSource: null }, "--design-source 只能为 local 或 mastergo。"],
    [{ mastergoConnection: "automatic" }, "--mastergo-connection 只能为 magic 或 vibe。"],
    [{ mastergoConnection: null }, "--mastergo-connection 只能为 magic 或 vibe。"],
    [{ designSource: "mastergo", mastergoConnection: "magic" }, "mastergo 来源需要 --design-url。"],
    [
      { designSource: "mastergo", designUrl: url },
      "mastergo 来源需要显式指定 --mastergo-connection magic|vibe。",
    ],
    [null, "设计来源参数无效；请检查 --design-source、--design-url 和接入选项。"],
  ])(
    "names invalid or missing CLI options without raw validation errors %j",
    (options, message) => {
      expect(() => readDesignSourceOptions(options)).toThrow(message);
    },
  );

  it.each([
    "",
    " ",
    null,
    42,
    "http://mastergo.com/file/file",
    "https://figma.com/design/file",
    "https://user:private-password@mastergo.com/file/file",
  ])("reports a readable design URL error without echoing the input %j", (designUrl) => {
    expect(() =>
      readDesignSourceOptions({
        designSource: "mastergo",
        designUrl,
        mastergoConnection: "magic",
      }),
    ).toThrow(new Error("请输入完整的 MasterGo HTTPS 文件或图层链接。"));
  });

  describe.each(["vibeEndpoint", "vibeStatusEndpoint"])("%s validation", (option) => {
    it.each([
      null,
      42,
      "",
      "https://localhost:20678/mcp",
      "http://remote.example/mcp",
      "http://user:private-password@localhost:20678/mcp",
      "http://localhost:20678/mcp?token=private-token",
      "http://localhost:20678/mcp#private-token",
    ])("does not expose credentials or Zod payloads for %j", (endpoint) => {
      expect(() =>
        readDesignSourceOptions({
          designSource: "mastergo",
          designUrl: url,
          mastergoConnection: "vibe",
          [option]: endpoint,
        }),
      ).toThrow(new Error("Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。"));
    });
  });
});
