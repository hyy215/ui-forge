/** 组装生产通信客户端与应用依赖，并启动 Webview 统一入口。 */
import "antd/dist/reset.css";
import { createAppDependencies } from "./app/appDependencies";
import { renderApp } from "./app/renderApp";
import { createRuntimeCommunicationClient } from "./communication/createRuntimeCommunicationClient";
import "./styles.css";

const communicationClient = createRuntimeCommunicationClient();
renderApp(createAppDependencies(communicationClient));
