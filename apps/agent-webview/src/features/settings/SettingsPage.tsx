/** 独立规则配置路由，分别编辑真实的设计与工程 Markdown 文件。 */
import { App } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
import type { InstructionKind } from "@ui-forge/shared-protocol";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import { RuleEditor } from "./RuleEditor";
import styles from "./Settings.module.css";

/** 配置仅影响后续新任务的规则，已运行的会话保留原有上下文。 */
export function SettingsPage({ source }: { source: SessionDataSource }) {
  const [active, setActive] = useState<InstructionKind>("design");
  const [dirtyFiles, setDirtyFiles] = useState({ design: false, project: false });
  const onDirty = useCallback(
    (kind: InstructionKind, dirty: boolean) =>
      setDirtyFiles((current) =>
        current[kind] === dirty ? current : { ...current, [kind]: dirty },
      ),
    [],
  );
  const dirty = dirtyFiles.design || dirtyFiles.project;
  const blocker = useBlocker(dirty);
  const { modal } = App.useApp();
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = modal.confirm({
      title: "还有未保存的规则",
      content: "离开将丢弃当前编辑。",
      okText: "离开",
      cancelText: "继续编辑",
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => {
      dialog.destroy();
    };
  }, [blocker, modal]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>规则文件</h1>
          <p className={styles.description}>保存后，页面和 CLI 的新任务共用这些规则。</p>
        </div>
        <nav className={styles.files} aria-label="规则文件">
          {(["design", "project"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={active === kind}
              onClick={() => setActive(kind)}
            >
              <strong>
                {kind}.md{dirtyFiles[kind] && <span aria-label="未保存"> ·</span>}
              </strong>
              <span>{kind === "design" ? "设计规则" : "工程规则"}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className={styles.editors}>
        <RuleEditor kind="design" source={source} onDirty={onDirty} active={active === "design"} />
        <RuleEditor
          kind="project"
          source={source}
          onDirty={onDirty}
          active={active === "project"}
        />
      </div>
    </main>
  );
}
