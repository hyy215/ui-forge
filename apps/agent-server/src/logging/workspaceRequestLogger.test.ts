/** 验证通信日志按 Workspace 和任务归档，且不会持久化请求参数或配置秘密。 */

import { mkdtemp, readFile, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import { WorkspaceIdentityResolver } from "./workspaceIdentityResolver.js";
import { WorkspaceRequestLogger } from "./workspaceRequestLogger.js";

describe("workspace request logger", () => {
  it("appends requests from one task to a taskId JSONL file without configuration values", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "ui-forge-logs-"));
    const identityResolver = new WorkspaceIdentityResolver(async () => (
      "https://token-user:api-key-value@github.com/acme/customer-console.git"
    ));
    const logger = new WorkspaceRequestLogger({
      rootDirectory,
      workspaceIdentityResolver: identityResolver,
      now: () => new Date("2026-08-17T01:02:03.000Z"),
    });
    const snapshot = createSnapshot();

    await logger.recordSuccess({
      requestId: "request-1",
      method: "ui-forge.d2c.initialize",
      durationMs: 12,
      snapshot,
    });
    await logger.recordFailure({
      requestId: "request-2",
      method: "ui-forge.d2c.inspect-design",
      durationMs: 8,
      taskId: snapshot.taskId,
      errorName: "Error",
    });
    await logger.recordModelInvocation({
      taskId: snapshot.taskId,
      stage: "visual-analysis",
      attempt: 1,
      status: "failed",
      durationMs: 142_000,
      errorName: "Error",
      errorCode: "UND_ERR_SOCKET",
      retryable: true,
    });
    await logger.recordModelInvocation({
      taskId: snapshot.taskId,
      stage: "plan-generation",
      attempt: 1,
      status: "stream-progress",
      turn: 2,
      elapsedMs: 60_000,
      chunkCount: 42,
      idleMs: 1_500,
    });
    await logger.recordModelInvocation({
      taskId: snapshot.taskId,
      stage: "visual-analysis",
      attempt: 1,
      status: "structured-output-invalid",
      validationIssueCount: 2,
      validationIssuePaths: ["layout.regions.0.direction:invalid_value", "elements:invalid_type"],
    });

    const workspaceDirectories = await readdir(rootDirectory);
    expect(workspaceDirectories).toHaveLength(1);
    expect(workspaceDirectories[0]).toMatch(/^customer-console-[a-f0-9]{16}$/);
    const logPath = join(
      rootDirectory,
      workspaceDirectories[0]!,
      "2026-08",
      `${snapshot.taskId}.jsonl`,
    );
    const contents = await readFile(logPath, "utf8");
    const records = contents.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({
      requestId: "request-1",
      taskId: snapshot.taskId,
      workspaceType: "git",
      workspace: "https://github.com/acme/customer-console.git",
      status: "success",
      workflowPhase: "created",
    });
    expect(records[1]).toMatchObject({ requestId: "request-2", status: "failure" });
    expect(records[2]).toMatchObject({
      event: "model.invocation",
      taskId: snapshot.taskId,
      stage: "visual-analysis",
      attempt: 1,
      durationMs: 142_000,
      errorCode: "UND_ERR_SOCKET",
      retryable: "true",
    });
    expect(records[3]).toMatchObject({
      event: "model.invocation",
      stage: "plan-generation",
      status: "stream-progress",
      turn: 2,
      elapsedMs: 60_000,
      chunkCount: 42,
      idleMs: 1_500,
    });
    expect(records[4]).toMatchObject({
      event: "model.invocation",
      status: "structured-output-invalid",
      validationIssueCount: 2,
      validationIssuePaths: "layout.regions.0.direction:invalid_value,elements:invalid_type",
    });
    expect(contents).not.toContain("api-key-value");
    expect(contents).not.toContain("token-user");
    expect(contents).not.toContain("params");
    expect(contents).not.toContain("invalidResponse");
  });

  it("rotates oversized task logs and deletes expired monthly partitions", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "ui-forge-logs-"));
    const logger = new WorkspaceRequestLogger({
      rootDirectory,
      maxFileBytes: 1,
      retentionMs: 24 * 60 * 60_000,
      workspaceIdentityResolver: new WorkspaceIdentityResolver(async () => undefined),
      now: () => new Date("2026-08-17T01:02:03.000Z"),
    });
    const snapshot = createSnapshot();
    await logger.recordSuccess({
      requestId: "request-1",
      method: "ui-forge.d2c.initialize",
      durationMs: 1,
      snapshot,
    });
    await logger.recordSuccess({
      requestId: "request-2",
      method: "ui-forge.d2c.get-snapshot",
      durationMs: 1,
      snapshot,
    });

    const [workspace] = await readdir(rootDirectory);
    const monthPath = join(rootDirectory, workspace!, "2026-08");
    expect((await readdir(monthPath)).sort()).toEqual([
      `${snapshot.taskId}.1.jsonl`,
      `${snapshot.taskId}.jsonl`,
    ]);
    const old = new Date("2026-08-01T00:00:00.000Z");
    for (const file of await readdir(monthPath)) await utimes(join(monthPath, file), old, old);
    await expect(logger.collectGarbage(new Date("2026-08-18T00:00:00.000Z"))).resolves.toBe(2);
    await expect(readdir(rootDirectory)).resolves.toEqual([]);
  });
});

/** 构造日志测试所需的最小合法公开快照。 */
function createSnapshot(): D2CWorkflowSnapshot {
  return {
    taskId: "task-123",
    revision: 1,
    workflowPhase: "created",
    state: { phase: "setup", status: "draft" },
    viewModel: {
      setup: {
        projectPath: "/workspaces/customer-console",
        taskGoal: "",
        designUrl: "",
        designSummary: null,
      },
      svg: { taskGoal: "", statusMessage: "", tools: [] },
      conversation: {
        initialUserMessage: "请结合当前项目与 MasterGo 设计生成整体修改方案。",
        planStatus: "idle",
        projectValidation: null,
        designComponentRecognition: null,
        plan: null,
      },
    },
  };
}
