/** 验证交付验收图片查询协议拒绝无效所有权标识和非 PNG Data URL。 */

import { describe, expect, it } from "vitest";
import {
  deliveryEvidenceImageSchema,
  getDeliveryEvidenceInputSchema,
} from "./deliveryEvidenceProtocol.js";

describe("delivery evidence protocol", () => {
  it("accepts a bounded PNG owned by a UUID task", () => {
    expect(getDeliveryEvidenceInputSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      evidenceId: "22222222-2222-4222-8222-222222222222",
    }).success).toBe(true);
    expect(deliveryEvidenceImageSchema.safeParse({
      reference: {
        evidenceId: "22222222-2222-4222-8222-222222222222",
        kind: "actual",
        mimeType: "image/png",
        byteSize: 68,
        sha256: "a".repeat(64),
        width: 1,
        height: 1,
      },
      dataUrl: "data:image/png;base64,aGVsbG8=",
    }).success).toBe(true);
  });

  it("rejects malformed ids and non-PNG image payloads", () => {
    expect(getDeliveryEvidenceInputSchema.safeParse({ taskId: "bad", evidenceId: "bad" }).success)
      .toBe(false);
    expect(deliveryEvidenceImageSchema.safeParse({
      reference: {
        evidenceId: "22222222-2222-4222-8222-222222222222",
        kind: "actual",
        mimeType: "image/png",
        byteSize: 68,
        sha256: "a".repeat(64),
        width: 1,
        height: 1,
      },
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
    }).success).toBe(false);
  });
});
