/** 作为 Webview 客户端统一应用入口，编排当前启用的业务功能。 */
import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import type { AppDependencies } from "./appDependencies";
import { createAppRouter } from "./createAppRouter";

/** Webview 统一应用入口接收的应用级依赖。 */
export interface AppProps {
  dependencies: AppDependencies;
}

/** 渲染 Webview 客户端当前启用的功能。 */
export function App({ dependencies }: AppProps) {
  const router = useMemo(() => createAppRouter(dependencies), [dependencies]);
  return <RouterProvider router={router} />;
}
