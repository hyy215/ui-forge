/** 验证单视图 Fixture 满足共享协议。 */

import { describe, expect, it } from "vitest";
import { d2cWorkflowSnapshotSchema } from "@ui-forge/shared-protocol";
import { createTaskWorkflowSnapshot } from "./taskWorkflow.fixture";

describe("single-view task fixture", () => {
  it("matches the shared snapshot protocol", () => {
    expect(d2cWorkflowSnapshotSchema.safeParse(createTaskWorkflowSnapshot()).success).toBe(true);
  });
});
