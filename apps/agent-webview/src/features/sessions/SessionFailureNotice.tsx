/** 展示原生轮次失败原因，只有用户主动点击时才在原任务中请求继续。 */
import { Alert, Button } from "antd";
import { getSessionFailure } from "@ui-forge/client-core";
import styles from "./Sessions.module.css";

/** 历史失败保留原因；仅最新失败轮次允许显示继续入口。 */
export function SessionFailureNotice({
  error,
  busy,
  connected,
  onContinue,
}: {
  error: unknown;
  busy: boolean;
  connected: boolean;
  onContinue?: (() => Promise<unknown>) | undefined;
}) {
  const failure = getSessionFailure(error);
  if (!failure) return null;
  return (
    <Alert
      title={failure.title}
      type="error"
      showIcon
      description={
        <div className={styles.failureDetails}>
          <p>{failure.message}</p>
          {failure.canContinue && onContinue && (
            <Button
              loading={busy}
              disabled={busy || !connected}
              onClick={() => void onContinue().catch(() => undefined)}
            >
              继续当前任务
            </Button>
          )}
        </div>
      }
    />
  );
}
