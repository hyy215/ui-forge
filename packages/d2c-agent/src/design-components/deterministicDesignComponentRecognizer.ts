/** 使用节点结构和可配置目录别名提取非权威设计组件候选。 */

import type { DesignNodeEvidence, DesignStructureEvidence } from "../design-context/designStructure.js";
import type {
  DesignComponentRecognition,
  DesignComponentRecognizer,
  RecognizedDesignComponent,
} from "./designComponentRecognition.js";
import type { ComponentCatalog, ComponentCatalogEntry } from "./componentCatalog.js";

interface ComponentCandidate extends RecognizedDesignComponent {
  sourceComponentId?: string;
}

/** 创建不调用模型的默认设计组件识别器。 */
export function createDeterministicDesignComponentRecognizer(
  _catalog?: ComponentCatalog,
): DesignComponentRecognizer {
  return new DeterministicDesignComponentRecognizer();
}

/** 以目录驱动的弱提示执行可解释候选提取。 */
class DeterministicDesignComponentRecognizer implements DesignComponentRecognizer {
  /** 提取显式组件节点，并从重复行结构补充复合候选。 */
  recognize(structure: DesignStructureEvidence, catalog: ComponentCatalog): DesignComponentRecognition {
    const nodes = flattenNodes(structure.roots);
    const direct = nodes.flatMap((node) => classifyNode(node, catalog.components));
    const table = classifyTable(nodes, catalog.components);
    const components = mergeCandidates(table ? [...direct, table] : direct);
    return {
      status: "recognized",
      components,
      warnings: structure.truncated ? ["设计结构超过安全读取上限，识别结果可能不完整。"] : [],
    };
  }
}

/** 将节点树展开为稳定的先序列表。 */
function flattenNodes(roots: readonly DesignNodeEvidence[]): DesignNodeEvidence[] {
  const result: DesignNodeEvidence[] = [];
  const pending = [...roots].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child) pending.push(child);
    }
  }
  return result;
}

/** 只为证据组合充分的节点创建候选，避免对普通容器过度分类。 */
function classifyNode(
  node: DesignNodeEvidence,
  catalog: readonly ComponentCatalogEntry[],
): ComponentCandidate[] {
  const isSourceComponent = node.kind === "component" || node.kind === "instance";
  if (!isSourceComponent) return [];
  const hint = findCatalogHint(node.name, catalog);
  return [createCandidate(node, hint, [
    "设计源明确标记为组件或实例",
    ...(node.sourceComponentId ? ["设计源提供稳定的来源组件标识"] : []),
    ...(hint ? [`节点名称命中目录别名：${hint.matchedAlias}`] : ["节点名称未命中已配置组件目录"]),
  ])];
}

/** 从表头和重复数据行推导一个表格复合组件。 */
function classifyTable(
  roots: readonly DesignNodeEvidence[],
  catalog: readonly ComponentCatalogEntry[],
): ComponentCandidate | undefined {
  const headerRows = roots.filter((node) => /(?:第一行|表头|header)/i.test(normalizeName(node.name)));
  const dataRows = roots.filter((node) => /(?:第二行|数据行|table row)/i.test(normalizeName(node.name)));
  if (headerRows.length < 1 || dataRows.length < 2) return undefined;
  const tableDefinition = catalog.find((component) => component.id === "table");
  const sourceNodeIds = [...headerRows, ...dataRows].map((node) => node.id);
  return {
    id: `table:${headerRows[0]?.id ?? "root"}`,
    name: "表格",
    sourceNodeIds,
    instanceCount: 1,
    evidenceStrength: "structural",
    ...(tableDefinition ? { typeHint: { typeId: tableDefinition.id, matchedAlias: "重复表格行结构" } } : {}),
    evidence: [
      "检测到表头行",
      `检测到 ${dataRows.length} 个重复数据行`,
    ],
  };
}

/** 将节点及规则证据转换为统一候选。 */
function createCandidate(
  node: DesignNodeEvidence,
  hint: { typeId: string; matchedAlias: string } | undefined,
  evidence: string[],
): ComponentCandidate {
  return {
    id: `component:${node.sourceComponentId ?? node.id}`,
    name: node.name,
    sourceNodeIds: [node.id],
    instanceCount: node.kind === "component" ? 0 : 1,
    evidence,
    evidenceStrength: node.sourceComponentId ? "explicit" : "weak",
    ...(hint ? { typeHint: hint } : {}),
    ...(node.sourceComponentId ? { sourceComponentId: node.sourceComponentId } : {}),
  };
}

/** 按组件来源和语义合并定义及实例，同时保留最高置信度。 */
function mergeCandidates(candidates: readonly ComponentCandidate[]): RecognizedDesignComponent[] {
  const merged = new Map<string, ComponentCandidate>();
  for (const candidate of candidates) {
    const key = candidate.id;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, structuredClone(candidate));
      continue;
    }
    current.sourceNodeIds = [...new Set([...current.sourceNodeIds, ...candidate.sourceNodeIds])];
    current.instanceCount += candidate.instanceCount;
    current.evidence = [...new Set([...current.evidence, ...candidate.evidence])];
  }
  return [...merged.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ sourceComponentId: _sourceComponentId, ...component }) => component);
}

/** 统一名称空白与大小写比较前的格式。 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** 使用转义后的纯文本别名匹配节点名称，不把用户配置解释为正则表达式。 */
function findCatalogHint(
  name: string,
  catalog: readonly ComponentCatalogEntry[],
): { typeId: string; matchedAlias: string } | undefined {
  const normalized = normalizeName(name).toLocaleLowerCase();
  for (const component of catalog) {
    for (const alias of [component.name, ...component.aliases]) {
      if (normalized.includes(normalizeName(alias).toLocaleLowerCase())) {
        return { typeId: component.id, matchedAlias: alias };
      }
    }
  }
  return undefined;
}
