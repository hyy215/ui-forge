/** 订阅原生会话并维护展示缓存；清理订阅不会发送停止请求。 */
import { useCallback, useEffect, useState } from "react";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import {
  applySessionEvent,
  emptyPresentation,
  emptyTaskObservation,
  observeTaskEvent,
  type TaskObservation,
} from "@ui-forge/client-core";

/** 断开后有限重连；任务操作从不自动重试。 */
export function useTaskSession(source: SessionDataSource, taskId: string | null) {
  const [state, setState] = useState(emptyPresentation);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [observation, setObservation] = useState<TaskObservation | null>(null);
  useEffect(() => {
    if (!taskId) {
      setState(emptyPresentation());
      setObservation(null);
      return;
    }
    const controller = new AbortController();
    setState(emptyPresentation());
    setError("");
    const connect = async () => {
      for (let retry = 0; retry < 5 && !controller.signal.aborted; retry += 1) {
        setObservation(emptyTaskObservation(taskId, Date.now()));
        try {
          await source.subscribe(
            taskId,
            (event) => {
              if (!controller.signal.aborted) {
                setState((current) => applySessionEvent(current, event));
                const observedAt = Date.now();
                setObservation((current) =>
                  observeTaskEvent(
                    current ?? emptyTaskObservation(taskId, observedAt),
                    event,
                    observedAt,
                  ),
                );
              }
            },
            controller.signal,
          );
          if (!controller.signal.aborted) throw new Error("连接已结束，正在重新读取会话。");
        } catch (e) {
          if (controller.signal.aborted) return;
          setState((current) =>
            applySessionEvent(current, {
              type: "close",
              message: e instanceof Error ? e.message : "连接失败",
            }),
          );
        }
        if (!controller.signal.aborted && retry < 4)
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, Math.min(1000 * 2 ** retry, 8000));
            controller.signal.addEventListener("abort", done, { once: true });
          });
      }
    };
    void connect();
    return () => {
      controller.abort();
    };
  }, [source, taskId, attempt]);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失败";
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  return {
    state,
    observation,
    error,
    busy,
    run,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
