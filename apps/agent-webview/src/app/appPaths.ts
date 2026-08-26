/** 集中定义 Webview 顶层页面使用的稳定路由路径。 */

/** Webview 已注册页面的路由路径。 */
export const appPaths = {
  home: "/",
  taskWorkflowNew: "/task-workflow/new",
  taskWorkflow: "/task-workflow/:taskId",
} as const;

/** 创建可直接恢复指定持久化任务的 Webview 路径。 */
export function createTaskWorkflowPath(taskId: string): string {
  return `/task-workflow/${encodeURIComponent(taskId)}`;
}
