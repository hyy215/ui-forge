/** 按权威任务所有权读取交付验收图片，并投影为有大小上限的 PNG Data URL。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import type { DeliveryEvidenceImage } from "@ui-forge/shared-protocol";

/** 配置交付验收证据查询所需的权威任务和二进制存储端口。 */
export interface D2CDeliveryEvidenceQueryServiceOptions {
  service: D2CAgent.Service;
  deliveryEvidenceStore?: D2CAgent.DeliveryEvidenceStore;
}

/** 只允许读取当前任务结果明确引用的验收图片。 */
export class D2CDeliveryEvidenceQueryService {
  /** 保存任务与存储依赖，不维护第二份所有权状态。 */
  constructor(private readonly options: D2CDeliveryEvidenceQueryServiceOptions) {}

  /** 回查权威任务引用后读取并编码一张 PNG。 */
  async get(taskId: string, evidenceId: string): Promise<DeliveryEvidenceImage> {
    const store = this.options.deliveryEvidenceStore;
    if (!store) throw new Error("当前运行环境未配置交付验收证据存储。");
    const task = await this.options.service.getTask(taskId);
    const references = collectEvidenceReferences(task.deliveryValidation);
    const expected = references.find((reference) => reference.evidenceId === evidenceId);
    if (!expected) throw new Error("当前任务没有引用指定的交付验收证据。");
    const stored = await store.read(taskId, evidenceId);
    if (stored.reference.sha256 !== expected.sha256
      || stored.reference.byteSize !== expected.byteSize
      || stored.reference.kind !== expected.kind) {
      throw new Error("交付验收证据与权威任务引用不一致。");
    }
    return {
      reference: structuredClone(stored.reference),
      dataUrl: `data:image/png;base64,${Buffer.from(stored.data).toString("base64")}`,
    };
  }
}

/** 从通过或阻塞结论中收集当前仍由任务拥有的图片引用。 */
function collectEvidenceReferences(
  outcome: D2CAgent.ProjectDeliveryValidationOutcome | undefined,
): D2CAgent.DeliveryEvidenceReference[] {
  if (!outcome) return [];
  return [
    outcome.render?.actualImage,
    outcome.visual?.differenceImage,
  ].filter((reference): reference is D2CAgent.DeliveryEvidenceReference => reference !== undefined);
}
