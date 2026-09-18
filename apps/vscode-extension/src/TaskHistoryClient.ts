/** Extension 的历史查询 HTTP 适配；校验协议版本、信封及业务 Schema，不保存任务状态。 */
import { randomUUID } from "node:crypto";
import {
  communicationResponseMessageSchema,
  communicationTransportMethods,
  createCommunicationProtocolNegotiationInput,
  createCommunicationRequestMessage,
  sessionMethods,
  taskHistoryPageSchema,
  negotiateCommunicationProtocolResultSchema,
  type TaskHistoryPage,
} from "@ui-forge/shared-protocol";

/** 侧边栏仅消费轻量分页查询，执行仍由工作台和原工作区宿主管理。 */
export class TaskHistoryClient {
  private negotiation: Promise<void> | undefined;
  /** 绑定当前 Extension 所连接的 Agent Server。 */
  constructor(private readonly endpoint: string) {}
  /** 有界等待历史查询，拒绝不兼容协议、错误关联信封或不合法数据。 */
  async list(offset: number, signal?: AbortSignal): Promise<TaskHistoryPage> {
    try {
      this.negotiation ??= this.request(
        communicationTransportMethods.negotiateProtocol,
        createCommunicationProtocolNegotiationInput(["request-response", "codex-native-sessions"]),
        signal,
      ).then((data) => {
        const result = negotiateCommunicationProtocolResultSchema.parse(data);
        if (!result.capabilities.includes("codex-native-sessions"))
          throw new Error("请更新并重启 Agent Server 以使用历史任务。");
      });
      await this.negotiation;
      return taskHistoryPageSchema.parse(
        await this.request(sessionMethods.list, { offset }, signal),
      );
    } catch (error) {
      this.negotiation = undefined;
      throw error;
    }
  }
  /** 每次请求绑定唯一 ID，并将取消与超时传给 HTTP 连接。 */
  private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = randomUUID();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createCommunicationRequestMessage(id, method, params)),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`历史任务查询失败：HTTP ${response.status}`);
    const envelope = communicationResponseMessageSchema.parse(await response.json());
    if (envelope.requestId !== id) throw new Error("历史任务响应标识不匹配。");
    if (!envelope.success) throw new Error(envelope.error.message);
    return envelope.data;
  }
}
