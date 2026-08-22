/** 将 MasterGo 原始响应整理为通用、可按 Section 读取的设计 Artifact。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { createMasterGoDesignStructure } from "./masterGoDesignStructure.js";
import type { RawDesignPayload } from "./types.js";

/** 保存 MasterGo 分段目录和逐段 DSL，并返回可放入 D2C 状态的轻量引用。 */
export async function writeMasterGoDesignArtifact(
  writer: D2CAgent.DesignArtifactWriter | undefined,
  payload: RawDesignPayload,
  context: D2CAgent.DesignContext,
): Promise<D2CAgent.DesignArtifactReference | undefined> {
  if (!writer) return undefined;
  return writer.write({
    source: context.source,
    name: context.name,
    nodeCount: context.nodeCount,
    regions: context.regions,
    tokens: context.tokens,
    structure: createMasterGoDesignStructure(payload),
    sections: [
      { id: "section-list", label: "Section List", data: payload.sectionList },
      ...payload.sections.map((section, index) => ({
        id: `section-${index}`,
        label: `Section ${index}`,
        data: section,
      })),
    ],
  });
}
