/** 验证真实命令展示、精确哈希批准和目录外人工计划的公共协议。 */

import { describe, expect, it } from "vitest";
import {
  approveD2CDeliveryCommandsInputSchema,
  deliveryCommandPlanViewModelSchema,
} from "./deliveryCommandProtocol.js";

const hash = "a".repeat(64);
const command = {
  commandId: "build-vite",
  purpose: "build-vite",
  cwd: "/workspace",
  executable: "/usr/bin/node",
  arguments: ["/workspace/node_modules/vite/bin/vite.js", "build"],
  displayCommand: "/usr/bin/node /workspace/node_modules/vite/bin/vite.js build",
  timeoutMs: 300_000,
  networkAccess: "none",
  workspaceScope: "within-workspace",
};

describe("delivery command protocol", () => {
  it("accepts an exact command approval and exposes executable, argv and cwd", () => {
    const input = approveD2CDeliveryCommandsInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 4,
      commandPlanHash: hash,
    });
    const plan = deliveryCommandPlanViewModelSchema.parse({
      status: "approval_required",
      patchSetHash: hash,
      workspaceRoot: "/workspace",
      commandPlanHash: hash,
      commands: [command],
      summary: "等待批准真实命令。",
      preparedAt: "2026-08-28T00:00:00.000Z",
    });

    expect(input.commandPlanHash).toBe(hash);
    expect(plan).toMatchObject({
      commands: [{ cwd: "/workspace", executable: "/usr/bin/node", arguments: command.arguments }],
    });
  });

  it("allows an empty manual plan but rejects an empty approvable plan", () => {
    const base = {
      patchSetHash: hash,
      workspaceRoot: "/workspace",
      commandPlanHash: hash,
      commands: [],
      summary: "需要人工处理。",
      preparedAt: "2026-08-28T00:00:00.000Z",
    };

    expect(deliveryCommandPlanViewModelSchema.safeParse({
      ...base,
      status: "manual_only",
      reason: "目录外命令不能自动执行。",
    }).success).toBe(true);
    expect(deliveryCommandPlanViewModelSchema.safeParse({
      ...base,
      status: "approval_required",
    }).success).toBe(false);
    expect(approveD2CDeliveryCommandsInputSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 4,
      commandPlanHash: "short",
    }).success).toBe(false);
  });
});
