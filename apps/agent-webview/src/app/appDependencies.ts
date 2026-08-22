/** 定义并组装 Webview 应用层使用的环境相关基础依赖。 */
import type { CommunicationClient } from "../communication/clientContract";

/** Webview 当前启用功能所依赖的应用级能力集合。 */
export interface AppDependencies {
  communicationClient: CommunicationClient;
}

/** 注入由当前宿主环境选定的统一通信客户端。 */
export function createAppDependencies(
  communicationClient: CommunicationClient,
): AppDependencies {
  return { communicationClient };
}
