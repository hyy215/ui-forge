import { describe, expect, it } from "vitest";
import { defaultVibeEndpoint, defaultVibeStatusEndpoint } from "@ui-forge/shared-protocol";
import { readDesignSourceOptions } from "./designSourceOptions.js";

const url = "https://mastergo.com/file/file?layer_id=2:3&page_id=1:0";
describe("CLI design source options", () => {
  it("defaults only text/image tasks to local", () => {
    expect(readDesignSourceOptions({})).toEqual({ kind: "local" });
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
});
