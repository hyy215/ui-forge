/** 负责初始化任务快照，并处理工作流页面挂载前的加载和错误状态。 */
import { useEffect, useState } from "react";
import { Alert, Spin } from "antd";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../data-sources/task-workflow";
import { UiForgeApp } from "./UiForgeApp";

/** 任务工作流快照的加载状态。 */
type SnapshotLoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: D2CWorkflowSnapshot }
  | { status: "error"; message: string };

/** 任务工作流启动组件接收的数据源。 */
export interface TaskWorkflowBootstrapProps {
  dataSource: TaskWorkflowDataSource;
}

/** 加载运行时任务快照，并在数据就绪前展示明确状态。 */
export function TaskWorkflowBootstrap({ dataSource }: TaskWorkflowBootstrapProps) {
  const [loadState, setLoadState] = useState<SnapshotLoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void dataSource.initialize(controller.signal).then(
      (snapshot) => {
        if (active) setLoadState({ status: "ready", snapshot });
      },
      (error: unknown) => {
        if (!active) return;
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "任务快照加载失败。",
        });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [dataSource]);

  if (loadState.status === "loading") {
    return <div className="bootstrap-state"><Spin description="正在加载任务…" /></div>;
  }
  if (loadState.status === "error") {
    return <div className="bootstrap-state"><Alert type="error" showIcon title="无法加载任务" description={loadState.message} /></div>;
  }
  return <UiForgeApp dataSource={dataSource} initialSnapshot={loadState.snapshot} />;
}
