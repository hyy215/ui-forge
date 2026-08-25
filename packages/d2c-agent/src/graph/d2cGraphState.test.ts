import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const graphDirectory = dirname(fileURLToPath(import.meta.url));

describe("D2C graph authoritative state boundary", () => {
  it("keeps the graph state private to the graph package", () => {
    const facade = readFileSync(join(graphDirectory, "..", "d2cAgent.ts"), "utf8");
    expect(facade).not.toContain("D2CGraphState");
  });

  it("documents D2CTask as durable state and graph outputs as transient execution context", () => {
    const source = readFileSync(join(graphDirectory, "d2cGraphState.ts"), "utf8");
    expect(source).toContain("D2CTask");
    expect(source).toContain("权威");
    expect(source).toContain("临时");
  });
});
