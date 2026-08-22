/** 将通信客户端适配为单视图中的设计检查、SVG 确认与方案分析数据源。 */

import {
  d2cWorkflowMethods,
  conversationStreamEventSchema,
  cancelD2CConversationResultSchema,
  designDataIndexSchema,
  designDataSectionSchema,
  type D2CTaskCommandInput,
  type D2CWorkflowSnapshot,
  type DesignDataIndex,
  type DesignDataSection,
  type GetDesignDataIndexInput,
  type GetDesignDataSectionInput,
  type InspectD2CDesignInput,
  type ConversationStreamEvent,
  type CancelD2CConversationInput,
  type CancelD2CConversationResult,
  type StreamD2CConversationInput,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../../communication/clientContract";
import { requestTaskWorkflowSnapshot } from "./requestTaskWorkflowSnapshot";

/** Webview 当前单视图流程所需的服务端操作。 */
export interface TaskWorkflowDataSource {
  initialize(signal: AbortSignal): Promise<D2CWorkflowSnapshot>;
  getSnapshot(taskId: string, signal: AbortSignal): Promise<D2CWorkflowSnapshot>;
  inspectDesign(input: InspectD2CDesignInput): Promise<D2CWorkflowSnapshot>;
  getDesignDataIndex(input: GetDesignDataIndexInput, signal?: AbortSignal): Promise<DesignDataIndex>;
  getDesignDataSection(input: GetDesignDataSectionInput, signal?: AbortSignal): Promise<DesignDataSection>;
  streamConversation(
    input: StreamD2CConversationInput,
    onEvent: (event: ConversationStreamEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelConversation(input: CancelD2CConversationInput): Promise<CancelD2CConversationResult>;
  reset(input: D2CTaskCommandInput): Promise<D2CWorkflowSnapshot>;
}

/** 创建只暴露当前设计确认与分析通信方法的数据源。 */
export function createTaskWorkflowDataSource(
  communicationClient: CommunicationClient,
): TaskWorkflowDataSource {
  return {
    initialize: (signal) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.initialize, {}, signal,
    ),
    getSnapshot: (taskId, signal) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.getSnapshot, { taskId }, signal,
    ),
    inspectDesign: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.inspectDesign, input,
    ),
    getDesignDataIndex: (input, signal) => communicationClient.request({
      method: d2cWorkflowMethods.getDesignDataIndex,
      params: input,
      responseSchema: designDataIndexSchema,
      ...(signal ? { signal } : {}),
    }),
    getDesignDataSection: (input, signal) => communicationClient.request({
      method: d2cWorkflowMethods.getDesignDataSection,
      params: input,
      responseSchema: designDataSectionSchema,
      ...(signal ? { signal } : {}),
    }),
    streamConversation: (input, onEvent, signal) => communicationClient.stream({
      method: d2cWorkflowMethods.streamConversation,
      params: input,
      eventSchema: conversationStreamEventSchema,
      onEvent,
      ...(signal ? { signal } : {}),
    }),
    cancelConversation: (input) => communicationClient.request({
      method: d2cWorkflowMethods.cancelConversation,
      params: input,
      responseSchema: cancelD2CConversationResultSchema,
    }),
    reset: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.reset, input,
    ),
  };
}
