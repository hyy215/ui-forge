/** 按用户操作读取诊断；保留已有报告并通过宿主支持的方式导出。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Input, Spin, Tooltip } from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { TaskDiagnostics } from "@ui-forge/shared-protocol";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import { TaskDiagnosticsReport } from "./TaskDiagnosticsReport";
import styles from "./TaskDiagnostics.module.css";

/** 诊断面板只有读请求，打开、关闭和导出均不改变任务执行状态。 */
export function TaskDiagnosticsPanel({
  taskId,
  source,
  host,
}: {
  taskId: string;
  source: SessionDataSource;
  host: "vscode" | "browser";
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<TaskDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [showJson, setShowJson] = useState(false);
  const request = useRef<AbortController | null>(null);
  const focusAnchor = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    request.current?.abort();
    setBusy(false);
    setOpen(false);
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [close, open]);

  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    focusAnchor.current?.focus({ preventScroll: true });
    setBusy(true);
    setError(false);
    setExportMessage("");
    setShowJson(false);
    try {
      const next = await source.readDiagnostics(taskId, controller.signal);
      if (!controller.signal.aborted) setReport(next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function exportReport() {
    if (!report) return;
    const text = JSON.stringify(report, null, 2) + "\n";
    setExportMessage("");
    setShowJson(false);
    if (host === "vscode") {
      try {
        await navigator.clipboard.writeText(text);
        setExportMessage("已复制 JSON。");
      } catch {
        setShowJson(true);
        setExportMessage("未能复制，请选中下方 JSON 手动复制。");
      }
      return;
    }
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ui-forge-${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}-diagnostics.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setShowJson(true);
      setExportMessage("未能发起下载，请选中下方 JSON 手动复制。");
    } finally {
      if (url) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  return (
    <>
      <Tooltip title="查看任务诊断">
        <Button
          type="text"
          icon={<FileSearchOutlined />}
          aria-label="查看任务诊断"
          onClick={() => {
            setOpen(true);
            void refresh();
          }}
        />
      </Tooltip>
      <Drawer
        title="任务诊断"
        open={open}
        size={620}
        onClose={close}
        classNames={{ body: styles.body ?? "" }}
        styles={{ wrapper: { maxWidth: "100vw" } }}
      >
        <div ref={focusAnchor} className={styles.actions} tabIndex={-1}>
          <Tooltip title="刷新诊断">
            <Button
              icon={<ReloadOutlined />}
              aria-label="刷新诊断"
              loading={busy}
              disabled={busy}
              onClick={() => void refresh()}
            />
          </Tooltip>
          <Tooltip title={host === "vscode" ? "复制诊断 JSON" : "导出诊断 JSON"}>
            <Button
              icon={host === "vscode" ? <CopyOutlined /> : <DownloadOutlined />}
              aria-label={host === "vscode" ? "复制诊断 JSON" : "导出诊断 JSON"}
              disabled={!report}
              onClick={() => void exportReport()}
            />
          </Tooltip>
        </div>
        {busy && (
          <div role="status" className={styles.loading}>
            <Spin size="small" />
            正在读取诊断…
          </div>
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title="诊断读取失败，请重试。"
            description={report ? "仍显示上次读取的报告。" : undefined}
            action={
              <Button size="small" disabled={busy} onClick={() => void refresh()}>
                重试读取
              </Button>
            }
          />
        )}
        {exportMessage && (
          <p role="status" className={styles.message}>
            {exportMessage}
          </p>
        )}
        {showJson && report && (
          <Input.TextArea
            aria-label="诊断 JSON"
            readOnly
            value={JSON.stringify(report, null, 2)}
            autoSize={{ minRows: 6, maxRows: 12 }}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        {report && <TaskDiagnosticsReport report={report} />}
      </Drawer>
    </>
  );
}
