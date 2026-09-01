/** 将单视图 Fixture 数据源适配为生产一致的通信客户端。 */

import {
  approveD2CPlanInputSchema,
  approveD2CDeliveryCommandsInputSchema,
  cancelD2CConversationInputSchema,
  confirmD2CDesignInputSchema,
  d2cTaskCommandInputSchema,
  d2cWorkflowMethods,
  getDesignDataIndexInputSchema,
  getDesignDataSectionInputSchema,
  getD2CWorkflowSnapshotInputSchema,
  initializeD2CWorkflowInputSchema,
  inspectD2CDesignInputSchema,
  streamD2CConversationInputSchema,
  streamD2CCodeGenerationInputSchema,
  cancelD2CCodeGenerationInputSchema,
} from "@ui-forge/shared-protocol";
import type {
  CommunicationClient,
  CommunicationRequest,
  CommunicationStreamRequest,
} from "../src/communication/clientContract";
import { fixtureTaskWorkflowDataSource } from "./taskWorkflowDataSource.fixture";

/** 校验 Fixture 请求并调用对应单视图方法。 */
async function handleRequest(request: CommunicationRequest<unknown>): Promise<unknown> {
  const signal = request.signal ?? new AbortController().signal;
  switch (request.method) {
    case d2cWorkflowMethods.initialize:
      initializeD2CWorkflowInputSchema.parse(request.params);
      return fixtureTaskWorkflowDataSource.initialize(signal);
    case d2cWorkflowMethods.getSnapshot:
      return fixtureTaskWorkflowDataSource.getSnapshot(
        getD2CWorkflowSnapshotInputSchema.parse(request.params).taskId,
        signal,
      );
    case d2cWorkflowMethods.inspectDesign:
      return fixtureTaskWorkflowDataSource.inspectDesign(inspectD2CDesignInputSchema.parse(request.params));
    case d2cWorkflowMethods.confirmDesign:
      return fixtureTaskWorkflowDataSource.confirmDesign(confirmD2CDesignInputSchema.parse(request.params));
    case d2cWorkflowMethods.approvePlan:
      return fixtureTaskWorkflowDataSource.approvePlan(approveD2CPlanInputSchema.parse(request.params));
    case d2cWorkflowMethods.approveDeliveryCommands:
      return fixtureTaskWorkflowDataSource.approveDeliveryCommands(
        approveD2CDeliveryCommandsInputSchema.parse(request.params),
      );
    case d2cWorkflowMethods.getDesignDataIndex:
      return fixtureTaskWorkflowDataSource.getDesignDataIndex(getDesignDataIndexInputSchema.parse(request.params), signal);
    case d2cWorkflowMethods.getDesignDataSection:
      return fixtureTaskWorkflowDataSource.getDesignDataSection(getDesignDataSectionInputSchema.parse(request.params), signal);
    case d2cWorkflowMethods.cancelConversation:
      return fixtureTaskWorkflowDataSource.cancelConversation(
        cancelD2CConversationInputSchema.parse(request.params),
      );
    case d2cWorkflowMethods.cancelCodeGeneration:
      return fixtureTaskWorkflowDataSource.cancelCodeGeneration(
        cancelD2CCodeGenerationInputSchema.parse(request.params),
      );
    case d2cWorkflowMethods.reset:
      return fixtureTaskWorkflowDataSource.reset(d2cTaskCommandInputSchema.parse(request.params));
    default:
      throw new Error(`Fixture 不支持通信方法：${request.method}`);
  }
}

/** 校验 Fixture 流请求并逐条转发领域事件。 */
async function handleStream(request: CommunicationStreamRequest<unknown>): Promise<void> {
  if (request.method === d2cWorkflowMethods.streamConversation) {
    await fixtureTaskWorkflowDataSource.streamConversation(
      streamD2CConversationInputSchema.parse(request.params),
      (event) => request.onEvent(request.eventSchema.parse(event)),
      request.signal,
    );
    return;
  }
  if (request.method === d2cWorkflowMethods.streamCodeGeneration) {
    await fixtureTaskWorkflowDataSource.streamCodeGeneration(
      streamD2CCodeGenerationInputSchema.parse(request.params),
      (event) => request.onEvent(request.eventSchema.parse(event)),
      request.signal,
    );
    return;
  }
  throw new Error(`Fixture 不支持流式通信方法：${request.method}`);
}

/** 本地开发使用的环境无关通信客户端。 */
export const fixtureCommunicationClient: CommunicationClient = {
  notify: (notification) => { throw new Error(`Fixture 不支持通知：${notification.method}`); },
  request: async (request) => request.responseSchema.parse(await handleRequest(request)),
  stream: handleStream,
};
