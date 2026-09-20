/** 展示 Codex 返回的文件变更及真实补丁，不从输出推断验收结果。 */
import { z } from "zod";
import { DiffView } from "./DiffView";
import styles from "./Sessions.module.css";

const changesSchema = z.array(
  z.object({
    path: z.string(),
    diff: z.string(),
    kind: z.object({ type: z.string(), move_path: z.string().nullable().optional() }),
  }),
);
/** 每个文件独立展开，默认只展示路径、操作和增删行数。 */
export function FileChangesView({ changes }: { changes: unknown }) {
  const parsed = changesSchema.safeParse(changes);
  if (!parsed.success) return <p className={styles.hint}>文件变更详情尚未返回。</p>;
  return (
    <div className={styles.fileChanges}>
      {parsed.data.map((change, index) => {
        const lines = change.diff.split("\n");
        const added = lines.filter(
          (line) => line.startsWith("+") && !line.startsWith("+++"),
        ).length;
        const removed = lines.filter(
          (line) => line.startsWith("-") && !line.startsWith("---"),
        ).length;
        return (
          <details key={index}>
            <summary>
              <span className={styles.filePath}>
                {change.path}
                {change.kind.move_path ? " → " + change.kind.move_path : ""}
              </span>
              <span className={styles.hint}>
                {({ add: "新增", delete: "删除", update: "修改" } as Record<string, string>)[
                  change.kind.type
                ] ?? change.kind.type}
              </span>
              <span className={styles.addCount}>+{added}</span>
              <span className={styles.removeCount}>−{removed}</span>
            </summary>
            <DiffView diff={change.diff} />
          </details>
        );
      })}
    </div>
  );
}
