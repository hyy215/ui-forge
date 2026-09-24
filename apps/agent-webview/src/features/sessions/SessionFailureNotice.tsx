/** 展示原生轮次失败原因，只有用户主动点击时才在原任务中请求继续。 */
import { useState } from "react";
import { Alert, Button } from "antd";
import { getSessionFailure, summarizeRecordedWork } from "@ui-forge/client-core";
import type { NativeTurn } from "@ui-forge/shared-protocol";
import styles from "./Sessions.module.css";

/** 历史失败保留原因；仅最新失败轮次允许显示继续入口。 */
export function SessionFailureNotice({
  turn,
  busy,
  connected,
  onContinue,
}: {
  turn: NativeTurn;
  busy: boolean;
  connected: boolean;
  onContinue?: (() => Promise<unknown>) | undefined;
}) {
  const [continueError, setContinueError] = useState("");
  const failure = getSessionFailure(turn.error ?? { message: "原生轮次未提供错误详情。" });
  if (!failure) return null;
  return (
    <Alert
      title={failure.title}
      type="error"
      showIcon
      description={
        <div className={styles.failureDetails}>
          <p>{failure.message}</p>
          <p>
            <strong>下一步：</strong>
            {failure.guidance}
          </p>
          <p>
            <strong>本轮已记录工作：</strong>
            {summarizeRecordedWork([turn])}
          </p>
          <details className={styles.failureTechnical}>
            <summary>原始错误详情</summary>
            <pre>{failure.details}</pre>
          </details>
          {failure.canContinue && onContinue && (
            <Button
              loading={busy}
              disabled={busy || !connected}
              onClick={() => {
                setContinueError("");
                void onContinue().catch((reason: unknown) => {
                  setContinueError(
                    reason instanceof Error
                      ? reason.message.slice(0, 2000)
                      : "请求失败，暂未取得确认。",
                  );
                });
              }}
            >
              继续当前任务
            </Button>
          )}
          {continueError && onContinue && (
            <div className={styles.continuationError} role="alert">
              <p>继续请求未确认，请先核对当前状态，勿重复提交。</p>
              <p>{continueError}</p>
            </div>
          )}
        </div>
      }
    />
  );
}
