import { describe, expect, it } from "vitest";
import {
  approvalChoices,
  elicitationContent,
  elicitationSchema,
  fieldOptions,
} from "./requestPresentation";

describe("native approval decisions", () => {
  it("uses only the advertised choices and preserves rule amendment payloads", () => {
    const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } };
    expect(
      approvalChoices(["acceptForSession", amendment, "decline"]).map((choice) => choice.decision),
    ).toEqual(["acceptForSession", amendment, "decline"]);
    expect(approvalChoices(["unsupported-decision"])).toEqual([]);
    expect(approvalChoices(undefined).map((choice) => choice.decision)).toEqual([
      "accept",
      "decline",
      "cancel",
    ]);
  });
});

describe("MCP forms", () => {
  it("submits an empty object for an empty tool approval", () => {
    expect(
      elicitationContent(elicitationSchema.parse({ type: "object", properties: {} }), {}),
    ).toEqual({});
  });
  it("requires explicit boolean choices and validates numeric and string boundaries", () => {
    const schema = elicitationSchema.parse({
      type: "object",
      properties: {
        name: { type: "string", minLength: 2 },
        count: { type: "integer", minimum: 1, maximum: 5 },
        enabled: { type: "boolean", default: true },
      },
      required: ["name", "count", "enabled"],
    });
    expect(() => elicitationContent(schema, { name: "ok", count: "2" })).toThrow("enabled");
    expect(elicitationContent(schema, { name: "ok", count: "2", enabled: false })).toEqual({
      name: "ok",
      count: 2,
      enabled: false,
    });
    for (const count of ["0", "6", "2.5", " ", "NaN"])
      expect(() => elicitationContent(schema, { name: "ok", count, enabled: true })).toThrow();
    expect(() => elicitationContent(schema, { name: "a", count: "2", enabled: true })).toThrow(
      "长度",
    );
  });
  it("validates enum values and preserves the server's display labels", () => {
    const schema = elicitationSchema.parse({
      type: "object",
      properties: {
        size: { type: "string", oneOf: [{ const: "small", title: "小" }] },
        roles: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string", enum: ["reader", "writer"] },
        },
      },
      required: ["roles"],
    });
    expect(fieldOptions(schema.properties.size!)).toEqual([{ value: "small", label: "小" }]);
    expect(elicitationContent(schema, { size: "small", roles: ["reader"] })).toEqual({
      size: "small",
      roles: ["reader"],
    });
    expect(() => elicitationContent(schema, { size: "large", roles: ["reader"] })).toThrow(
      "选项无效",
    );
    expect(() => elicitationContent(schema, { roles: [] })).toThrow();
  });
  it("does not silently render unsupported constraints as unrestricted fields", () => {
    expect(
      elicitationSchema.safeParse({
        type: "object",
        properties: { value: { type: "string", pattern: "^a" } },
      }).success,
    ).toBe(false);
  });
});
