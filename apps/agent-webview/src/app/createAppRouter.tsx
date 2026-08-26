/** 使用 React Router 组装 Webview 的声明式顶层路由表。 */
import { createHashRouter, Navigate } from "react-router-dom";
import { createTaskWorkflowDataSource } from "../data-sources/task-workflow";
import { HomePage } from "../features/home/HomePage";
import { TaskWorkflowBootstrap } from "../features/task-workflow/TaskWorkflowBootstrap";
import type { AppDependencies } from "./appDependencies";
import { appPaths } from "./appPaths";

/** 根据应用依赖创建适用于 VS Code Webview 的 hash 路由器。 */
export function createAppRouter(dependencies: AppDependencies) {
  const taskWorkflowDataSource = createTaskWorkflowDataSource(
    dependencies.communicationClient,
  );

  return createHashRouter([
    {
      path: appPaths.home,
      element: <HomePage />,
    },
    {
      path: appPaths.taskWorkflowNew,
      element: <TaskWorkflowBootstrap dataSource={taskWorkflowDataSource} mode="new" />,
    },
    {
      path: appPaths.taskWorkflow,
      element: <TaskWorkflowBootstrap dataSource={taskWorkflowDataSource} mode="existing" />,
    },
    {
      path: "*",
      element: <Navigate to={appPaths.home} replace />,
    },
  ]);
}
