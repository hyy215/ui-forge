import { describe, expect, it, vi } from "vitest";
import { continuationPrompt } from "@ui-forge/client-core";
import {
  deliveryMethods,
  diagnosticMethods,
  designMethods,
  sessionMethods,
} from "@ui-forge/shared-protocol";
import { createTaskDiagnosticsFixture } from "../../fixtures/taskDiagnosticsFixture";
import { createTaskDeliveryFixture } from "../../fixtures/taskDeliveryFixture";
import type { CommunicationClient, CommunicationRequest } from "../communication/clientContract";
import { createSessionDataSource } from "./sessionDataSource";

describe("design connection check", () => {
  it("rejects a successful response for a different source instead of displaying a stale result", async () => {
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        return request.responseSchema.parse({ source: { kind: "local" }, tools: [] });
      },
    };
    await expect(
      createSessionDataSource(client).checkDesignConnection({
        kind: "mastergo",
        url: "https://mastergo.com/file/file?layer_id=2:3",
        connection: { kind: "magic" },
      }),
    ).rejects.toThrow("不属于当前设计来源");
  });
  it("only sends the explicit check RPC and passes cancellation without starting a session", async () => {
    const requests: CommunicationRequest<unknown>[] = [];
    const controller = new AbortController();
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        requests.push(request);
        return request.responseSchema.parse({ source: { kind: "local" }, tools: [] });
      },
    };
    await expect(
      createSessionDataSource(client).checkDesignConnection({ kind: "local" }, controller.signal),
    ).resolves.toEqual({ source: { kind: "local" }, tools: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: designMethods.check,
      params: { source: { kind: "local" } },
      signal: controller.signal,
    });
  });
});

describe("session continuation", () => {
  it("only sends an explicit idle-only continuation to the original task", async () => {
    const requests: CommunicationRequest<unknown>[] = [];
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        requests.push(request);
        return request.responseSchema.parse({ accepted: true });
      },
    };
    const source = createSessionDataSource(client);
    expect(requests).toHaveLength(0);

    await expect(source.continue("original-task")).resolves.toEqual({ accepted: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: sessionMethods.send,
      params: {
        taskId: "original-task",
        text: continuationPrompt,
        startOnlyIfIdle: true,
      },
      timeoutMs: 120_000,
    });
  });

  it("propagates a failed continuation without retrying or creating a task", async () => {
    const request = vi.fn().mockRejectedValue(new Error("service unavailable"));
    const client: CommunicationClient = { notify: vi.fn(), stream: vi.fn(), request };
    await expect(createSessionDataSource(client).continue("original-task")).rejects.toThrow(
      "service unavailable",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("task diagnostics", () => {
  it("only requests the diagnostics method and passes through cancellation", async () => {
    const requests: CommunicationRequest<unknown>[] = [];
    const controller = new AbortController();
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        requests.push(request);
        return request.responseSchema.parse(createTaskDiagnosticsFixture("task-1"));
      },
    };
    const source = createSessionDataSource(client);
    expect(requests).toHaveLength(0);
    await expect(source.readDiagnostics("task-1", controller.signal)).resolves.toMatchObject({
      taskId: "task-1",
      scope: "thread-tree",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: diagnosticMethods.read,
      params: { taskId: "task-1" },
      signal: controller.signal,
    });
  });

  it("rejects mismatched or overbroad reports instead of exposing them", async () => {
    let response: unknown = createTaskDiagnosticsFixture("other-task");
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        return request.responseSchema.parse(response);
      },
    };
    const source = createSessionDataSource(client);
    await expect(source.readDiagnostics("task-1")).rejects.toThrow();
    response = { ...createTaskDiagnosticsFixture("task-1"), command: "private command" };
    await expect(source.readDiagnostics("task-1")).rejects.toThrow();
  });

  it("never retries a failed read automatically", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unavailable"));
    const client: CommunicationClient = { notify: vi.fn(), stream: vi.fn(), request };
    await expect(createSessionDataSource(client).readDiagnostics("task-1")).rejects.toThrow(
      "unavailable",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending diagnostic request through its AbortSignal without retrying", async () => {
    let calls = 0;
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        calls += 1;
        return new Promise<TResult>((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    };
    const controller = new AbortController();
    const pending = createSessionDataSource(client).readDiagnostics("task-1", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});

describe("task delivery", () => {
  it("only reads delivery and forwards cancellation without recovering the task", async () => {
    const requests: CommunicationRequest<unknown>[] = [];
    const controller = new AbortController();
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        requests.push(request);
        return request.responseSchema.parse(createTaskDeliveryFixture("task-1"));
      },
    };
    await expect(
      createSessionDataSource(client).readDelivery("task-1", controller.signal),
    ).resolves.toMatchObject({
      taskId: "task-1",
      availability: "missing",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: deliveryMethods.read,
      params: { taskId: "task-1" },
      signal: controller.signal,
    });
  });

  it("rejects mismatched and malformed delivery responses", async () => {
    let result: unknown = createTaskDeliveryFixture("other-task");
    const client: CommunicationClient = {
      notify: vi.fn(),
      stream: vi.fn(),
      async request<TResult>(request: CommunicationRequest<TResult>): Promise<TResult> {
        return request.responseSchema.parse(result);
      },
    };
    const source = createSessionDataSource(client);
    await expect(source.readDelivery("task-1")).rejects.toThrow("不属于当前任务");
    result = { ...createTaskDeliveryFixture("other-task", "delivery"), taskId: "task-1" };
    await expect(source.readDelivery("task-1")).rejects.toThrow("不属于当前任务");
    result = { ...createTaskDeliveryFixture("task-1"), passed: true };
    await expect(source.readDelivery("task-1")).rejects.toThrow();
  });

  it("does not retry a failed delivery read", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unavailable"));
    const client: CommunicationClient = { notify: vi.fn(), stream: vi.fn(), request };
    await expect(createSessionDataSource(client).readDelivery("task-1")).rejects.toThrow(
      "unavailable",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
