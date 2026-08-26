/** 验证通信请求处理器独立完成服务调用、协议响应、计时和安全日志关联。 */

import { describe, expect, it, vi } from "vitest";
import type {
  CommunicationRequestMessage,
  D2CWorkflowSnapshot,
} from "@ui-forge/shared-protocol";
import type { CommunicationRequestLogger } from "../logging/workspaceRequestLogger.js";
import { CommunicationRequestHandler } from "./communicationRequestHandler.js";

describe("communication request handler", () => {
  it("returns a successful protocol response and records the resulting task", async () => {
    const snapshot = createSnapshot();
    const recordSuccess = vi.fn(async () => undefined);
    const logger = createLogger(recordSuccess, vi.fn(async () => undefined));
    const clock = createClock(10, 22);
    const handler = new CommunicationRequestHandler({
      workflowService: { handle: async () => snapshot },
      requestLogger: logger,
      clock,
    });

    const response = await handler.handle(createRequest({ projectPath: "/workspace" }));

    expect(response).toMatchObject({ success: true, requestId: "request-1", data: snapshot });
    expect(recordSuccess).toHaveBeenCalledWith({
      requestId: "request-1",
      method: "ui-forge.d2c.initialize",
      durationMs: 12,
      snapshot,
    });
  });

  it("records only safe correlation fields when workflow execution fails", async () => {
    const recordFailure = vi.fn(async () => undefined);
    const logger = createLogger(vi.fn(async () => undefined), recordFailure);
    const handler = new CommunicationRequestHandler({
      workflowService: { handle: async () => { throw new TypeError("invalid revision"); } },
      requestLogger: logger,
      clock: createClock(5, 13),
    });

    const response = await handler.handle(createRequest({
      taskId: "task-123",
      projectPath: "/workspace",
      apiKey: "must-not-be-logged",
      authorization: "Bearer secret",
    }));

    expect(response).toMatchObject({
      success: false,
      requestId: "request-1",
      error: { message: "invalid revision" },
    });
    expect(recordFailure).toHaveBeenCalledWith({
      requestId: "request-1",
      method: "ui-forge.d2c.initialize",
      durationMs: 8,
      taskId: "task-123",
      projectPath: "/workspace",
      errorName: "TypeError",
    });
    expect(JSON.stringify(recordFailure.mock.calls)).not.toContain("must-not-be-logged");
    expect(JSON.stringify(recordFailure.mock.calls)).not.toContain("Bearer secret");
  });

  it("does not turn a successful workflow into a failure when an injected logger rejects", async () => {
    const snapshot = createSnapshot();
    const handler = new CommunicationRequestHandler({
      workflowService: { handle: async () => snapshot },
      requestLogger: createLogger(
        async () => { throw new Error("log storage unavailable"); },
        async () => undefined,
      ),
    });

    const response = await handler.handle(createRequest({ projectPath: "/workspace" }));

    expect(response).toMatchObject({ success: true, requestId: "request-1" });
  });
});

/** 构造测试使用的通信请求。 */
function createRequest(params: unknown): CommunicationRequestMessage {
  return {
    kind: "request",
    requestId: "request-1",
    method: "ui-forge.d2c.initialize",
    params,
  };
}

/** 构造测试使用的最小公开快照。 */
function createSnapshot(): D2CWorkflowSnapshot {
  return {
    taskId: "8a60bb79-c772-4544-9898-7f6ad65f8e80",
    revision: 1,
    status: "draft",
    viewModel: {
      setup: {
        projectPath: "/workspace",
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
      codeGeneration: { status: "idle" },
    },
  };
}

/** 创建满足处理器端口的日志测试替身。 */
function createLogger(
  recordSuccess: CommunicationRequestLogger["recordSuccess"],
  recordFailure: CommunicationRequestLogger["recordFailure"],
): CommunicationRequestLogger {
  return { recordSuccess, recordFailure };
}

/** 创建按顺序返回指定值的测试时钟。 */
function createClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}
