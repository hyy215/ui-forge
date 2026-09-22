/** 展示任务保存时的设计绑定，不从当前全局设置猜测既有任务接入。 */
import type { DesignBinding } from "@ui-forge/shared-protocol";
import styles from "./DesignSource.module.css";

/** 无绑定的历史任务明确标记沿用 Magic，避免展示为当前新建任务的默认来源。 */
export function TaskDesignBinding({ binding }: { binding: DesignBinding | undefined }) {
  const source = binding?.source;
  return (
    <div className={styles.binding} aria-label="任务设计绑定">
      <span>
        {!source
          ? "历史任务 · 接入：Magic（来源未记录）"
          : source.kind === "local"
            ? "来源：图片/文字 · 无平台接入"
            : `来源：MasterGo · 接入：${source.connection.kind === "magic" ? "Magic" : "Vibe"}`}
      </span>
      {source?.kind === "mastergo" && (
        <a href={source.url} target="_blank" rel="noreferrer">
          设计链接
        </a>
      )}
      {binding?.target && (
        <span>
          文件 {binding.target.documentId} · 页面 {binding.target.pageId ?? "未记录"} · 节点{" "}
          {binding.target.nodeId}
        </span>
      )}
    </div>
  );
}
