/** 新建任务输入：设计链接和图片并列，支持选择严格像素验收并保留失败草稿。 */
import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Input } from "antd";
import type { CreateSessionInput } from "@ui-forge/shared-protocol";
import { readImage } from "./imageInput";
import styles from "./Sessions.module.css";

/** 把链接、需求和所选验收要求组成 Codex 输入；图片通过现有附件协议单独传递。 */
export function NewTaskForm({
  workspacePath,
  onCreate,
}: {
  workspacePath?: string | undefined;
  onCreate: (input: CreateSessionInput) => Promise<void>;
}) {
  const [target, setTarget] = useState(workspacePath ?? "");
  const [designUrl, setDesignUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [strictPixelAcceptance, setStrictPixelAcceptance] = useState(false);
  const [images, setImages] = useState<CreateSessionInput["images"]>([]);
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
      setImages((current) => [...current, ...uploaded]);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "图片读取失败");
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };
  const create = async () => {
    if (busy || uploading) return;
    setBusy(true);
    setError("");
    try {
      if (designUrl.trim()) {
        let url: URL;
        try {
          url = new URL(designUrl.trim());
        } catch {
          throw new Error("请输入完整的 http:// 或 https:// 设计链接。");
        }
        if (url.protocol !== "https:" && url.protocol !== "http:")
          throw new Error("设计链接仅支持 http:// 或 https://。");
      }
      await onCreate({
        projectPath: target.trim(),
        prompt: [designUrl.trim(), prompt.trim(), strictPixelAcceptance ? "启用严格像素验收。" : ""]
          .filter(Boolean)
          .join("\n\n"),
        images,
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
          <legend>
            设计输入 <span>可选其一，也可同时添加</span>
          </legend>
          <div className={styles.designGrid}>
            <section className={styles.designSource} aria-label="设计链接输入">
              <label htmlFor="design-url">
                <span aria-hidden="true">↗</span> 设计链接
              </label>
              <p>粘贴设计稿的页面或节点链接</p>
              <Input
                id="design-url"
                aria-label="设计链接"
                value={designUrl}
                disabled={busy}
                onChange={(event) => {
                  setDesignUrl(event.target.value);
                  setError("");
                }}
                placeholder="https://…"
              />
            </section>
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
                    onClick={() => setImages(images.filter((_, current) => current !== index))}
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
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          placeholder="描述页面功能、交互细节，或希望调整的部分…"
        />
        <div className={styles.acceptanceOption}>
          <Checkbox
            checked={strictPixelAcceptance}
            disabled={busy}
            aria-describedby="strict-pixel-hint"
            onChange={(event) => setStrictPixelAcceptance(event.target.checked)}
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
              uploading || !target.trim() || (!designUrl.trim() && !prompt.trim() && !images.length)
            }
          >
            开始执行任务 ↗
          </Button>
        </div>
      </form>
    </main>
  );
}
