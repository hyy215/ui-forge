import { describe, expect, it } from "vitest";
import { defaultVibeEndpoint, defaultVibeStatusEndpoint } from "@ui-forge/shared-protocol";
import { readDesignSource, type MasterGoDraft } from "./designInput";

const draft: MasterGoDraft = {
  url: "https://mastergo.com/file/file?layer_id=2:3",
  connection: null,
  endpoint: defaultVibeEndpoint,
  statusEndpoint: defaultVibeStatusEndpoint,
};

describe("design input", () => {
  it("keeps local independent of platform drafts", () => {
    expect(readDesignSource("local", draft)).toEqual({ kind: "local" });
  });
  it("requires an explicit MasterGo connection", () => {
    expect(() => readDesignSource("mastergo", draft)).toThrow("请选择");
  });
  it("does not send Vibe settings for Magic", () => {
    expect(readDesignSource("mastergo", { ...draft, connection: "magic" })).toEqual({
      kind: "mastergo",
      url: draft.url,
      connection: { kind: "magic" },
    });
  });
  it("only accepts MasterGo links and loopback Vibe addresses", () => {
    expect(() =>
      readDesignSource("mastergo", {
        ...draft,
        connection: "vibe",
        endpoint: "https://example.com/mcp",
      }),
    ).toThrow("本机");
    expect(() =>
      readDesignSource("mastergo", {
        ...draft,
        connection: "magic",
        url: "https://figma.com/design/file",
      }),
    ).toThrow("MasterGo HTTPS");
    expect(readDesignSource("mastergo", { ...draft, connection: "vibe" })).toMatchObject({
      connection: { endpoint: defaultVibeEndpoint, statusEndpoint: defaultVibeStatusEndpoint },
    });
  });
});
