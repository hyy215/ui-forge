/** 展示真正可打开的本地文件链接，并就地报告宿主打开失败。 */
import { useContext, useState, type MouseEvent, type ReactNode } from "react";
import { SessionFileContext } from "./sessionFileContext";
import styles from "./Sessions.module.css";

/** 保留链接标题；浏览器新页打开真实内容，VS Code 使用原生文件预览。 */
export function SessionFileLink({ path, children }: { path: string; children: ReactNode }) {
  const context = useContext(SessionFileContext);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  if (!context) return <>{children}</>;
  const input = { taskId: context.taskId, path };
  const open = context.source.open;
  const handleOpen = open
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        // VS Code 的窗口级链接监听不检查 defaultPrevented，必须阻止二次打开。
        event.stopPropagation();
        if (opening) return;
        setError("");
        setOpening(true);
        void open(input)
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "文件无法打开。");
          })
          .finally(() => setOpening(false));
      }
    : undefined;
  return (
    <>
      <a
        href={context.source.href(input)}
        title={path}
        target={open ? undefined : "_blank"}
        rel="noopener noreferrer"
        aria-busy={opening}
        onClick={handleOpen}
        onAuxClick={
          handleOpen
            ? (event) => {
                if (event.button === 1) handleOpen(event);
              }
            : undefined
        }
      >
        {children}
      </a>
      {error && (
        <span className={styles.fileLinkError} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
