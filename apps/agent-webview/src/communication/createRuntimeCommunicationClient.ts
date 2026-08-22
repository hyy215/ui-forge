/** 根据 Webview 所处宿主环境选择具体通信适配器。 */
import type { CommunicationClient } from "./clientContract";
import { createHttpCommunicationClient } from "./http/createHttpCommunicationClient";
import {
  createVsCodeCommunicationClient,
  isVsCodeRuntime,
} from "./vscode/createVsCodeCommunicationClient";

/** 根据当前页面运行环境选择并创建实际通信客户端。 */
export function createRuntimeCommunicationClient(): CommunicationClient {
  return isVsCodeRuntime()
    ? createVsCodeCommunicationClient()
    : createHttpCommunicationClient();
}
