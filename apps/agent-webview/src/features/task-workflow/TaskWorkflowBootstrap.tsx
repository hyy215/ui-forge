/** 负责初始化任务快照，并处理工作流页面挂载前的加载和错误状态。 */
import { useEffect, useState } from "react";
import { Alert, Spin } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import { createTaskWorkflowPath } from "../../app/appPaths";
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
  mode: "new" | "existing";
}

/** 新建或读取持久化任务快照，并在数据就绪前展示明确状态。 */
export function TaskWorkflowBootstrap({ dataSource, mode }: TaskWorkflowBootstrapProps) {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<SnapshotLoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const snapshotRequest = loadTaskWorkflowSnapshot(dataSource, mode, taskId, controller.signal);
    void snapshotRequest.then(
      (snapshot) => {
        if (!active) return;
        if (mode === "new") {
          navigate(createTaskWorkflowPath(snapshot.taskId), { replace: true });
          return;
        }
        setLoadState({ status: "ready", snapshot });
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
  }, [dataSource, mode, navigate, taskId]);

  if (loadState.status === "loading") {
    return <div className="bootstrap-state"><Spin description="正在加载任务…" /></div>;
  }
  if (loadState.status === "error") {
    return <div className="bootstrap-state"><Alert type="error" showIcon title="无法加载任务" description={loadState.message} /></div>;
  }
  return <UiForgeApp dataSource={dataSource} initialSnapshot={loadState.snapshot} />;
}

/** 根据路由语义创建新任务或只读恢复已有任务，不触发后续分析。 */
export function loadTaskWorkflowSnapshot(
  dataSource: TaskWorkflowDataSource,
  mode: "new" | "existing",
  taskId: string | undefined,
  signal: AbortSignal,
): Promise<D2CWorkflowSnapshot> {
  if (mode === "new") return dataSource.initialize(signal);
  if (!taskId) return Promise.reject(new Error("任务地址缺少 taskId。"));
  return dataSource.getSnapshot(taskId, signal);
}
