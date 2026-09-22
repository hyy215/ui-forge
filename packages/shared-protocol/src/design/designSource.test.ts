import { describe, expect, it } from "vitest";
import {
  checkDesignConnectionSchema,
  designBindingSchema,
  designConnectionCheckSchema,
  designSourceSchema,
  localDesignEndpointSchema,
} from "./designSource.js";
import { createSessionSchema, taskHistoryEntrySchema } from "../sessions/sessionProtocol.js";

const url = "https://mastergo.com/file/example?layer_id=1:2&page_id=1:0";
const vibe = { kind: "mastergo", url, connection: { kind: "vibe" } };
const bindingId = "a0000000-0000-4000-8000-000000000001";

describe("design source contract", () => {
  it("separates platforms from connections and requires an explicit MasterGo choice", () => {
    expect(designSourceSchema.parse({ kind: "local" })).toEqual({ kind: "local" });
    expect(designSourceSchema.parse(vibe)).toMatchObject({
      connection: {
        kind: "vibe",
        endpoint: "http://127.0.0.1:20678/mcp",
        statusEndpoint: "http://127.0.0.1:30678/api/status",
      },
    });
    expect(
      designSourceSchema.parse({ kind: "mastergo", url, connection: { kind: "magic" } }),
    ).toMatchObject({ connection: { kind: "magic" } });
    for (const value of [
      { kind: "mastergo", url },
      { kind: "vibe" },
      { kind: "figma", url },
      { kind: "local", url },
      { kind: "local", connection: { kind: "magic" } },
      { kind: "mastergo", url, connection: { kind: "magic", endpoint: "http://127.0.0.1/mcp" } },
      { ...vibe, connection: { kind: "vibe", token: "secret" } },
    ])
      expect(designSourceSchema.safeParse(value).success).toBe(false);
  });

  it("rejects malformed, nonlocal and credential-bearing endpoints without throwing", () => {
    for (const endpoint of [
      "not a url",
      "",
      "https://127.0.0.1/mcp",
      "http://example.com/mcp",
      "http://127.0.0.1.evil.test/mcp",
      "http://user:secret@localhost/mcp",
      "http://localhost/mcp?token=secret",
      "http://localhost/mcp#fragment",
      "file:///tmp/mcp",
    ]) {
      expect(localDesignEndpointSchema.safeParse(endpoint).success, endpoint).toBe(false);
    }
    for (const endpoint of [
      "http://localhost:20678/mcp",
      "http://127.0.0.1:20678/mcp",
      "http://[::1]:20678/mcp",
    ]) {
      expect(localDesignEndpointSchema.safeParse(endpoint).success).toBe(true);
    }
    for (const invalidUrl of [
      "not a url",
      "https://mastergo.com.evil.test/file/a",
      "https://custom.mastergo.com/file/a",
      "http://mastergo.com/file/a",
      "https://secret@mastergo.com/file/a",
    ]) {
      expect(designSourceSchema.safeParse({ ...vibe, url: invalidUrl }).success).toBe(false);
    }
  });

  it("requires stable Vibe identities while preserving old history records", () => {
    const binding = {
      bindingId,
      source: vibe,
      target: { documentId: "doc", pageId: "1:0", nodeId: "1:2" },
    };
    expect(designBindingSchema.safeParse(binding).success).toBe(true);
    expect(
      designBindingSchema.safeParse({ ...binding, target: { documentId: "doc", nodeId: "1:2" } })
        .success,
    ).toBe(false);
    expect(designBindingSchema.safeParse({ ...binding, source: { kind: "local" } }).success).toBe(
      false,
    );
    expect(designBindingSchema.safeParse({ ...binding, bindingId: "arbitrary" }).success).toBe(
      false,
    );
    expect(
      taskHistoryEntrySchema.safeParse({
        taskId: "old",
        projectPath: "/target",
        title: "old",
        updatedAt: "2026-09-20",
      }).success,
    ).toBe(true);
  });

  it("defaults new image/text tasks to local and accepts an explicit design-link task", () => {
    expect(
      createSessionSchema.parse({ projectPath: "/target", prompt: "build" }).designSource,
    ).toEqual({ kind: "local" });
    expect(createSessionSchema.safeParse({ projectPath: "/target", prompt: "" }).success).toBe(
      false,
    );
    expect(
      createSessionSchema.safeParse({ projectPath: "/target", prompt: "", designSource: vibe })
        .success,
    ).toBe(true);
  });

  it("keeps connection checks and responses within the public whitelist", () => {
    expect(checkDesignConnectionSchema.safeParse({ source: vibe, command: "run" }).success).toBe(
      false,
    );
    expect(
      designConnectionCheckSchema.safeParse({
        source: { kind: "local" },
        tools: [],
        token: "secret",
      }).success,
    ).toBe(false);
    expect(
      designConnectionCheckSchema.safeParse({ source: { kind: "local" }, tools: [] }).success,
    ).toBe(true);
  });
});
