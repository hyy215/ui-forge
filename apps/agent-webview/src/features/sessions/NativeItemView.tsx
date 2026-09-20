/** 用对话与可展开工具行呈现 Codex 原生 item，不将空消息和协议外壳作为正文。 */
import type { NativeItem } from "@ui-forge/shared-protocol";
import { z } from "zod";
import { MarkdownText } from "./MarkdownText";
import { SessionFileLink } from "./SessionFileLink";
import { FileChangesView } from "./FileChangesView";
import { NativeValueView } from "./NativeValueView";
import { stringValue } from "@ui-forge/client-core";
import styles from "./Sessions.module.css";

const labels: Record<string, string> = {
  reasoning: "思考摘要",
  commandExecution: "执行命令",
  fileChange: "文件修改",
  mcpToolCall: "工具调用",
  dynamicToolCall: "工具调用",
  collabAgentToolCall: "协作任务",
  subAgentActivity: "子任务",
  webSearch: "网页搜索",
  plan: "计划",
  imageView: "查看图片",
  functionCallOutput: "工具输出",
  contextCompaction: "已整理上下文",
  sleep: "等待",
};
const statuses: Record<string, string> = {
  inProgress: "进行中",
  completed: "已完成",
  failed: "失败",
  declined: "已拒绝",
  interrupted: "已停止",
};
/** 在折叠行中保留可识别目标，避免完整命令、路径或工具参数挤占时间线。 */
function compact(value: string, limit = 88): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
/** 正文保持原文；仅对命令、补丁和工具载荷添加展示结构。 */
export function NativeItemView({ item }: { item: NativeItem }) {
  if (item.type === "userMessage") {
    const content = z
      .array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
          path: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .catch([])
      .parse(item.content);
    return (
      <article className={styles.userMessage}>
        <span className={styles.messageAuthor}>你</span>
        {content.map((part, i) =>
          part.type === "text" ? (
            <p key={i}>{part.text}</p>
          ) : part.type === "localImage" || part.type === "image" ? (
            <span className={styles.imageBadge} key={i} title={part.path}>
              ▧ 设计图片
            </span>
          ) : null,
        )}
      </article>
    );
  }
  if (["agentMessage", "plan", "enteredReviewMode", "exitedReviewMode"].includes(item.type)) {
    const text = stringValue(item.text) || stringValue(item.review);
    if (!text.trim()) return null;
    return (
      <article className={styles.agentMessage}>
        <span className={styles.messageAuthor}>{item.type === "plan" ? "计划" : "Codex"}</span>
        <MarkdownText text={text} />
      </article>
    );
  }
  const reasoning = z.array(z.string()).catch([]).parse(item.summary).join("\n").trim();
  if (item.type === "reasoning" && !reasoning) return null;
  const result = z
    .object({ content: z.unknown().optional(), structuredContent: z.unknown().optional() })
    .safeParse(item.result);
  const toolError = z.object({ message: z.string() }).safeParse(item.error);
  const isTool = item.type === "mcpToolCall" || item.type === "dynamicToolCall";
  const actions = z
    .array(z.object({ type: z.string() }))
    .catch([])
    .parse(item.commandActions);
  const commandLabel =
    actions.length && actions.every((action) => action.type === "read")
      ? "读取文件"
      : actions.length && actions.every((action) => action.type === "search")
        ? "搜索"
        : actions.length && actions.every((action) => action.type === "listFiles")
          ? "查看目录"
          : "执行命令";
  const label = item.type === "commandExecution" ? commandLabel : (labels[item.type] ?? item.type);
  const summary =
    item.type === "reasoning"
      ? compact(reasoning)
      : isTool
        ? compact(
            [stringValue(item.server) || stringValue(item.namespace), stringValue(item.tool)]
              .filter(Boolean)
              .join(" · "),
          )
        : compact(
            stringValue(item.command) ||
              stringValue(item.query) ||
              stringValue(item.path) ||
              stringValue(item.tool),
          );
  const status = stringValue(item.status);
  return (
    <details className={styles.toolItem} data-status={status}>
      <summary>
        <span className={styles.toolIcon} aria-hidden="true">
          {status === "failed"
            ? "!"
            : status === "completed"
              ? "✓"
              : item.type === "commandExecution"
                ? "›_"
                : "◇"}
        </span>
        <span className={styles.toolLabel}>{label}</span>
        <span className={styles.toolSummary} title={summary}>
          {summary}
        </span>
        <span className={styles.toolStatus}>{statuses[status] ?? status}</span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </summary>
      <div className={styles.toolBody}>
        {item.type === "reasoning" ? <MarkdownText text={reasoning} /> : null}
        {item.type === "commandExecution" && (
          <>
            <pre className={styles.commandPreview}>
              <code>{stringValue(item.command)}</code>
            </pre>
            <p className={styles.toolMeta}>
              {stringValue(item.cwd)}
              {typeof item.exitCode === "number" ? " · 退出码 " + item.exitCode : ""}
              {typeof item.durationMs === "number"
                ? " · " + (item.durationMs / 1000).toFixed(1) + "s"
                : ""}
            </p>
            {stringValue(item.aggregatedOutput) ? (
              <pre>{stringValue(item.aggregatedOutput)}</pre>
            ) : (
              <p className={styles.hint}>
                {status === "inProgress" ? "等待命令输出…" : "无终端输出"}
              </p>
            )}
          </>
        )}
        {item.type === "fileChange" && <FileChangesView changes={item.changes} />}
        {isTool && (
          <>
            <NativeValueView value={item.arguments} />
            <NativeValueView
              value={
                item.type === "dynamicToolCall"
                  ? item.contentItems
                  : result.success
                    ? result.data.content
                    : undefined
              }
            />
            {result.success &&
              result.data.structuredContent !== null &&
              result.data.structuredContent !== undefined && (
                <details>
                  <summary>结构化结果</summary>
                  <NativeValueView value={result.data.structuredContent} />
                </details>
              )}
            {toolError.success && <p className={styles.toolError}>{toolError.data.message}</p>}
          </>
        )}
        {item.type === "collabAgentToolCall" && (
          <>
            <MarkdownText text={stringValue(item.prompt)} />
            <NativeValueView value={item.agentsStates} />
          </>
        )}
        {item.type === "functionCallOutput" && <NativeValueView value={item.output} />}
        {item.type === "webSearch" && (
          <>
            <p>{stringValue(item.query)}</p>
            <NativeValueView value={item.action} />
          </>
        )}
        {item.type === "imageView" && (
          <p className={styles.toolMeta}>
            <SessionFileLink path={stringValue(item.path)}>
              {stringValue(item.path)}
            </SessionFileLink>
          </p>
        )}
        {![
          "reasoning",
          "commandExecution",
          "fileChange",
          "mcpToolCall",
          "dynamicToolCall",
          "collabAgentToolCall",
          "functionCallOutput",
          "webSearch",
          "imageView",
        ].includes(item.type) && (
          <details className={styles.rawDetails}>
            <summary>技术详情</summary>
            <NativeValueView value={item} />
          </details>
        )}
      </div>
    </details>
  );
}
