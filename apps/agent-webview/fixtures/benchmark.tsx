/** 独立性能样本入口，只注入内存会话，不连接宿主、后端或模型。 */
import "antd/dist/reset.css";
import "../src/styles.css";
import { createAppDependencies } from "../src/app/appDependencies";
import { renderApp } from "../src/app/renderApp";
import { createLongHistoryFixtureClient } from "./longHistoryFixture";

const historyItems = Number(new URLSearchParams(window.location.search).get("historyItems"));
if (historyItems !== 100 && historyItems !== 500 && historyItems !== 1000) {
  throw new Error("historyItems must be 100, 500 or 1000");
}
renderApp(createAppDependencies(createLongHistoryFixtureClient(historyItems), true));
