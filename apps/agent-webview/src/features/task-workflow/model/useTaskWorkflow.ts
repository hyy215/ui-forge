/** 管理单视图 D2C 快照、持久设计确认边界与方案分析流。 */

import { useEffect, useReducer, useRef, useState } from "react";
import type {
  D2CWorkflowSnapshot,
  D2CWorkflowStatus,
} from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import {
  createConversationStreamState,
  reduceConversationStreamState,
} from "./conversationStreamState";

/** 创建由服务端权威快照驱动的单视图工作流模型。 */
export function useTaskWorkflow(
  dataSource: TaskWorkflowDataSource,
  initialSnapshot: D2CWorkflowSnapshot,
) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [conversation, dispatchConversation] = useReducer(
    reduceConversationStreamState,
    initialSnapshot.viewModel.conversation,
    createConversationStreamState,
  );
  const [commandError, setCommandError] = useState<string>();
  const [isInspectingDesign, setIsInspectingDesign] = useState(false);
  const [isStoppingConversation, setIsStoppingConversation] = useState(false);
  const [conversationRetrySequence, setConversationRetrySequence] = useState(0);
  const startedConversationStreams = useRef(new Set<string>());
  const activeConversationRun = useRef<Promise<void> | null>(null);
  const viewPhase = getD2CViewPhase(snapshot.status);
  const designConfirmed = viewPhase === "conversation";

  useEffect(() => {
    if (!designConfirmed) return;
    if (!snapshot.viewModel.setup.designSummary) return;
    if (snapshot.viewModel.conversation.projectValidation) return;
    const streamKey = `${snapshot.taskId}:${snapshot.revision}:${conversationRetrySequence}`;
    if (startedConversationStreams.current.has(streamKey)) return;
    startedConversationStreams.current.add(streamKey);
    const controller = new AbortController();
    let completed = false;
    dispatchConversation({ type: "stream-started" });
    const run = dataSource.streamConversation(
      { taskId: snapshot.taskId, expectedRevision: snapshot.revision },
      (event) => {
        dispatchConversation({ type: "stream-event", event });
        if (event.type === "message-stopped") setIsStoppingConversation(false);
      },
      controller.signal,
    ).then(async () => {
      const latest = await dataSource.getSnapshot(snapshot.taskId, controller.signal);
      completed = true;
      setIsStoppingConversation(false);
      setSnapshot(latest);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      startedConversationStreams.current.delete(streamKey);
      setIsStoppingConversation(false);
      dispatchConversation({
        type: "stream-failed",
        message: normalizeCommandError(error),
      });
    });
    activeConversationRun.current = run;
    void run.then(() => {
      if (activeConversationRun.current === run) activeConversationRun.current = null;
    });
    return () => {
      controller.abort();
      if (!completed) startedConversationStreams.current.delete(streamKey);
    };
  }, [
    conversationRetrySequence,
    dataSource,
    snapshot.revision,
    snapshot.taskId,
    snapshot.viewModel.conversation.projectValidation,
    snapshot.viewModel.setup.designSummary,
    designConfirmed,
  ]);

  /** 创建绑定当前任务 revision 的命令参数。 */
  function commandInput() {
    return { taskId: snapshot.taskId, expectedRevision: snapshot.revision };
  }

  return {
    snapshot,
    viewPhase,
    conversation,
    designConfirmed,
    commandError,
    isInspectingDesign,
    isStoppingConversation,
    inspectDesign: async (designUrl: string) => {
      setCommandError(undefined);
      setIsInspectingDesign(true);
      try {
        setSnapshot(await dataSource.inspectDesign({ ...commandInput(), designUrl }));
      } catch (error: unknown) {
        setCommandError(normalizeCommandError(error));
      } finally {
        setIsInspectingDesign(false);
      }
    },
    confirmDesign: async (confirmation: string) => {
      setCommandError(undefined);
      try {
        setSnapshot(await dataSource.confirmDesign({
          ...commandInput(),
          confirmation,
        }));
      } catch (error: unknown) {
        setCommandError(normalizeCommandError(error));
      }
    },
    reset: async () => {
      setCommandError(undefined);
      try {
        const resetSnapshot = await resetTaskWorkflow(
          dataSource,
          snapshot.taskId,
          activeConversationRun.current,
        );
        setSnapshot(resetSnapshot);
        dispatchConversation({ type: "reset", viewModel: resetSnapshot.viewModel.conversation });
      } catch (error: unknown) {
        setCommandError(normalizeCommandError(error));
      }
    },
    stopConversation: async () => {
      if (isStoppingConversation) return;
      setCommandError(undefined);
      setIsStoppingConversation(true);
      try {
        const result = await dataSource.cancelConversation({ taskId: snapshot.taskId });
        if (!result.cancelled) setIsStoppingConversation(false);
      } catch (error: unknown) {
        setIsStoppingConversation(false);
        setCommandError(normalizeCommandError(error));
      }
    },
    retryConversationStream: () => setConversationRetrySequence((value) => value + 1),
  };
}

/** Webview 根据持久业务状态计算的临时展示阶段。 */
export type D2CViewPhase = "setup" | "svg" | "conversation";

/** 将公开业务状态派生为 Webview 展示阶段，不维护第二套服务端状态。 */
export function getD2CViewPhase(status: D2CWorkflowStatus): D2CViewPhase {
  switch (status) {
    case "draft": return "setup";
    case "svg_ready": return "svg";
    case "design_confirmed":
    case "analysis_ready":
      return "conversation";
  }
}

/** 终止并等待当前分析，随后基于服务端最新 revision 重置任务。 */
export async function resetTaskWorkflow(
  dataSource: TaskWorkflowDataSource,
  taskId: string,
  activeRun: Promise<void> | null,
): Promise<D2CWorkflowSnapshot> {
  if (activeRun) {
    await dataSource.cancelConversation({ taskId });
    await activeRun;
  }
  const latest = await dataSource.getSnapshot(taskId, new AbortController().signal);
  return dataSource.reset({ taskId, expectedRevision: latest.revision });
}

/** 将通信异常转换为页面可读文本。 */
function normalizeCommandError(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || /aborted without reason/.test(error.message))) {
    return "任务请求已取消或超时，请稍后重试。";
  }
  return error instanceof Error ? error.message : "任务操作失败。";
}
