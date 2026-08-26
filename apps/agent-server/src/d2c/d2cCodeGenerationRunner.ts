/** 管理代码生成运行、取消和领域进度到公开有序流事件的投影。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import {
  d2cWorkflowMethods,
  streamD2CCodeGenerationInputSchema,
  type CodeGenerationStreamEvent,
} from "@ui-forge/shared-protocol";
import { AsyncEventQueue } from "./asyncEventQueue.js";
import { toCodeGenerationViewModel } from "./d2cSnapshotPresenter.js";

/** 配置代码生成 Runner 使用的权威领域 Service。 */
export interface D2CCodeGenerationRunnerOptions {
  service: D2CAgent.Service;
}

/** 每个任务只保留一个活动代码生成，并支持显式取消。 */
export class D2CCodeGenerationRunner {
  private readonly activeRuns = new Map<string, AbortController>();

  /** 保存唯一权威领域服务。 */
  constructor(private readonly service: D2CAgent.Service) {}

  /** 取消指定任务当前的代码生成运行。 */
  cancel(taskId: string): boolean {
    const controller = this.activeRuns.get(taskId);
    controller?.abort();
    return controller !== undefined;
  }

  /** 执行代码生成流，并在持久化完成后发送唯一结果。 */
  async *stream(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<CodeGenerationStreamEvent> {
    if (method !== d2cWorkflowMethods.streamCodeGeneration) {
      throw new Error(`不支持的代码生成流式方法：${method}`);
    }
    const input = streamD2CCodeGenerationInputSchema.parse(params);
    const controller = new AbortController();
    this.activeRuns.get(input.taskId)?.abort();
    this.activeRuns.set(input.taskId, controller);
    const progressQueue = new AsyncEventQueue<D2CAgent.CodeGenerationProgressEvent>();
    const handleExternalAbort = () => controller.abort();
    if (signal?.aborted) handleExternalAbort();
    else signal?.addEventListener("abort", handleExternalAbort, { once: true });
    try {
      yield { type: "code-generation-start" };
      const generation = this.service.generateCode(
        input,
        (event) => progressQueue.push(structuredClone(event)),
        controller.signal,
      ).then(
        (task) => ({ succeeded: true as const, task }),
        (error: unknown) => ({ succeeded: false as const, error }),
      ).finally(() => {
        progressQueue.close();
        if (this.activeRuns.get(input.taskId) === controller) this.activeRuns.delete(input.taskId);
      });
      for await (const progress of progressQueue) {
        yield projectProgress(progress);
      }
      const outcome = await generation;
      if (!outcome.succeeded) {
        if (isAbortError(outcome.error)) {
          yield { type: "code-generation-stopped" };
          return;
        }
        throw outcome.error;
      }
      const result = toCodeGenerationViewModel(outcome.task.codeGeneration);
      if (result.status === "idle") throw new Error("代码生成完成后没有返回权威结果。");
      yield { type: "code-generation-result", result };
      yield { type: "code-generation-complete" };
    } finally {
      signal?.removeEventListener("abort", handleExternalAbort);
      controller.abort();
      progressQueue.close();
      if (this.activeRuns.get(input.taskId) === controller) this.activeRuns.delete(input.taskId);
    }
  }
}

/** 将领域进度压缩为不含源码和模型内容的公开事件。 */
function projectProgress(progress: D2CAgent.CodeGenerationProgressEvent): CodeGenerationStreamEvent {
  switch (progress.type) {
    case "code-context-start":
      return {
        type: "code-generation-progress",
        phase: "reading-context",
        summary: `正在重新读取并校验 ${progress.fileCount} 个计划文件。`,
      };
    case "code-context-complete":
      return {
        type: "code-generation-progress",
        phase: "reading-context",
        summary: `已读取 ${progress.fileCount} 个受控文件${progress.warningCount > 0 ? `，包含 ${progress.warningCount} 条降级信息` : ""}。`,
        metrics: { durationMs: progress.durationMs },
      };
    case "code-generation-start":
      return {
        type: "code-generation-progress",
        phase: "generating-code",
        summary: `Code Agent 正在逐项生成 ${progress.stepCount} 个计划步骤的候选代码。`,
      };
    case "code-generation-complete":
      return {
        type: "code-generation-progress",
        phase: "validating-patch",
        summary: progress.outcome.status === "ready"
          ? "候选代码已通过步骤、路径、文件版本和哈希门禁。"
          : "代码生成已停止并返回可审阅的阻塞原因。",
        metrics: {
          durationMs: progress.durationMs,
          ...(progress.tokenUsage ? { tokenUsage: progress.tokenUsage } : {}),
        },
      };
  }
}

/** 判断失败是否来自用户或传输层取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
