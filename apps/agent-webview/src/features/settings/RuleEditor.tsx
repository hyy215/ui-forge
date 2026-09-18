/** 编辑真实 Markdown 文件，提供保存快捷键、加载反馈和失败时的草稿保留。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Spin } from "antd";
import type { InstructionDocument, InstructionKind } from "@ui-forge/shared-protocol";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import styles from "./Settings.module.css";

/** 两份文件各自保留草稿与版本，仅当前文件响应保存快捷键。 */
export function RuleEditor({
  kind,
  source,
  onDirty,
  active,
}: {
  kind: InstructionKind;
  source: SessionDataSource;
  onDirty: (kind: InstructionKind, dirty: boolean) => void;
  active: boolean;
}) {
  const [document, setDocument] = useState<InstructionDocument>();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [load, setLoad] = useState(0);
  const savingRef = useRef(false);
  const { modal } = App.useApp();
  const dirty = Boolean(document && content !== document.content);

  useEffect(() => {
    onDirty(kind, dirty);
    return () => onDirty(kind, false);
  }, [kind, dirty, onDirty]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    source
      .readInstruction(kind, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setDocument(result);
          setContent(result.content);
          setSaved(false);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [kind, source, load]);

  const reload = () => {
    if (dirty)
      modal.confirm({
        title: "重新加载文件？",
        content: "当前未保存内容将被磁盘文件替换。",
        okText: "重新加载",
        cancelText: "继续编辑",
        onOk: () => setLoad((value) => value + 1),
      });
    else setLoad((value) => value + 1);
  };

  const save = useCallback(async () => {
    if (!document || loading || savingRef.current || !dirty || !content.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await source.saveInstruction(document, content);
      setDocument(result);
      setContent(result.content);
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [document, content, dirty, loading, source]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (!event.repeat) void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, save]);

  return (
    <section className={styles.editor} aria-label={`${kind}.md 编辑器`} hidden={!active}>
      <header className={styles.fileHeader}>
        <strong>{kind}.md</strong>
        <span role="status" className={dirty ? styles.unsaved : undefined}>
          {loading
            ? "正在加载…"
            : saving
              ? "正在保存…"
              : dirty
                ? "未保存"
                : saved
                  ? "已保存到文件"
                  : "Markdown"}
        </span>
      </header>
      {document && (
        <p className={styles.path} title={document.path}>
          {document.path}
        </p>
      )}
      {loading ? (
        <div className={styles.loading}>
          <Spin />
          <span>正在读取文件…</span>
        </div>
      ) : (
        <textarea
          aria-label={`${kind}.md 内容`}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setSaved(false);
          }}
          disabled={!document}
          readOnly={saving}
          spellCheck={false}
          className={styles.textarea}
        />
      )}
      {error && <Alert type="error" title={error} showIcon />}
      <footer className={styles.footer}>
        <span className={styles.editorInfo}>
          {content.split("\n").length} 行 · {content.length.toLocaleString()} 字符
          <span>⌘ / Ctrl + S 保存</span>
        </span>
        <div className={styles.actions}>
          <Button disabled={saving || loading} onClick={reload}>
            重新加载
          </Button>
          <Button
            type="primary"
            aria-label="保存文件"
            aria-busy={saving}
            loading={saving}
            disabled={loading || !document || !dirty || !content.trim()}
            onClick={() => void save()}
          >
            保存文件
          </Button>
        </div>
      </footer>
    </section>
  );
}
