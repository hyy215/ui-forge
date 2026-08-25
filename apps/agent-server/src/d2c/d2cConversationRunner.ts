/** 管理第二步分析运行、取消和流式事件终止语义。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import {
  d2cWorkflowMethods,
  streamD2CConversationInputSchema,
  type ConversationStreamEvent,
} from "@ui-forge/shared-protocol";
import { AsyncEventQueue } from "./asyncEventQueue.js";
import { D2CProgressEventProjector } from "./d2cProgressEventProjector.js";

/** 配置 Conversation Runner 使用的权威领域 Service。 */
export interface D2CConversationRunnerOptions {
  service: D2CAgent.Service;
}

/** 每个任务只保留一个活动分析，并把回调式领域进度转换为异步流。 */
export class D2CConversationRunner {
  private readonly service: D2CAgent.Service;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(options: D2CConversationRunnerOptions) {
    this.service = options.service;
  }

  /** 取消任务当前的活动分析。 */
  cancel(taskId: string): boolean {
    const controller = this.activeRuns.get(taskId);
    controller?.abort();
    return controller !== undefined;
  }

  /** 执行唯一的第二步分析流并保证工具、停止和完成事件有序。 */
  async *stream(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationStreamEvent> {
    if (method !== d2cWorkflowMethods.streamConversation) {
      throw new Error(`不支持的 D2C 流式通信方法：${method}`);
    }
    const input = streamD2CConversationInputSchema.parse(params);
    const projector = new D2CProgressEventProjector();
    const controller = new AbortController();
    this.activeRuns.get(input.taskId)?.abort();
    this.activeRuns.set(input.taskId, controller);
    const progressQueue = new AsyncEventQueue<D2CAgent.SecondStepProgressEvent>();
    const handleExternalAbort = () => controller.abort();
    if (signal?.aborted) handleExternalAbort();
    else signal?.addEventListener("abort", handleExternalAbort, { once: true });
    try {
      yield { type: "message-start", messageId: projector.messageId };
      const analysis = this.service.analyzeSecondStep(
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
      let task: D2CAgent.Task;
      try {
        for await (const progress of progressQueue) {
          for (const event of projector.project(progress)) yield event;
        }
        const outcome = await analysis;
        if (!outcome.succeeded) throw outcome.error;
        task = outcome.task;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          if (projector.activeToolCallId) {
            yield {
              type: "tool-complete",
              messageId: projector.messageId,
              toolCallId: projector.activeToolCallId,
              summary: "已由用户终止。",
              outcome: "warning",
              ...(projector.activeToolStartedAt !== undefined
                ? { metrics: { durationMs: elapsedMilliseconds(projector.activeToolStartedAt) } }
                : {}),
            };
          }
          yield { type: "message-stopped", messageId: projector.messageId };
          return;
        }
        if (projector.activeToolCallId) {
          yield {
            type: "tool-complete",
            messageId: projector.messageId,
            toolCallId: projector.activeToolCallId,
            summary: "当前识别步骤未能完成。",
            outcome: "error",
            ...(projector.activeToolStartedAt !== undefined
              ? { metrics: { durationMs: elapsedMilliseconds(projector.activeToolStartedAt) } }
              : {}),
          };
        }
        throw error;
      }

      const inspection = task.projectInspection;
      if (!inspection) throw new Error("项目检查完成后没有返回权威结果。");
      const componentRecognition = task.componentRecognition;
      if (inspection.kind !== "unsupported" && !componentRecognition) {
        throw new Error("组件识别完成后没有返回权威结果。");
      }
      if (!projector.projectCompleted) {
        for (const event of projector.project({ type: "project-inspection-start" })) yield event;
        for (const event of projector.project({ type: "project-inspection-complete", inspection })) yield event;
      }
      if (inspection.kind !== "unsupported" && componentRecognition && !projector.componentCompleted) {
        for (const event of projector.project({ type: "component-recognition-start" })) yield event;
        for (const event of projector.project({
          type: "component-recognition-complete",
          recognition: componentRecognition,
          unknownCount: componentRecognition.components.filter((component) => !component.typeHint).length,
        })) yield event;
      }
      if (inspection.kind !== "unsupported" && componentRecognition && task.plan && !projector.planningCompleted) {
        for (const event of projector.project({ type: "planning-start" })) yield event;
        for (const event of projector.project({
          type: "planning-complete",
          recognition: componentRecognition,
          plan: task.plan,
          durationMs: 0,
        })) yield event;
      }
      yield { type: "message-complete", messageId: projector.messageId };
    } finally {
      signal?.removeEventListener("abort", handleExternalAbort);
      controller.abort();
      progressQueue.close();
      if (this.activeRuns.get(input.taskId) === controller) this.activeRuns.delete(input.taskId);
    }
  }
}

/** 判断错误是否来自用户主动取消或 AbortSignal。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 计算服务端工具运行的非负整数毫秒数。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
