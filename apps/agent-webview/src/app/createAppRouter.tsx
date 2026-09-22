/** 组装首页、原生会话与独立规则配置页的 hash 路由。 */
import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import { createSessionDataSource } from "../data-sources/sessionDataSource";
import { createSessionFileSource } from "../data-sources/sessionFileSource";
import type { AppDependencies } from "./appDependencies";
import { AppLayout } from "./AppLayout";
import { appPaths } from "./appPaths";

const HomePage = lazy(() =>
  import("../features/home/HomePage").then((module) => ({ default: module.HomePage })),
);
const TaskPage = lazy(() =>
  import("../features/sessions/TaskPage").then((module) => ({ default: module.TaskPage })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const loading = (
  <div className="bootstrap-state" role="status">
    正在加载页面…
  </div>
);

/** 所有页面复用同一传输数据源，页面切换不会停止服务端任务。 */
export function createAppRouter(dependencies: AppDependencies) {
  const source = createSessionDataSource(dependencies.communicationClient);
  const files = createSessionFileSource(
    dependencies.communicationClient,
    dependencies.host ?? "browser",
  );
  return createHashRouter([
    {
      element: (
        <AppLayout fixture={dependencies.fixture ?? false} host={dependencies.host ?? "browser"} />
      ),
      children: [
        {
          path: appPaths.home,
          element: (
            <Suspense fallback={loading}>
              <HomePage source={source} host={dependencies.host ?? "browser"} />
            </Suspense>
          ),
        },
        {
          path: appPaths.task,
          element: (
            <Suspense fallback={loading}>
              <TaskPage
                source={source}
                files={files}
                host={dependencies.host ?? "browser"}
                {...(dependencies.workspacePath
                  ? { workspacePath: dependencies.workspacePath }
                  : {})}
              />
            </Suspense>
          ),
        },
        {
          path: appPaths.settings,
          element: (
            <Suspense fallback={loading}>
              <SettingsPage source={source} />
            </Suspense>
          ),
        },
        { path: "*", element: <Navigate to={appPaths.home} replace /> },
      ],
    },
  ]);
}
