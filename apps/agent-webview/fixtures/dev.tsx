/** 显式开发演示入口，模拟消息仅在 Vite 开发模式启用。 */
import "antd/dist/reset.css";
import "../src/styles.css";
import { createAppDependencies } from "../src/app/appDependencies";
import { renderApp } from "../src/app/renderApp";
import { createFixtureClient } from "./nativeSessionFixture";
renderApp(createAppDependencies(createFixtureClient(), true));
