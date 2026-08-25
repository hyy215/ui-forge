import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(packageRoot, "src");
const packageJsonPath = join(packageRoot, "package.json");

const forbiddenPackageDependencies = [
  "@ui-forge/component-indexer",
  "@ui-forge/d2c-storage",
  "@ui-forge/design-system-adapter",
  "@ui-forge/mastergo-adapter",
  "@ui-forge/shared-protocol",
  "@langchain/langgraph",
  "@langchain/langgraph-checkpoint-postgres",
  "fastify",
  "sharp",
  "vscode",
];

const forbiddenSourceImports = [
  "@ui-forge/component-indexer",
  "@ui-forge/d2c-storage",
  "@ui-forge/design-system-adapter",
  "@ui-forge/mastergo-adapter",
  "@ui-forge/shared-protocol",
  "@langchain/",
  "fastify",
  "sharp",
  "vscode",
];

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

describe("d2c-agent architecture boundaries", () => {
  it("keeps concrete adapters and host infrastructure out of package dependencies", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    expect(Object.keys(dependencies).filter((name) => forbiddenPackageDependencies.includes(name))).toEqual([]);
  });

  it("keeps source imports pointed at domain ports and agent-core instead of concrete adapters", () => {
    const violations = listSourceFiles(srcRoot).flatMap((path) => {
      const imports = importedSpecifiers(readFileSync(path, "utf8"));
      return imports
        .filter((specifier) => forbiddenSourceImports.some((prefix) => specifier === prefix || specifier.startsWith(prefix)))
        .map((specifier) => `${relative(packageRoot, path)} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});
