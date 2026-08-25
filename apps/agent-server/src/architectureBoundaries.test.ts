import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(srcRoot, "..");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });
}

function importedSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => Boolean(specifier));
}

const compositionRoot = "src/d2c/createD2CWorkflowService.ts";
const infrastructurePackages = [
  "@ui-forge/component-indexer",
  "@ui-forge/d2c-storage",
  "@ui-forge/design-system-adapter",
  "@ui-forge/mastergo-adapter",
  "@langchain/langgraph",
  "@langchain/langgraph-checkpoint-postgres",
];

describe("agent-server architecture boundaries", () => {
  it("keeps D2C infrastructure construction inside the composition root", () => {
    const violations = listSourceFiles(srcRoot).flatMap((path) => {
      const localPath = relative(serverRoot, path).replaceAll("\\", "/");
      if (localPath === compositionRoot) return [];
      const imports = importedSpecifiers(readFileSync(path, "utf8"));
      return imports
        .filter((specifier) => infrastructurePackages.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`)))
        .map((specifier) => `${localPath} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps HTTP transport independent from the D2C domain package", () => {
    const httpRoot = join(srcRoot, "http");
    const violations = listSourceFiles(httpRoot).flatMap((path) => importedSpecifiers(readFileSync(path, "utf8"))
      .filter((specifier) => specifier === "@ui-forge/d2c-agent" || specifier.startsWith("@ui-forge/d2c-agent/"))
      .map((specifier) => `${relative(serverRoot, path)} -> ${specifier}`));

    expect(violations).toEqual([]);
  });
});
