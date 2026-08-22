/** 注入隔离的 Fixture 通信客户端，启动仅供本地开发的 Webview 入口。 */
import "antd/dist/reset.css";
import { createAppDependencies } from "../src/app/appDependencies";
import { renderApp } from "../src/app/renderApp";
import "../src/styles.css";
import { fixtureCommunicationClient } from "./fixtureCommunicationClient";

renderApp(createAppDependencies(fixtureCommunicationClient));
