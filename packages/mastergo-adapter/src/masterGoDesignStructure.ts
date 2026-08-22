/** 将 MasterGo 专属 DSL 转换为平台无关的设计节点结构证据。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { RawDesignPayload } from "./types.js";

const MAX_STRUCTURE_NODES = 50_000;
const MAX_STRUCTURE_DEPTH = 100;

/** 从已校验的 MasterGo 分段载荷提取受限、可复用的节点树。 */
export function createMasterGoDesignStructure(
  payload: RawDesignPayload,
): D2CAgent.DesignStructureEvidence {
  let visitedNodeCount = 0;
  let truncated = false;
  const roots: D2CAgent.DesignNodeEvidence[] = [];

  const convertNode = (
    value: unknown,
    depth: number,
    originX: number,
    originY: number,
  ): D2CAgent.DesignNodeEvidence | undefined => {
    if (!isRecord(value)) return undefined;
    if (visitedNodeCount >= MAX_STRUCTURE_NODES || depth > MAX_STRUCTURE_DEPTH) {
      truncated = true;
      return undefined;
    }
    const id = readString(value.id);
    if (!id) return undefined;
    visitedNodeCount += 1;
    const layout = isRecord(value.layoutStyle) ? value.layoutStyle : undefined;
    const bounds = createBounds(layout, originX, originY);
    const childOriginX = bounds?.x ?? originX;
    const childOriginY = bounds?.y ?? originY;
    const rawChildren = Array.isArray(value.children) ? value.children : [];
    const children = rawChildren.flatMap((child) => {
      const converted = convertNode(child, depth + 1, childOriginX, childOriginY);
      return converted ? [converted] : [];
    });
    const sourceComponentId = readString(value.componentId);
    const text = value._placeholder === true ? undefined : readNodeText(value.text);
    return {
      id,
      name: readString(value.name) ?? id,
      kind: toDesignNodeKind(readString(value.type)),
      ...(sourceComponentId ? { sourceComponentId } : {}),
      ...(text ? { text } : {}),
      ...(bounds ? { bounds } : {}),
      children,
    };
  };

  const sectionDirectory = Array.isArray(payload.sectionList.sections)
    ? payload.sectionList.sections
    : [];
  for (const [sectionIndex, section] of payload.sections.entries()) {
    const dsl = isRecord(section.dsl) ? section.dsl : undefined;
    const sectionRoots = Array.isArray(dsl?.nodes) ? dsl.nodes : [];
    const directoryEntry = isRecord(sectionDirectory[sectionIndex])
      ? sectionDirectory[sectionIndex]
      : undefined;
    const sectionX = readFiniteNumber(directoryEntry?.x) ?? 0;
    const sectionY = readFiniteNumber(directoryEntry?.y) ?? 0;
    for (const root of sectionRoots) {
      const converted = convertNode(root, 0, sectionX, sectionY);
      if (converted) roots.push(converted);
    }
  }
  return { roots, truncated };
}

/** 将 MasterGo 节点类型折叠为领域层允许的稳定枚举。 */
function toDesignNodeKind(type: string | undefined): D2CAgent.DesignNodeKind {
  switch (type?.toUpperCase()) {
    case "COMPONENT": return "component";
    case "INSTANCE": return "instance";
    case "TEXT": return "text";
    case "FRAME":
    case "GROUP":
    case "LAYER": return "container";
    case "PATH":
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "ELLIPSE":
    case "RECTANGLE": return "vector";
    default: return "unknown";
  }
}

/** 提取存在的有限几何字段，避免传播无效数值。 */
function createBounds(
  value: Record<string, unknown> | undefined,
  originX: number,
  originY: number,
): D2CAgent.DesignNodeBounds | undefined {
  if (!value) return undefined;
  const relativeX = readFiniteNumber(value.relativeX);
  const relativeY = readFiniteNumber(value.relativeY);
  const width = readFiniteNumber(value.width);
  const height = readFiniteNumber(value.height);
  if (relativeX === undefined && relativeY === undefined && width === undefined && height === undefined) return undefined;
  return {
    ...(relativeX !== undefined ? { x: originX + relativeX } : {}),
    ...(relativeY !== undefined ? { y: originY + relativeY } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

/** 合并 MasterGo 文本片段，并拒绝空文本。 */
function readNodeText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((segment) => {
    if (!isRecord(segment)) return [];
    const content = readString(segment.text);
    return content ? [content] : [];
  }).join("").trim();
  return text || undefined;
}

/** 读取非空字符串。 */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 读取有限数值。 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 将未知值收窄为普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
