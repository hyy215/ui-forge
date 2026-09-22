import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMagicConnection, checkVibeConnection } from "@ui-forge/codex-client";
import type { DesignSource } from "@ui-forge/shared-protocol";
import { checkDesignConnection } from "./checkDesignConnection.js";

vi.mock("@ui-forge/codex-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ui-forge/codex-client")>()),
  checkMagicConnection: vi.fn(),
  checkVibeConnection: vi.fn(),
}));

const vibe: DesignSource = {
  kind: "mastergo",
  url: "https://mastergo.com/file/document?layer_id=1%3A2",
  connection: {
    kind: "vibe",
    endpoint: "http://127.0.0.1:20678/mcp",
    statusEndpoint: "http://127.0.0.1:30678/api/status",
  },
};
beforeEach(() => vi.resetAllMocks());

describe("read-only design connection checks", () => {
  it("does not contact a design platform for local input", async () => {
    expect(await checkDesignConnection({ kind: "local" })).toEqual({
      source: { kind: "local" },
      tools: [],
    });
    expect(checkMagicConnection).not.toHaveBeenCalled();
    expect(checkVibeConnection).not.toHaveBeenCalled();
  });

  it("returns only the selected Magic source, parsed target and public tool metadata", async () => {
    vi.mocked(checkMagicConnection).mockResolvedValue({
      serverName: "server-name-not-exposed",
      serverVersion: "1.0",
      tools: ["read_design"],
    });
    const source: DesignSource = { ...vibe, connection: { kind: "magic" } };
    expect(await checkDesignConnection(source)).toEqual({
      source,
      target: { documentId: "document", nodeId: "1:2" },
      tools: ["read_design"],
      serverVersion: "1.0",
    });
    expect(checkVibeConnection).not.toHaveBeenCalled();
  });

  it("freezes a missing page from the current Vibe status without returning other metadata", async () => {
    vi.mocked(checkVibeConnection).mockResolvedValue({
      documentId: "document",
      pageId: "page",
      serverName: "server-name-not-exposed",
      serverVersion: "1.0",
      tools: ["get_node"],
    });
    expect(await checkDesignConnection(vibe)).toEqual({
      source: vibe,
      target: { documentId: "document", pageId: "page", nodeId: "1:2" },
      tools: ["get_node"],
      serverVersion: "1.0",
    });
    expect(checkVibeConnection).toHaveBeenCalledExactlyOnceWith(vibe.connection);
    expect(checkMagicConnection).not.toHaveBeenCalled();
  });

  it("keeps Magic file-only links compatible without inventing a target", async () => {
    vi.mocked(checkMagicConnection).mockResolvedValue({
      serverName: "Magic",
      serverVersion: "1.0",
      tools: [],
    });
    const source: DesignSource = {
      kind: "mastergo",
      url: "https://mastergo.com/file/document",
      connection: { kind: "magic" },
    };
    expect(await checkDesignConnection(source)).toEqual({
      source,
      tools: [],
      serverVersion: "1.0",
    });
    expect(checkVibeConnection).not.toHaveBeenCalled();
  });

  it.each([
    { documentId: "other-document", pageId: "page" },
    { documentId: "document", pageId: "other-page" },
  ])("rejects a mismatched Vibe canvas: %j", async (target) => {
    vi.mocked(checkVibeConnection).mockResolvedValue({
      ...target,
      serverName: "Vibe",
      serverVersion: "1.0",
      tools: [],
    });
    await expect(
      checkDesignConnection({ ...vibe, url: `${vibe.url}&page_id=page` }),
    ).rejects.toThrow("不一致");
  });

  it("rejects unsafe connection input before any platform call", async () => {
    await expect(
      checkDesignConnection({
        ...vibe,
        connection: { ...vibe.connection, kind: "vibe", endpoint: "http://external.example/mcp" },
      }),
    ).rejects.toThrow();
    expect(checkVibeConnection).not.toHaveBeenCalled();
    expect(checkMagicConnection).not.toHaveBeenCalled();
  });
});
