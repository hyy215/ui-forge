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
      const result = toCodeGenerationViewModel(
        outcome.task.codeGeneration,
        outcome.task.patchApplication,
        outcome.task.deliveryCommandPlan,
        outcome.task.deliveryCommandApproval,
        outcome.task.deliveryValidation,
      );
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
    case "patch-application-start":
      return {
        type: "code-generation-progress",
        phase: "applying-patch",
        summary: `正在对 ${progress.fileCount} 个目标文件执行版本预检并安全落盘。`,
      };
    case "patch-application-complete":
      return {
        type: "code-generation-progress",
        phase: "applying-patch",
        summary: progress.alreadyApplied
          ? `已确认 ${progress.fileCount} 个文件处于目标版本，无需重复写入。`
          : `已安全应用 ${progress.fileCount} 个目标文件。`,
      };
    case "patch-application-blocked":
      return {
        type: "code-generation-progress",
        phase: "applying-patch",
        summary: `自动应用已停止，发现 ${progress.reasonCount} 项需要人工处理的问题。`,
      };
    case "delivery-command-start":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: `正在执行已批准的依赖安装命令 ${progress.command}。`,
      };
    case "delivery-command-complete":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: "已批准的依赖安装命令执行完成。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-command-blocked":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: "依赖安装命令未通过，自动验收已停止。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-build-start":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: `正在以受控命令 ${progress.command} 构建目标项目。`,
      };
    case "delivery-build-complete":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: "目标项目构建通过。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-build-blocked":
      return {
        type: "code-generation-progress",
        phase: "building-project",
        summary: "目标项目构建未通过，自动验收已停止。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-render-start":
      return {
        type: "code-generation-progress",
        phase: "rendering-page",
        summary: `正在本地 Vite 预览中渲染 ${progress.previewPath}。`,
      };
    case "delivery-render-complete":
      return {
        type: "code-generation-progress",
        phase: "rendering-page",
        summary: "目标页面已完成受控渲染和截图。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-render-blocked":
      return {
        type: "code-generation-progress",
        phase: "rendering-page",
        summary: "目标页面未能完成受控渲染，自动验收已停止。",
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-visual-start":
      return {
        type: "code-generation-progress",
        phase: "evaluating-visual",
        summary: `正在执行视觉差异门禁，允许阈值 ${(progress.threshold * 100).toFixed(2)}%。`,
      };
    case "delivery-visual-complete":
      return {
        type: "code-generation-progress",
        phase: "evaluating-visual",
        summary: `视觉差异门禁通过，显著差异像素占比 ${(progress.pixelDifferenceRatio * 100).toFixed(2)}%。`,
        metrics: { durationMs: progress.durationMs },
      };
    case "delivery-visual-blocked":
      return {
        type: "code-generation-progress",
        phase: "evaluating-visual",
        summary: progress.pixelDifferenceRatio === undefined
          ? "视觉差异评测未完成，自动验收已停止。"
          : `视觉差异超过门禁，显著差异像素占比 ${(progress.pixelDifferenceRatio * 100).toFixed(2)}%。`,
        metrics: { durationMs: progress.durationMs },
      };
  }
}

/** 判断失败是否来自用户或传输层取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
