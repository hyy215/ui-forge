/** 根据 Webview 所处宿主环境选择具体通信适配器并强制协议协商。 */
import type { CommunicationClient } from "./clientContract";
import { createHttpCommunicationClient } from "./http/createHttpCommunicationClient";
import { createNegotiatedCommunicationClient } from "./createNegotiatedCommunicationClient";
import {
  createVsCodeCommunicationClient,
  isVsCodeRuntime,
} from "./vscode/createVsCodeCommunicationClient";

/** 根据当前页面运行环境创建已协商的实际通信客户端。 */
export function createRuntimeCommunicationClient(): CommunicationClient {
  const concreteClient = isVsCodeRuntime()
    ? createVsCodeCommunicationClient()
    : createHttpCommunicationClient();
  return createNegotiatedCommunicationClient(concreteClient);
}
