/** 捕获 React 渲染异常，并为整个 Webview 提供可恢复的最后一道界面兜底。 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button } from "antd";

/** 应用错误边界接收的子树。 */
export interface AppErrorBoundaryProps {
  children: ReactNode;
}

/** 应用错误边界只记录是否进入渲染失败状态。 */
export interface AppErrorBoundaryState {
  hasError: boolean;
}

/** 在业务组件发生未捕获渲染异常时保留一个可重载的安全界面。 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  /** 标记当前应用子树是否发生过未捕获渲染异常。 */
  state: AppErrorBoundaryState = { hasError: false };

  /** 将未捕获的子树异常转换为稳定失败状态。 */
  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  /** 将渲染异常保留在本地诊断控制台，不向界面泄露异常详情。 */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ui-forge] Webview render failure", {
      errorName: error.name,
      componentStack: info.componentStack,
    });
  }

  /** 渲染正常应用子树，或在失败后提供明确恢复入口。 */
  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="bootstrap-state">
        <Alert
          type="error"
          showIcon
          title="Webview 显示异常"
          description="任务数据没有被修改。请重新加载 Webview；如果问题持续出现，请查看本地诊断日志。"
          action={
            <Button size="small" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          }
        />
      </div>
    );
  }
}
