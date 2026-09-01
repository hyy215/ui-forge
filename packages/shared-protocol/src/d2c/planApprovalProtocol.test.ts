/** 验证 Plan 批准命令和快照状态始终绑定精确版本与 SHA-256。 */

import { describe, expect, it } from "vitest";
import {
  approveD2CPlanInputSchema,
  planApprovalViewModelSchema,
} from "./planApprovalProtocol.js";

describe("plan approval protocol", () => {
  it("accepts an exact pending and approved Plan reference", () => {
    const planHash = "a".repeat(64);
    expect(approveD2CPlanInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
      planVersion: 1,
      planHash,
      executionMode: "generate-and-apply",
    })).toMatchObject({ planVersion: 1, planHash });
    expect(planApprovalViewModelSchema.parse({
      status: "approved",
      planVersion: 1,
      planHash,
      approvedAt: "2026-08-28T00:00:00.000Z",
      executionMode: "generate-and-apply",
    })).toMatchObject({ status: "approved" });
  });

  it("rejects malformed hashes and approved states without a timestamp", () => {
    expect(approveD2CPlanInputSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
      planVersion: 1,
      planHash: "stale",
      executionMode: "generate-and-apply",
    }).success).toBe(false);
    expect(planApprovalViewModelSchema.safeParse({
      status: "approved",
      planVersion: 1,
      planHash: "a".repeat(64),
      executionMode: "generate-and-apply",
    }).success).toBe(false);
    expect(approveD2CPlanInputSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
      planVersion: 1,
      planHash: "a".repeat(64),
      executionMode: "generate-apply-and-validate",
    }).success).toBe(false);
  });
});
