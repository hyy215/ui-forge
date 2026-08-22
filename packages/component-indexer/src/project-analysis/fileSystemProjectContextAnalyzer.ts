/** 从任务绑定的 React 项目生成有界组件索引、样式摘要和反向依赖证据。 */

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { API as TypeScriptApi } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";

const ignoredDirectories = new Set([".git", ".ui-forge", "node_modules", "dist", "build", "coverage", ".next"]);
const sourceExtensions = new Set([".ts", ".tsx"]);
const styleExtensions = new Set([".css", ".less", ".scss", ".sass"]);
const maximumFiles = 500;
const maximumSourceBytes = 512 * 1024;
const maximumDepth = 12;
const maximumMatchesPerCandidate = 5;

interface IndexedSource {
  path: string;
  imports: string[];
  components: Omit<D2CAgent.RepositoryComponentEvidence, "consumers">[];
}

/** 使用受限文件系统读取和 TypeScript AST 构建仓库规划证据。 */
export class FileSystemProjectContextAnalyzer implements D2CAgent.ProjectContextAnalyzer {
  /** 对空项目返回初始化上下文，对已支持项目生成有限组件检索结果。 */
  async analyze(input: {
    inspection: Exclude<D2CAgent.ProjectInspection, { kind: "unsupported" }>;
    recognition: D2CAgent.DesignComponentRecognition;
    signal?: AbortSignal;
  }): Promise<D2CAgent.ProjectContextAnalysis> {
    throwIfAborted(input.signal);
    if (input.inspection.kind === "empty") {
      return { kind: "empty", files: [], filesComplete: true, matches: [], warnings: [] };
    }
    const projectRoot = await realpath(input.inspection.projectRoot);
    const scan = await collectProjectFiles(projectRoot, input.signal);
    throwIfAborted(input.signal);
    const compilerApi = new TypeScriptApi();
    const safeSourceFiles = await filterSafeSourceFiles(projectRoot, scan.sourceFiles, input.signal);
    const absoluteSourceFiles = safeSourceFiles.map((path) => resolve(projectRoot, path));
    const snapshot = compilerApi.updateSnapshot({ openFiles: absoluteSourceFiles });
    let sources: IndexedSource[];
    try {
      sources = await Promise.all(safeSourceFiles.map((path) => {
        const absolutePath = resolve(projectRoot, path);
        const sourceFile = snapshot.getDefaultProjectForFile(absolutePath)?.program.getSourceFile(absolutePath);
        return indexSourceFile(projectRoot, path, sourceFile, input.signal);
      }));
    } finally {
      snapshot.dispose();
      compilerApi.close();
    }
    throwIfAborted(input.signal);
    const consumers = createConsumerIndex(sources, new Set(scan.sourceFiles));
    const components = sources.flatMap((source) => source.components.map((component) => ({
      ...component,
      consumers: [...(consumers.get(source.path) ?? [])].sort(),
    })));
    return {
      kind: "react_antd",
      files: [...scan.allFiles].sort(),
      filesComplete: !scan.truncated,
      matches: createMatches(input.recognition, components),
      warnings: scan.truncated ? [`仓库扫描达到 ${maximumFiles} 个文件上限，检索证据可能不完整。`] : [],
    };
  }
}

/** 在交给 TypeScript 编译器前排除符号链接、非普通文件、越界路径和超限源码。 */
async function filterSafeSourceFiles(
  projectRoot: string,
  sourceFiles: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const safeFiles: string[] = [];
  for (const sourcePath of sourceFiles) {
    throwIfAborted(signal);
    const absolutePath = resolve(projectRoot, sourcePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximumSourceBytes) continue;
    const resolvedPath = await realpath(absolutePath);
    if (resolvedPath !== absolutePath || !isWithinProject(projectRoot, resolvedPath)) continue;
    safeFiles.push(sourcePath);
  }
  return safeFiles;
}

/** 判断真实路径仍位于任务绑定项目根目录内。 */
function isWithinProject(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

/** 递归收集允许扩展名的普通文件，并拒绝通过符号链接扩大读取范围。 */
async function collectProjectFiles(projectRoot: string, signal?: AbortSignal): Promise<{
  allFiles: string[];
  sourceFiles: string[];
  truncated: boolean;
}> {
  const allFiles: string[] = [];
  const sourceFiles: string[] = [];
  const pending: Array<{ absolutePath: string; depth: number }> = [{ absolutePath: projectRoot, depth: 0 }];
  let truncated = false;
  while (pending.length > 0) {
    throwIfAborted(signal);
    const current = pending.pop();
    if (!current) continue;
    const entries = await readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (allFiles.length >= maximumFiles) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && current.depth < maximumDepth) {
          pending.push({ absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = normalizeRelativePath(relative(projectRoot, absolutePath));
      allFiles.push(normalized);
      if (sourceExtensions.has(extname(entry.name))) sourceFiles.push(normalized);
    }
    if (truncated) break;
  }
  return { allFiles, sourceFiles, truncated };
}

/** 解析一个受限大小的 TypeScript 源文件并提取组件、导入和样式结构。 */
async function indexSourceFile(
  projectRoot: string,
  sourcePath: string,
  sourceFile: ts.SourceFile | undefined,
  signal?: AbortSignal,
): Promise<IndexedSource> {
  throwIfAborted(signal);
  const absolutePath = resolve(projectRoot, sourcePath);
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximumSourceBytes) {
    return { path: sourcePath, imports: [], components: [] };
  }
  const text = await readFile(absolutePath, "utf8");
  throwIfAborted(signal);
  if (!sourceFile) return { path: sourcePath, imports: [], components: [] };
  const imports = readImports(sourceFile);
  const styleFiles = imports.filter((value) => styleExtensions.has(extname(value)));
  const propsByType = readDeclaredProps(sourceFile);
  const tokens = readStyleTokens(text);
  return {
    path: sourcePath,
    imports: imports.filter((value) => value.startsWith(".")),
    components: readExportedComponents(sourceFile).map((component) => ({
      id: `${sourcePath}#${component.name}`,
      name: component.name,
      sourcePath,
      exportName: component.name,
      props: component.propsType ? (propsByType.get(component.propsType) ?? [component.propsType]) : [],
      composition: component.composition,
      styleFiles,
      tokens,
    })),
  };
}

/** 提取 ES Module 导入说明符。 */
function readImports(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : []);
}

/** 收集单个组件声明 JSX 中使用的直接元素或组合组件名称。 */
function readJsxComposition(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) names.add(node.tagName.getText(sourceFile));
    node.forEachChild(visit);
  };
  visit(node);
  return [...names].sort();
}

/** 建立本文件中接口或类型字面量的属性名称摘要。 */
function readDeclaredProps(sourceFile: ts.SourceFile): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      result.set(statement.name.text, statement.members.flatMap(readPropertyName));
    } else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      result.set(statement.name.text, statement.type.members.flatMap(readPropertyName));
    }
  }
  return result;
}

/** 将公开属性签名裁剪为名称列表。 */
function readPropertyName(member: ts.TypeElement): string[] {
  if (!ts.isPropertySignatureDeclaration(member) || !member.name) return [];
  return [member.name.getText().replace(/["']/g, "")];
}

/** 找出具有 React 渲染证据的导出组件及其局部 JSX 组合。 */
function readExportedComponents(sourceFile: ts.SourceFile): Array<{
  name: string;
  propsType?: string;
  composition: string[];
}> {
  const result: Array<{ name: string; propsType?: string; composition: string[] }> = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name
      && isComponentName(statement.name.text) && containsReactRenderEvidence(statement, sourceFile)) {
      const parameter = statement.parameters[0];
      result.push({
        name: statement.name.text,
        ...(parameter?.type ? { propsType: parameter.type.getText(sourceFile) } : {}),
        composition: readJsxComposition(statement, sourceFile),
      });
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name
      && isComponentName(statement.name.text) && isReactComponentClass(statement, sourceFile)) {
      result.push({
        name: statement.name.text,
        composition: readJsxComposition(statement, sourceFile),
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isComponentName(declaration.name.text)
          && isReactComponentVariable(declaration, sourceFile)) {
          const initializer = declaration.initializer;
          const parameter = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            ? initializer.parameters[0] : undefined;
          result.push({
            name: declaration.name.text,
            ...(parameter?.type ? { propsType: parameter.type.getText(sourceFile) } : {}),
            composition: readJsxComposition(declaration, sourceFile),
          });
        }
      }
    }
  }
  return result;
}

/** 判断类声明是否明确继承 React 组件基类。 */
function isReactComponentClass(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): boolean {
  return (node.heritageClauses ?? []).some((clause) => clause.types.some((type) =>
    /^(?:React\.)?(?:Component|PureComponent)$/.test(type.expression.getText(sourceFile))));
}

/** 判断变量声明是否带有 JSX、React 工厂、组件类型或标准包装器证据。 */
function isReactComponentVariable(node: ts.VariableDeclaration, sourceFile: ts.SourceFile): boolean {
  const typeText = node.type?.getText(sourceFile) ?? "";
  if (/^(?:React\.)?(?:FC|FunctionComponent|ComponentType)(?:<|$)/.test(typeText)) return true;
  const initializer = node.initializer;
  if (!initializer) return false;
  if (containsReactRenderEvidence(initializer, sourceFile)) return true;
  if (!ts.isCallExpression(initializer)) return false;
  return /^(?:React\.)?(?:memo|forwardRef)$/.test(initializer.expression.getText(sourceFile));
}

/** 查找 JSX 或 React.createElement 形式的真实渲染证据。 */
function containsReactRenderEvidence(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(current)
      && /^(?:React\.)?createElement$/.test(current.expression.getText(sourceFile))) {
      found = true;
      return;
    }
    current.forEachChild(visit);
  };
  visit(node);
  return found;
}

/** 判断声明是否通过 export 修饰符公开。 */
function hasExportModifier(node: ts.Node): boolean {
  return /^\s*export\b/.test(node.getFullText());
}

/** 使用 React 社区约定识别可能的组件名称。 */
function isComponentName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

/** 从源码中提取 Ant Design Token 或 CSS 自定义变量引用。 */
function readStyleTokens(text: string): string[] {
  const matches = text.matchAll(/(?:token\.([A-Za-z0-9]+)|var\((--[A-Za-z0-9-_]+)\))/g);
  return [...new Set([...matches].map((match) => match[1] ?? match[2]).filter((value): value is string => Boolean(value)))].sort();
}

/** 根据相对导入建立每个源码文件的反向消费者索引。 */
function createConsumerIndex(sources: IndexedSource[], sourcePaths: Set<string>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const specifier of source.imports) {
      const target = resolveSourceImport(source.path, specifier, sourcePaths);
      if (!target) continue;
      const values = result.get(target) ?? new Set<string>();
      values.add(source.path);
      result.set(target, values);
    }
  }
  return result;
}

/** 将本地模块说明符解析到已扫描的源码集合。 */
function resolveSourceImport(importer: string, specifier: string, sourcePaths: Set<string>): string | undefined {
  const base = normalizeRelativePath(join(dirname(importer), specifier));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (sourcePaths.has(candidate)) return candidate;
  }
  return undefined;
}

/** 为每个设计候选返回少量按名称、关键词和组合关系排序的仓库组件。 */
function createMatches(
  recognition: D2CAgent.DesignComponentRecognition,
  components: D2CAgent.RepositoryComponentEvidence[],
): D2CAgent.RepositoryComponentMatch[] {
  return recognition.components.flatMap((candidate) => components
    .map((component) => scoreMatch(candidate, component))
    .filter((value): value is D2CAgent.RepositoryComponentMatch => value !== undefined)
    .sort((left, right) => right.score - left.score || left.component.id.localeCompare(right.component.id))
    .slice(0, maximumMatchesPerCandidate));
}

/** 计算不依赖模型的轻量语义与 JSX 组合检索分数。 */
function scoreMatch(
  candidate: D2CAgent.RecognizedDesignComponent,
  component: D2CAgent.RepositoryComponentEvidence,
): D2CAgent.RepositoryComponentMatch | undefined {
  const terms = [candidate.name, candidate.typeHint?.typeId, candidate.effectiveTypeId]
    .filter((value): value is string => Boolean(value)).map(normalizeSearchText);
  const componentName = normalizeSearchText(component.name);
  const composition = component.composition.map(normalizeSearchText);
  const matchedBy = new Set<"name" | "keyword" | "composition">();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (componentName === term) {
      score = Math.max(score, 1);
      matchedBy.add("name");
    } else if (componentName.includes(term) || term.includes(componentName)) {
      score = Math.max(score, 0.75);
      matchedBy.add("keyword");
    }
    if (composition.some((value) => value.includes(term) || term.includes(value))) {
      score = Math.max(score, 0.5);
      matchedBy.add("composition");
    }
  }
  if (score === 0) return undefined;
  return { designCandidateId: candidate.id, component: structuredClone(component), score, matchedBy: [...matchedBy] };
}

/** 统一跨平台相对路径为协议和模型可消费的 POSIX 形式。 */
function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

/** 归一化组件检索关键词并保留中日韩文字。 */
function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_./-]+/g, "");
}

/** 在受控扫描边界响应任务取消。 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("目标仓库分析已由用户终止。", "AbortError");
}
