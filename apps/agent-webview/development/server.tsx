/** 作为浏览器真实联调入口，通过 HTTP 直接连接本地 Agent Server。 */
import "antd/dist/reset.css";
import { createAppDependencies } from "../src/app/appDependencies";
import { renderApp } from "../src/app/renderApp";
import { createHttpCommunicationClient } from "../src/communication/http/createHttpCommunicationClient";
import "../src/styles.css";

const communicationClient = createHttpCommunicationClient();
renderApp(createAppDependencies(communicationClient));
