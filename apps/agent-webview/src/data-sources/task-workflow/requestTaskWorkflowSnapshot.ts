/** 集中发送并校验返回 D2C 权威快照的任务流请求。 */
import {
  d2cWorkflowSnapshotSchema,
  type D2CWorkflowMethod,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../../communication/clientContract";

/** 使用指定通信客户端发送任务流请求，并校验返回的权威快照。 */
export function requestTaskWorkflowSnapshot(
  communicationClient: CommunicationClient,
  method: D2CWorkflowMethod,
  params: unknown,
  signal?: AbortSignal,
  timeoutMs?: number,
) {
  return communicationClient.request({
    method,
    params,
    responseSchema: d2cWorkflowSnapshotSchema,
    ...(signal ? { signal } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}
