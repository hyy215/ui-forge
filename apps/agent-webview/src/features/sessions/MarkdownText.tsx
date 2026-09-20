/** 安全展示常用 Markdown 文本与代码块；不解释模型输出中的 HTML。 */
import { Fragment, type ReactNode } from "react";
import { inlineMarkdown } from "./inlineMarkdown";
import { SessionFileLink } from "./SessionFileLink";
import styles from "./Sessions.module.css";

/** 将代码、段落、标题与列表转换为 React 文本节点，不使用 innerHTML。 */
export function MarkdownText({ text }: { text: string }) {
  const sections = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return (
    <div className={styles.markdown}>
      {sections.map((section, index) => {
        if (section.startsWith("```")) {
          const newline = section.indexOf("\n");
          return (
            <pre key={index}>
              <code>{section.slice(newline + 1).replace(/```$/, "")}</code>
            </pre>
          );
        }
        return (
          <Fragment key={index}>
            {section
              .split(/\n\n+/)
              .filter(Boolean)
              .map((paragraph, row) => {
                const heading = /^(#{1,6})\s+(.+)$/.exec(paragraph);
                if (heading) return <h3 key={row}>{inline(heading[2] ?? "")}</h3>;
                const lines = paragraph.split("\n");
                if (lines.every((line) => /^\s*[-*]\s/.test(line)))
                  return (
                    <ul key={row}>
                      {lines.map((line, i) => (
                        <li key={i}>{inline(line.replace(/^\s*[-*]\s/, ""))}</li>
                      ))}
                    </ul>
                  );
                if (lines.every((line) => /^\s*\d+\.\s/.test(line)))
                  return (
                    <ol key={row}>
                      {lines.map((line, i) => (
                        <li key={i}>{inline(line.replace(/^\s*\d+\.\s/, ""))}</li>
                      ))}
                    </ol>
                  );
                return <p key={row}>{inline(paragraph)}</p>;
              })}
          </Fragment>
        );
      })}
    </div>
  );
}

/** 将已分类的链接交给相应打开方式，所有标签和正文仍由 React 转义。 */
function inline(text: string): ReactNode[] {
  return inlineMarkdown(text).map((token, i) => {
    if (token.type === "code") return <code key={i}>{token.text}</code>;
    if (token.type === "strong") return <strong key={i}>{token.text}</strong>;
    if (token.type === "web")
      return (
        <a key={i} href={token.href} target="_blank" rel="noopener noreferrer">
          {token.text}
        </a>
      );
    if (token.type === "file")
      return (
        <SessionFileLink key={i} path={token.href}>
          {token.text}
        </SessionFileLink>
      );
    return token.text;
  });
}
