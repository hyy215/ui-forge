/** 按需只读核对任务交付记录，不将任务执行结束或工具成功解释为验收通过。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Spin, Tooltip } from "antd";
import { AuditOutlined, ReloadOutlined } from "@ant-design/icons";
import type { TaskDelivery } from "@ui-forge/shared-protocol";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import { TaskDeliveryReport } from "./TaskDeliveryReport";
import styles from "./TaskDelivery.module.css";

/** 关闭或卸载取消读取；刷新失败仍保留明确标注的上次核对结果。 */
export function TaskDeliveryPanel({
  taskId,
  source,
}: {
  taskId: string;
  source: SessionDataSource;
}) {
  const [open, setOpen] = useState(false);
  const [delivery, setDelivery] = useState<TaskDelivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const close = useCallback(() => {
    request.current?.abort();
    setBusy(false);
    setOpen(false);
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, open]);

  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      const result = await source.readDelivery(taskId, controller.signal);
      if (!controller.signal.aborted) setDelivery(result);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <Tooltip title="查看交付结果">
        <Button
          size="small"
          color="primary"
          variant="outlined"
          icon={<AuditOutlined />}
          aria-label="查看交付结果"
          onClick={() => {
            setOpen(true);
            void refresh();
          }}
        >
          交付结果
        </Button>
      </Tooltip>
      <Drawer
        title="交付结果"
        open={open}
        size={640}
        onClose={close}
        classNames={{ body: styles.body ?? "" }}
        styles={{ wrapper: { maxWidth: "100vw" } }}
      >
        <div className={styles.actions}>
          <Tooltip title="刷新证据核对">
            <Button
              icon={<ReloadOutlined />}
              aria-label="刷新证据核对"
              loading={busy}
              disabled={busy}
              onClick={() => void refresh()}
            />
          </Tooltip>
        </div>
        {busy && (
          <div className={styles.loading} role="status">
            <Spin size="small" />
            正在核对交付记录…
          </div>
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title="交付结果读取失败，请重试。"
            description={
              delivery
                ? "仍显示上次核对结果，当前证据与源码状态尚未确认。"
                : "尚未取得可核对的交付记录。"
            }
            action={
              <Button size="small" disabled={busy} onClick={() => void refresh()}>
                重试读取
              </Button>
            }
          />
        )}
        {delivery && <TaskDeliveryReport delivery={delivery} />}
      </Drawer>
    </>
  );
}
