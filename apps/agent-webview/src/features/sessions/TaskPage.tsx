/** Codex 原生会话页面：展示消息与审批，支持补充输入、停止本轮和重新连接。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Tag } from "antd";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import type { SessionFileSource } from "../../data-sources/sessionFileSource";
import { SessionFileContext } from "./sessionFileContext";
import { NativeItemView } from "./NativeItemView";
import { PendingRequestPanel } from "./PendingRequestPanel";
import { NewTaskForm } from "./NewTaskForm";
import { TaskComposer } from "./TaskComposer";
import { TaskRuntimeStatus } from "./TaskRuntimeStatus";
import { SessionActivityView } from "./SessionActivityView";
import { SessionFailureNotice } from "./SessionFailureNotice";
import { TaskDiagnosticsPanel } from "./TaskDiagnosticsPanel";
import { TaskDeliveryPanel } from "./TaskDeliveryPanel";
import { TaskDesignBinding } from "./TaskDesignBinding";
import { requestItem } from "@ui-forge/client-core";
import { useTaskSession } from "./useTaskSession";
import styles from "./Sessions.module.css";

/** 页面只有输入和展示状态；执行与审批状态始终来自 Codex。 */
export function TaskPage({
  source,
  files,
  workspacePath,
  host = "browser",
}: {
  source: SessionDataSource;
  files: SessionFileSource;
  workspacePath?: string;
  host?: "vscode" | "browser";
}) {
  const [search, setSearch] = useSearchParams();
  const taskId = search.get("taskId");
  const fileContext = useMemo(() => (taskId ? { taskId, source: files } : null), [taskId, files]);
  const [warning, setWarning] = useState("");
  const [errorOrigin, setErrorOrigin] = useState<"composer" | "continue" | "stop">("composer");
  const { state, observation, error, busy, run, reconnect } = useTaskSession(source, taskId);
  const timeline = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const snapshot = state.snapshot;
  const activeTurn = snapshot?.thread.turns.findLast((turn) => turn.status === "inProgress");
  useEffect(() => {
    follow.current = true;
    setShowLatest(false);
  }, [taskId]);
  useEffect(() => {
    if (follow.current && timeline.current)
      timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [snapshot, state.activities]);
  if (!taskId)
    return (
      <NewTaskForm
        workspacePath={workspacePath}
        onCheck={source.checkDesignConnection}
        onCreate={async (value) => {
          const result = await source.create(value);
          setWarning(result.warning ?? "");
          setSearch({ taskId: result.taskId });
        }}
      />
    );
  const lastTurn = snapshot?.thread.turns.at(-1);
  const pendingCount = snapshot?.pendingRequests.length ?? 0;
  const nativeWaiting =
    activeTurn &&
    snapshot?.thread.status.type === "active" &&
    Array.isArray(snapshot.thread.status.activeFlags) &&
    snapshot.thread.status.activeFlags.some(
      (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
    );
  const status =
    pendingCount || nativeWaiting
      ? "等待确认"
      : activeTurn
        ? "运行中"
        : lastTurn?.status === "failed"
          ? "本轮失败"
          : lastTurn?.status === "interrupted"
            ? "本轮已停止"
            : lastTurn?.status === "completed"
              ? "本轮已结束"
              : "等待输入";
  return (
    <SessionFileContext value={fileContext}>
      <main className={styles.session}>
        <header className={styles.sessionHeader}>
          <div>
            <h1>{snapshot?.thread.name || snapshot?.thread.preview || "Codex 会话"}</h1>
            <p title={snapshot?.thread.cwd}>{snapshot?.thread.cwd ?? taskId}</p>
            <p className={styles.executionHint}>
              任务执行会逐步读取文件、运行命令、修改文件或调用工具；这些都是执行中的具体步骤。
            </p>
          </div>
          <div className={styles.sessionActions}>
            <TaskDeliveryPanel key={`delivery-${taskId}`} taskId={taskId} source={source} />
            <TaskDiagnosticsPanel key={taskId} taskId={taskId} source={source} host={host} />
            <Tag
              color={
                state.connection === "connected"
                  ? pendingCount || nativeWaiting
                    ? "warning"
                    : activeTurn
                      ? "processing"
                      : "default"
                  : "warning"
              }
            >
              {state.connection === "connected"
                ? status
                : state.connection === "connecting"
                  ? "连接中"
                  : "连接中断"}
            </Tag>
          </div>
        </header>
        {snapshot && <TaskDesignBinding binding={snapshot.designBinding} />}
        {snapshot && (
          <TaskRuntimeStatus
            thread={snapshot.thread}
            connected={state.connection === "connected"}
            observation={observation}
            pendingRequests={snapshot.pendingRequests}
          />
        )}
        {(state.notice || warning) && (
          <Alert
            title={
              state.connection === "closed"
                ? "连接异常，后台任务状态尚未确认"
                : state.notice || warning
            }
            description={
              state.connection === "closed" ? (
                <>
                  <p>这仅表示客户端连接异常，不代表后台任务停止或失败。</p>
                  <details className={styles.failureTechnical}>
                    <summary>连接详情</summary>
                    <pre>{state.notice.slice(0, 4000)}</pre>
                  </details>
                </>
              ) : undefined
            }
            type="warning"
            showIcon
            action={
              <Button size="small" onClick={reconnect}>
                重新连接
              </Button>
            }
          />
        )}
        <div
          className={styles.timeline}
          ref={timeline}
          onScroll={() => {
            const node = timeline.current;
            if (node) {
              follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              setShowLatest(!follow.current);
            }
          }}
          aria-label="会话消息"
        >
          {!snapshot && <div className={styles.emptySession}>正在读取 Codex 会话…</div>}
          {snapshot?.thread.turns.map((turn) => (
            <section key={turn.id} className={styles.turn}>
              {turn.items.map((item) => (
                <NativeItemView key={item.id} item={item} />
              ))}
              {turn.status === "failed" && (
                <SessionFailureNotice
                  turn={turn}
                  busy={busy}
                  connected={state.connection === "connected"}
                  onContinue={
                    turn.id === lastTurn?.id &&
                    turn.status === "failed" &&
                    !activeTurn &&
                    pendingCount === 0
                      ? () => {
                          setErrorOrigin("continue");
                          return run(() => source.continue(taskId));
                        }
                      : undefined
                  }
                />
              )}
              {turn.status === "interrupted" && (
                <Alert
                  type="info"
                  showIcon
                  title="本轮已停止，已有记录仍保留。"
                  description="停止不代表验收失败；已有文件和验证记录需要按当前工作区核对。"
                />
              )}
            </section>
          ))}
          <SessionActivityView
            activities={state.activities}
            thread={state.connection === "connected" ? snapshot?.thread : undefined}
          />
          {snapshot?.pendingRequests.map((pending) => (
            <PendingRequestPanel
              key={pending.token}
              pending={pending}
              item={requestItem(state, pending)}
              onRespond={async (token, result) => {
                await source.respond(taskId, token, result);
              }}
            />
          ))}
          {lastTurn?.status === "completed" && !activeTurn && (
            <p className={styles.turnComplete}>本轮已结束。审查与验证结论见 Codex 输出。</p>
          )}
        </div>
        {showLatest && (
          <div className={styles.latest}>
            <Button
              size="small"
              onClick={() => {
                follow.current = true;
                setShowLatest(false);
                if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
              }}
            >
              {pendingCount ? "查看待确认请求 ↓" : "回到最新消息 ↓"}
            </Button>
          </div>
        )}
        <TaskComposer
          key={taskId}
          connected={state.connection === "connected"}
          busy={busy}
          error={errorOrigin === "composer" ? error : ""}
          stopTurnId={activeTurn?.id}
          onSend={(text, images) => {
            setErrorOrigin("composer");
            return run(() => source.send(taskId, text, images));
          }}
          onStop={
            activeTurn
              ? () => {
                  setErrorOrigin("stop");
                  return run(() => source.stop(taskId, activeTurn.id));
                }
              : undefined
          }
        />
      </main>
    </SessionFileContext>
  );
}
