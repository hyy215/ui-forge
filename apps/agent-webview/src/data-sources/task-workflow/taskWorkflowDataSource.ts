/** 将通信客户端适配为单视图设计检查、持久授权与代码交付数据源。 */

import {
  d2cWorkflowMethods,
  conversationStreamEventSchema,
  cancelD2CConversationResultSchema,
  designDataIndexSchema,
  designDataSectionSchema,
  type ConfirmD2CDesignInput,
  type ApproveD2CPlanInput,
  type ApproveD2CDeliveryCommandsInput,
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
  codeGenerationStreamEventSchema,
  cancelD2CCodeGenerationResultSchema,
  type CodeGenerationStreamEvent,
  type StreamD2CCodeGenerationInput,
  type CancelD2CCodeGenerationInput,
  type CancelD2CCodeGenerationResult,
  deliveryEvidenceImageSchema,
  type DeliveryEvidenceImage,
  type GetDeliveryEvidenceInput,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../../communication/clientContract";
import { requestTaskWorkflowSnapshot } from "./requestTaskWorkflowSnapshot";

/** Webview 当前单视图流程所需的服务端操作。 */
export interface TaskWorkflowDataSource {
  initialize(signal: AbortSignal): Promise<D2CWorkflowSnapshot>;
  getSnapshot(taskId: string, signal: AbortSignal): Promise<D2CWorkflowSnapshot>;
  inspectDesign(input: InspectD2CDesignInput): Promise<D2CWorkflowSnapshot>;
  confirmDesign(input: ConfirmD2CDesignInput): Promise<D2CWorkflowSnapshot>;
  approvePlan(input: ApproveD2CPlanInput): Promise<D2CWorkflowSnapshot>;
  approveDeliveryCommands(input: ApproveD2CDeliveryCommandsInput): Promise<D2CWorkflowSnapshot>;
  getDesignDataIndex(input: GetDesignDataIndexInput, signal?: AbortSignal): Promise<DesignDataIndex>;
  getDesignDataSection(input: GetDesignDataSectionInput, signal?: AbortSignal): Promise<DesignDataSection>;
  getDeliveryEvidence(input: GetDeliveryEvidenceInput, signal?: AbortSignal): Promise<DeliveryEvidenceImage>;
  streamConversation(
    input: StreamD2CConversationInput,
    onEvent: (event: ConversationStreamEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelConversation(input: CancelD2CConversationInput): Promise<CancelD2CConversationResult>;
  streamCodeGeneration(
    input: StreamD2CCodeGenerationInput,
    onEvent: (event: CodeGenerationStreamEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelCodeGeneration(input: CancelD2CCodeGenerationInput): Promise<CancelD2CCodeGenerationResult>;
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
    confirmDesign: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.confirmDesign, input,
    ),
    approvePlan: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.approvePlan, input,
    ),
    approveDeliveryCommands: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.approveDeliveryCommands, input,
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
    getDeliveryEvidence: (input, signal) => communicationClient.request({
      method: d2cWorkflowMethods.getDeliveryEvidence,
      params: input,
      responseSchema: deliveryEvidenceImageSchema,
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
    streamCodeGeneration: (input, onEvent, signal) => communicationClient.stream({
      method: d2cWorkflowMethods.streamCodeGeneration,
      params: input,
      eventSchema: codeGenerationStreamEventSchema,
      onEvent,
      ...(signal ? { signal } : {}),
    }),
    cancelCodeGeneration: (input) => communicationClient.request({
      method: d2cWorkflowMethods.cancelCodeGeneration,
      params: input,
      responseSchema: cancelD2CCodeGenerationResultSchema,
    }),
    reset: (input) => requestTaskWorkflowSnapshot(
      communicationClient, d2cWorkflowMethods.reset, input,
    ),
  };
}
