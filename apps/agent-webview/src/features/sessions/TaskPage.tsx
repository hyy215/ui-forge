/** Codex 原生会话页面：展示消息与审批，支持补充输入、停止本轮和重新连接。 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Tag } from "antd";
import { z } from "zod";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import type { SessionFileSource } from "../../data-sources/sessionFileSource";
import { SessionFileContext } from "./sessionFileContext";
import { NativeItemView } from "./NativeItemView";
import { PendingRequestPanel } from "./PendingRequestPanel";
import { NewTaskForm } from "./NewTaskForm";
import { TaskComposer } from "./TaskComposer";
import { SessionActivityView } from "./SessionActivityView";
import { requestItem } from "@ui-forge/client-core";
import { useTaskSession } from "./useTaskSession";
import styles from "./Sessions.module.css";

/** 页面只有输入和展示状态；执行与审批状态始终来自 Codex。 */
export function TaskPage({
  source,
  files,
  workspacePath,
}: {
  source: SessionDataSource;
  files: SessionFileSource;
  workspacePath?: string;
}) {
  const [search, setSearch] = useSearchParams();
  const taskId = search.get("taskId");
  const [warning, setWarning] = useState("");
  const { state, error, busy, run, reconnect } = useTaskSession(source, taskId);
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
        onCreate={async (value) => {
          const result = await source.create(value);
          setWarning(result.warning ?? "");
          setSearch({ taskId: result.taskId });
        }}
      />
    );
  const lastTurn = snapshot?.thread.turns.at(-1);
  const pendingCount = snapshot?.pendingRequests.length ?? 0;
  const status = pendingCount
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
    <SessionFileContext value={{ taskId, source: files }}>
      <main className={styles.session}>
        <header className={styles.sessionHeader}>
          <div>
            <h1>{snapshot?.thread.name || snapshot?.thread.preview || "Codex 会话"}</h1>
            <p title={snapshot?.thread.cwd}>{snapshot?.thread.cwd ?? taskId}</p>
            <p className={styles.executionHint}>
              任务执行会逐步读取文件、运行命令、修改文件或调用工具；这些都是执行中的具体步骤。
            </p>
          </div>
          <Tag
            color={
              state.connection === "connected"
                ? pendingCount
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
        </header>
        {(state.notice || warning) && (
          <Alert
            title={state.notice || warning}
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
              {turn.error && (
                <Alert
                  title="Codex 返回错误"
                  description={
                    z
                      .object({ message: z.string() })
                      .catch({
                        message:
                          typeof turn.error === "string" ? turn.error : JSON.stringify(turn.error),
                      })
                      .parse(turn.error).message
                  }
                  type="error"
                />
              )}
            </section>
          ))}
          <SessionActivityView activities={state.activities} />
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
          error={error}
          onSend={(text, images) => run(() => source.send(taskId, text, images))}
          onStop={activeTurn ? () => run(() => source.stop(taskId, activeTurn.id)) : undefined}
        />
      </main>
    </SessionFileContext>
  );
}
