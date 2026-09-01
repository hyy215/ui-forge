/** 验证交付验收图片查询只返回当前权威任务明确引用的证据。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import { describe, expect, it, vi } from "vitest";
import { D2CDeliveryEvidenceQueryService } from "./d2cDeliveryEvidenceQueryService.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";
const reference: D2CAgent.DeliveryEvidenceReference = {
  evidenceId,
  kind: "actual",
  mimeType: "image/png",
  byteSize: 68,
  sha256: "a".repeat(64),
  width: 1,
  height: 1,
};

describe("D2CDeliveryEvidenceQueryService", () => {
  it("returns a PNG Data URL after task ownership and stored metadata match", async () => {
    const store = createStore();
    const query = new D2CDeliveryEvidenceQueryService({
      service: createService(),
      deliveryEvidenceStore: store,
    });

    const result = await query.get(taskId, evidenceId);

    expect(result).toMatchObject({ reference, dataUrl: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(store.read).toHaveBeenCalledWith(taskId, evidenceId);
  });

  it("rejects an evidence id that is not referenced by the current task", async () => {
    const store = createStore();
    const query = new D2CDeliveryEvidenceQueryService({
      service: createService(),
      deliveryEvidenceStore: store,
    });

    await expect(query.get(taskId, "33333333-3333-4333-8333-333333333333"))
      .rejects.toThrow("没有引用");
    expect(store.read).not.toHaveBeenCalled();
  });
});

/** 创建返回一张与权威引用一致图片的存储端口。 */
function createStore() {
  return {
    write: vi.fn<D2CAgent.DeliveryEvidenceStore["write"]>(),
    read: vi.fn(async () => ({ reference, data: Buffer.from("png") })),
    discardTask: vi.fn<D2CAgent.DeliveryEvidenceStore["discardTask"]>(),
  } satisfies D2CAgent.DeliveryEvidenceStore;
}

/** 创建只实现证据查询所需 getTask 行为的领域服务。 */
function createService(): D2CAgent.Service {
  return {
    getTask: async () => ({
      taskId,
      workspaceId: "workspace",
      revision: 1,
      status: "delivery_ready",
      projectPath: "/workspace",
      taskGoal: "实现页面",
      deliveryValidation: {
        status: "passed",
        patchSetHash: "b".repeat(64),
        summary: "验收通过。",
        build: {
          status: "passed",
          command: "npm run build",
          durationMs: 1,
          summary: "构建通过。",
          outputSummary: "",
        },
        render: {
          status: "passed",
          durationMs: 1,
          summary: "渲染通过。",
          previewPath: "/",
          viewport: { width: 320, height: 240 },
          actualImage: reference,
        },
        visual: {
          status: "passed",
          durationMs: 1,
          summary: "视觉通过。",
          pixelDifferenceRatio: 0,
          threshold: 0.1,
        },
        validatedAt: "2026-08-28T00:00:00.000Z",
      },
    }),
  } as D2CAgent.Service;
}
