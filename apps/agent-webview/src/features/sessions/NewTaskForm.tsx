/** 新建任务的显式来源与接入选择；保留各来源草稿，检查连接不启动执行。 */
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Radio } from "antd";
import {
  defaultVibeEndpoint,
  defaultVibeStatusEndpoint,
  type CreateSessionInput,
  type DesignSource,
  type DesignConnectionCheck,
} from "@ui-forge/shared-protocol";
import { readImage } from "./imageInput";
import { readDesignSource, type MasterGoDraft } from "./designInput";
import { MasterGoFields } from "./MasterGoFields";
import styles from "./Sessions.module.css";

/** 来源与用户文字分别提交，避免把平台链接当作无绑定的普通提示词。 */
export function NewTaskForm({
  workspacePath,
  onCreate,
  onCheck,
}: {
  workspacePath?: string | undefined;
  onCreate: (input: CreateSessionInput) => Promise<void>;
  onCheck: (source: DesignSource, signal?: AbortSignal) => Promise<DesignConnectionCheck>;
}) {
  const [target, setTarget] = useState(workspacePath ?? "");
  const [sourceKind, setSourceKind] = useState<DesignSource["kind"]>("local");
  const [drafts, setDrafts] = useState<
    Record<
      DesignSource["kind"],
      { prompt: string; strictPixelAcceptance: boolean; images: CreateSessionInput["images"] }
    >
  >({
    local: { prompt: "", strictPixelAcceptance: false, images: [] },
    mastergo: { prompt: "", strictPixelAcceptance: false, images: [] },
  });
  const { prompt, strictPixelAcceptance, images } = drafts[sourceKind];
  const updateDraft = (update: Partial<(typeof drafts)["local"]>) =>
    setDrafts((current) => ({ ...current, [sourceKind]: { ...current[sourceKind], ...update } }));
  const [mastergo, setMastergo] = useState<MasterGoDraft>({
    url: "",
    connection: null,
    endpoint: defaultVibeEndpoint,
    statusEndpoint: defaultVibeStatusEndpoint,
  });
  const checkAbort = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<DesignConnectionCheck | null>(null);
  const [checkError, setCheckError] = useState("");
  const invalidateCheck = () => {
    checkAbort.current?.abort();
    checkAbort.current = null;
    setChecking(false);
    setCheckResult(null);
    setCheckError("");
  };
  useEffect(() => () => checkAbort.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const [error, setError] = useState("");
  const addImages = async (files: File[]) => {
    if (uploadLock.current || busy || !files.length) return;
    uploadLock.current = true;
    setUploading(true);
    try {
      if (images.length + files.length > 4) throw new Error("最多添加 4 张图片。");
      const uploaded = await Promise.all(files.map(readImage));
      setDrafts((current) => ({
        ...current,
        [sourceKind]: {
          ...current[sourceKind],
          images: [...current[sourceKind].images, ...uploaded],
        },
      }));
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "图片读取失败");
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };
  const checkConnection = async () => {
    invalidateCheck();
    const controller = new AbortController();
    checkAbort.current = controller;
    setChecking(true);
    try {
      const source = readDesignSource(sourceKind, mastergo);
      const result = await onCheck(source, controller.signal);
      if (!controller.signal.aborted) setCheckResult(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setCheckError(
          failure instanceof Error
            ? failure.message
            : "连接检查失败，请确认设计链接与本机服务后重试。",
        );
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };
  const create = async () => {
    if (busy || uploading) return;
    setBusy(true);
    setError("");
    try {
      const designSource = readDesignSource(sourceKind, mastergo);
      await onCreate({
        projectPath: target.trim(),
        prompt: [prompt.trim(), strictPixelAcceptance ? "启用严格像素验收。" : ""]
          .filter(Boolean)
          .join("\n\n"),
        images,
        designSource,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.setup}>
      <p className={styles.eyebrow}>NEW TASK</p>
      <h1>从这份设计开始。</h1>
      <p className={styles.description}>添加设计链接或图片，告诉 Codex 你想实现什么。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        className={styles.setupForm}
      >
        <label htmlFor="workspace">目标工作区</label>
        <Input
          id="workspace"
          value={target}
          readOnly={Boolean(workspacePath)}
          disabled={busy}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="已有项目或空目录的绝对路径"
        />
        <fieldset className={styles.designInputs}>
          <legend>设计来源</legend>
          <Radio.Group
            aria-label="设计来源"
            value={sourceKind}
            disabled={busy || uploading}
            onChange={(event) => {
              invalidateCheck();
              setError("");
              setSourceKind(event.target.value as DesignSource["kind"]);
            }}
          >
            <Radio value="local">图片/文字</Radio>
            <Radio value="mastergo">MasterGo</Radio>
          </Radio.Group>
          {sourceKind === "mastergo" && (
            <MasterGoFields
              draft={mastergo}
              disabled={busy}
              checking={checking}
              result={checkResult}
              error={checkError}
              onCheck={() => void checkConnection()}
              onChange={(draft) => {
                invalidateCheck();
                setError("");
                setMastergo(draft);
              }}
            />
          )}
          <div className={styles.designUploads}>
            <section
              className={styles.designSource}
              aria-label="设计图片输入"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addImages(Array.from(event.dataTransfer.files));
              }}
            >
              <span className={styles.sourceTitle}>
                <span aria-hidden="true">▧</span> 设计图片
              </span>
              <p>上传截图，或将图片拖到这里</p>
              <label className={styles.uploadLabel}>
                {uploading ? "正在读取…" : "＋ 添加设计图片"}
                <input
                  type="file"
                  aria-label="添加设计图片"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={busy || uploading || images.length >= 4}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void addImages(files);
                  }}
                />
              </label>
              <span className={styles.hint}>PNG / JPEG / WebP · 最多 4 张 · 每张 5 MiB</span>
            </section>
          </div>
          {images.length > 0 && (
            <div className={styles.attachments}>
              {images.map((image, index) => (
                <div key={index} className={styles.attachment}>
                  <img src={image.dataUrl} alt={image.name} />
                  <span>{image.name}</span>
                  <Button
                    size="small"
                    disabled={busy || uploading}
                    aria-label={"移除 " + image.name}
                    onClick={() =>
                      updateDraft({ images: images.filter((_, current) => current !== index) })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
        <label htmlFor="task-prompt">
          需求说明 <span className={styles.optional}>可选</span>
        </label>
        <Input.TextArea
          id="task-prompt"
          value={prompt}
          disabled={busy}
          onChange={(event) => updateDraft({ prompt: event.target.value })}
          rows={4}
          placeholder="描述页面功能、交互细节，或希望调整的部分…"
        />
        <div className={styles.acceptanceOption}>
          <Checkbox
            checked={strictPixelAcceptance}
            disabled={busy}
            aria-describedby="strict-pixel-hint"
            onChange={(event) => updateDraft({ strictPixelAcceptance: event.target.checked })}
          >
            严格像素验收
          </Checkbox>
          <p id="strict-pixel-hint" className={styles.hint}>
            逐像素比较设计原图与页面截图，输出差异图和验收结果。
          </p>
        </div>
        {error && <Alert title={error} type="error" showIcon />}
        <div className={styles.formFooter}>
          <span className={styles.hint}>也可以仅描述需求，直接开始。</span>
          <Button
            type="primary"
            htmlType="submit"
            loading={busy}
            disabled={
              uploading ||
              !target.trim() ||
              (sourceKind === "local"
                ? !prompt.trim() && !images.length
                : !mastergo.url.trim() || !mastergo.connection)
            }
          >
            开始执行任务 ↗
          </Button>
        </div>
      </form>
    </main>
  );
}
