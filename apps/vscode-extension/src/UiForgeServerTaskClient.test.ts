/** 验证 Extension 任务客户端附加 Workspace 上下文并校验统一通信信封。 */

import { describe, expect, it, vi } from "vitest";
import {
  communicationCapabilities,
  currentCommunicationProtocolVersion,
  d2cWorkflowMethods,
} from "@ui-forge/shared-protocol";
import { createUiForgeServerTaskClient } from "./UiForgeServerTaskClient.js";

const task = {
  taskId: "11111111-1111-4111-8111-111111111111",
  displayName: "客户中心",
  status: "draft" as const,
  revision: 1,
  stage: "design" as const,
  attention: "required" as const,
  nextAction: "填写设计地址",
  updatedAt: "2026-08-28T01:00:00.000Z",
};

describe("UiForgeServerTaskClient", () => {
  it("adds the current project path to task list and permanent deletion requests", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      const negotiation = request.method === "ui-forge.communication.negotiate-protocol";
      return new Response(JSON.stringify({
        kind: "response",
        requestId: request.requestId,
        success: true,
        data: negotiation ? {
          protocolVersion: currentCommunicationProtocolVersion,
          capabilities: communicationCapabilities,
        } : request.method === d2cWorkflowMethods.deleteTask
          ? { taskId: task.taskId, deleted: true }
          : { items: [], nextCursor: null },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createUiForgeServerTaskClient({
      endpoint: "http://127.0.0.1:4310/api/communication",
      getProjectPath: () => "/workspace/demo",
      fetchImplementation,
    });

    await expect(client.listTasks()).resolves.toEqual({ items: [], nextCursor: null });
    await expect(client.deleteTask(task)).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({
      kind: "request",
      method: "ui-forge.communication.negotiate-protocol",
    });
    expect(requests[1]).toMatchObject({
      kind: "request",
      method: "ui-forge.d2c.list-tasks",
      params: { projectPath: "/workspace/demo", includeArchived: true, limit: 100 },
    });
    expect(requests[2]).toMatchObject({
      kind: "request",
      method: "ui-forge.d2c.delete-task",
      params: {
        taskId: task.taskId,
        expectedRevision: task.revision,
        projectPath: "/workspace/demo",
      },
    });
  });

  it("surfaces a server-side task management error", async () => {
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const negotiation = request.method === "ui-forge.communication.negotiate-protocol";
      return new Response(JSON.stringify({
        kind: "response",
        requestId: request.requestId,
        ...(negotiation ? {
          success: true,
          data: {
            protocolVersion: currentCommunicationProtocolVersion,
            capabilities: communicationCapabilities,
          },
        } : { success: false, error: { message: "任务版本冲突。" } }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createUiForgeServerTaskClient({
      endpoint: "http://127.0.0.1:4310/api/communication",
      getProjectPath: () => "/workspace/demo",
      fetchImplementation,
    });

    await expect(client.archiveTask(task)).rejects.toThrow("任务版本冲突");
  });
});
