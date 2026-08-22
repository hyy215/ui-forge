/** 验证仓库分析器只读取受控源码并生成组件、样式和反向依赖证据。 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API as TypeScriptApi } from "typescript/unstable/sync";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSystemProjectContextAnalyzer } from "./fileSystemProjectContextAnalyzer.js";

const temporaryDirectories: string[] = [];

describe("FileSystemProjectContextAnalyzer", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("extracts exported component structure, props, styles and consumers", async () => {
    const projectRoot = await createProject();
    const sourceRoot = join(projectRoot, "src");
    await writeFile(join(sourceRoot, "CustomerTable.tsx"), `
      import { Table } from "antd";
      import "./CustomerTable.css";
      export interface CustomerTableProps { rows: string[]; loading?: boolean }
      export function CustomerTable(props: CustomerTableProps) {
        const color = token.colorPrimary;
        return <Table dataSource={props.rows} />;
      }
    `);
    await writeFile(join(sourceRoot, "Page.tsx"), `
      import { CustomerTable } from "./CustomerTable";
      export function CustomerPage() { return <CustomerTable rows={[]} />; }
    `);
    await writeFile(join(sourceRoot, "CustomerTable.css"), ":root { --table-gap: 8px; }");

    const result = await new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: {
        status: "recognized",
        components: [{
          id: "design-table", name: "CustomerTable", sourceNodeIds: ["node-1"], instanceCount: 1,
          evidence: ["设计源组件"], evidenceStrength: "explicit", typeHint: { typeId: "table", matchedAlias: "Table" },
        }],
        warnings: [],
      },
    });

    expect(result.kind).toBe("react_antd");
    expect(result.matches[0]).toMatchObject({
      designCandidateId: "design-table",
      component: {
        name: "CustomerTable",
        sourcePath: "src/CustomerTable.tsx",
        props: ["rows", "loading"],
        composition: ["Table"],
        styleFiles: ["./CustomerTable.css"],
        consumers: ["src/Page.tsx"],
      },
    });
  });

  it("returns initialization context for an empty project without reading files", async () => {
    const projectRoot = await createProject();
    await expect(new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "empty", projectRoot },
      recognition: { status: "recognized", components: [], warnings: [] },
    })).resolves.toEqual({ kind: "empty", files: [], filesComplete: true, matches: [], warnings: [] });
  });

  it("ignores symbolic-link source entries", async () => {
    const projectRoot = await createProject();
    const outside = join(projectRoot, "outside.tsx");
    await writeFile(outside, "export function SecretComponent() { return null; }");
    await symlink(outside, join(projectRoot, "src", "Linked.tsx"));
    const result = await new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: { status: "recognized", components: [], warnings: [] },
    });
    expect(result.files).not.toContain("src/Linked.tsx");
  });

  it("excludes oversized sources before creating the TypeScript snapshot", async () => {
    const projectRoot = await createProject();
    const oversizedPath = join(projectRoot, "src", "Oversized.tsx");
    await writeFile(oversizedPath, `export function Oversized() { return <div />; }/*${"x".repeat(512 * 1024)}*/`);
    const updateSnapshot = vi.spyOn(TypeScriptApi.prototype, "updateSnapshot");

    const result = await new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: { status: "recognized", components: [], warnings: [] },
    });

    expect(result.files).toContain("src/Oversized.tsx");
    expect(updateSnapshot.mock.calls[0]?.[0]).toMatchObject({ openFiles: [] });
  });

  it("does not index ordinary PascalCase exports as React components", async () => {
    const projectRoot = await createProject();
    await writeFile(join(projectRoot, "src", "Utilities.tsx"), `
      export class ApiClient { request() { return "ok"; } }
      export function CustomerTableParser() { return "parsed"; }
      export const FormatRows = (rows: string[]) => rows.join(",");
    `);

    const result = await new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: {
        status: "recognized",
        components: ["ApiClient", "CustomerTableParser", "FormatRows"].map((name) => ({
          id: `design:${name}`, name, sourceNodeIds: [name], instanceCount: 1,
          evidence: ["设计候选"], evidenceStrength: "weak" as const,
        })),
        warnings: [],
      },
    });

    expect(result.matches).toEqual([]);
  });

  it("keeps JSX composition scoped to each exported component", async () => {
    const projectRoot = await createProject();
    await writeFile(join(projectRoot, "src", "CustomerWidgets.tsx"), `
      import { Select, Table } from "antd";
      export function CustomerTable() { return <Table />; }
      export const CustomerFilter = () => <Select />;
    `);

    const result = await new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: {
        status: "recognized",
        components: ["CustomerTable", "CustomerFilter"].map((name) => ({
          id: `design:${name}`, name, sourceNodeIds: [name], instanceCount: 1,
          evidence: ["设计候选"], evidenceStrength: "explicit" as const,
        })),
        warnings: [],
      },
    });

    expect(result.matches.find((match) => match.designCandidateId === "design:CustomerTable")
      ?.component.composition).toEqual(["Table"]);
    expect(result.matches.find((match) => match.designCandidateId === "design:CustomerFilter")
      ?.component.composition).toEqual(["Select"]);
  });

  it("rejects an already-aborted repository analysis", async () => {
    const projectRoot = await createProject();
    const controller = new AbortController();
    controller.abort();

    await expect(new FileSystemProjectContextAnalyzer().analyze({
      inspection: { kind: "react_antd", projectRoot, packageJsonPath: join(projectRoot, "package.json") },
      recognition: { status: "recognized", components: [], warnings: [] },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});

/** 创建具有最小配置和源码目录的临时 React 项目。 */
async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "ui-forge-project-context-"));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "src"));
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ dependencies: { react: "19", antd: "6" } }));
  await writeFile(join(projectRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: { jsx: "react-jsx", module: "ESNext", target: "ES2022" },
    include: ["src"],
  }));
  return projectRoot;
}
