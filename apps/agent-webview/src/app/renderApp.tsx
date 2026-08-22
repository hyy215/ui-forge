/** 使用统一主题和应用依赖挂载 Webview 客户端。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import { App } from "./App";
import type { AppDependencies } from "./appDependencies";

/** 使用指定应用依赖挂载 Webview 统一应用入口。 */
export function renderApp(dependencies: AppDependencies) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");

  createRoot(root).render(
    <React.StrictMode>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#315bea",
            borderRadius: 8,
            fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
            fontFamilyCode: 'var(--vscode-editor-font-family, "SFMono-Regular", Consolas, "Liberation Mono", monospace)',
            fontSize: 13,
            fontSizeSM: 12,
            fontSizeLG: 15,
            fontWeightStrong: 600,
            lineHeight: 1.6,
          },
        }}
      >
        <AntApp>
          <App dependencies={dependencies} />
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>,
  );
}
