/** 将真实 unified diff 展示为逐行增删内容，大补丁按需展开以限制初始渲染量。 */
import { useState } from "react";
import { Button } from "antd";
import styles from "./Sessions.module.css";

/** 保留 diff 原始换行与内容，仅增加颜色和长内容折叠。 */
export function DiffView({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = diff.split("\n");
  const visible = expanded ? lines : lines.slice(0, 200);
  return (
    <div className={styles.diff}>
      <pre aria-label="代码差异">
        <code>
          {visible.map((line, index) => (
            <span
              key={index}
              className={
                line.startsWith("+") && !line.startsWith("+++")
                  ? styles.diffAdded
                  : line.startsWith("-") && !line.startsWith("---")
                    ? styles.diffRemoved
                    : line.startsWith("@@") || line.startsWith("diff ")
                      ? styles.diffHeading
                      : undefined
              }
            >
              {line || " "}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
      {!expanded && lines.length > 200 && (
        <Button size="small" onClick={() => setExpanded(true)}>
          显示完整差异（{lines.length} 行）
        </Button>
      )}
    </div>
  );
}
