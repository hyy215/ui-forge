/** 后续消息输入框，支持文字、选图、粘贴和拖放，提交失败时保留草稿。 */
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Space } from "antd";
import { StopOutlined } from "@ant-design/icons";
import type { SendSessionInput } from "@ui-forge/shared-protocol";
import { readImage } from "./imageInput";
import styles from "./Sessions.module.css";

/** 当前任务的输入与操作回调；切换任务时由父组件通过 key 重置草稿。 */
interface TaskComposerProps {
  connected: boolean;
  busy: boolean;
  error: string;
  onSend: (text: string, images: SendSessionInput["images"]) => Promise<unknown>;
  onStop?: (() => Promise<unknown>) | undefined;
  stopTurnId?: string | undefined;
}

interface StopFeedback {
  turnId: string;
  phase: "requesting" | "accepted" | "uncertain";
  details?: string;
}

/** 发送真实输入，成功后清空，异步读取或提交期间阻止重复发送。 */
export function TaskComposer({
  connected,
  busy,
  error,
  onSend,
  onStop,
  stopTurnId,
}: TaskComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<SendSessionInput["images"]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [stopFeedback, setStopFeedback] = useState<StopFeedback | null>(null);
  const stopRequest = useRef<object | null>(null);
  const currentStopTurn = useRef(stopTurnId);
  currentStopTurn.current = stopTurnId;
  const reading = useRef(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setStopFeedback(null);
    stopRequest.current = null;
  }, [stopTurnId]);
  const feedback = stopFeedback?.turnId === stopTurnId ? stopFeedback : null;
  const stopAccepted = feedback?.phase === "accepted";
  const disabled = busy || !connected;
  const stop = async () => {
    if (
      disabled ||
      sending.current ||
      !onStop ||
      !stopTurnId ||
      stopRequest.current ||
      stopAccepted
    )
      return;
    const request = {};
    const requestedTurn = stopTurnId;
    stopRequest.current = request;
    setStopFeedback({ turnId: requestedTurn, phase: "requesting" });
    try {
      await onStop();
      if (mounted.current && currentStopTurn.current === requestedTurn)
        setStopFeedback({ turnId: requestedTurn, phase: "accepted" });
    } catch (failure) {
      if (mounted.current && currentStopTurn.current === requestedTurn)
        setStopFeedback({
          turnId: requestedTurn,
          phase: "uncertain",
          details: failure instanceof Error ? failure.message.slice(0, 2000) : "停止请求失败。",
        });
    } finally {
      if (stopRequest.current === request) stopRequest.current = null;
    }
  };
  const addImages = async (files: File[]) => {
    if (disabled || reading.current || sending.current || !files.length) return;
    reading.current = true;
    setUploading(true);
    try {
      if (images.length + files.length > 4) throw new Error("最多添加 4 张图片。");
      const added = await Promise.all(files.map(readImage));
      if (mounted.current) {
        setImages((current) => [...current, ...added]);
        setImageError("");
      }
    } catch (failure) {
      if (mounted.current)
        setImageError(failure instanceof Error ? failure.message : "图片读取失败。");
    } finally {
      reading.current = false;
      if (mounted.current) setUploading(false);
    }
  };
  const send = async () => {
    if (
      disabled ||
      reading.current ||
      sending.current ||
      stopRequest.current ||
      (!text.trim() && !images.length)
    )
      return;
    sending.current = true;
    try {
      await onSend(text, images);
      if (mounted.current) {
        setText("");
        setImages([]);
        setImageError("");
      }
    } catch {
      /* 父组件展示发送错误，文字和图片留在当前草稿中。 */
    } finally {
      sending.current = false;
    }
  };
  return (
    <form
      className={styles.composer}
      aria-label="发送消息"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        void addImages(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length) {
          event.preventDefault();
          void addImages(files);
        }
      }}
    >
      {(imageError || error) && <Alert title={imageError || error} type="error" showIcon />}
      {images.length > 0 && (
        <div className={styles.composerAttachments} aria-label="待发送图片">
          {images.map((image, index) => (
            <div className={styles.attachment} key={index}>
              <img src={image.dataUrl} alt={image.name} />
              <span title={image.name}>{image.name}</span>
              <Button
                size="small"
                disabled={disabled || uploading}
                aria-label={"移除 " + image.name}
                onClick={() => {
                  setImages((current) => current.filter((_, i) => i !== index));
                  setImageError("");
                }}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
      <Input.TextArea
        variant="borderless"
        aria-label="补充需求"
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder="补充需求，或粘贴、拖入图片…"
        disabled={disabled}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className={styles.composerTools}>
        <label className={styles.uploadLabel}>
          {uploading ? "正在读取…" : "＋ 添加图片"}
          <input
            type="file"
            aria-label="添加对话图片"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={disabled || uploading || images.length >= 4}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addImages(files);
            }}
          />
        </label>
        <span className={styles.hint}>PNG / JPEG / WebP · 最多 4 张 · 每张 5 MiB</span>
      </div>
      <div className={styles.composerFooter}>
        <span>关闭页面后，任务继续运行</span>
        <Space>
          {onStop && stopTurnId && (
            <Button
              danger
              aria-label={
                stopAccepted
                  ? "停止请求已提交"
                  : feedback?.phase === "uncertain"
                    ? "再次请求停止"
                    : "停止本轮"
              }
              icon={<StopOutlined aria-hidden="true" />}
              loading={feedback?.phase === "requesting"}
              disabled={disabled || stopAccepted}
              onClick={() => {
                void stop();
              }}
            >
              {stopAccepted
                ? "停止请求已提交"
                : feedback?.phase === "uncertain"
                  ? "再次请求停止"
                  : "停止本轮"}
            </Button>
          )}
          <Button
            htmlType="submit"
            type="primary"
            loading={busy}
            disabled={disabled || uploading || (!text.trim() && !images.length)}
          >
            {onStop ? "发送补充" : "发送"}
          </Button>
        </Space>
      </div>
      {onStop && feedback && (
        <div className={styles.stopFeedback} role="status" aria-live="polite">
          {feedback.phase === "requesting" ? (
            <p>正在发送停止请求，尚未确认本轮停止。</p>
          ) : feedback.phase === "accepted" ? (
            <p>停止请求已提交，等待 Codex 确认。本轮仍以原生状态为准。</p>
          ) : (
            <>
              <p>停止请求未确认，请先核对当前状态，勿重复提交。</p>
              <details className={styles.failureTechnical}>
                <summary>停止请求详情</summary>
                <pre>{feedback.details}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </form>
  );
}
