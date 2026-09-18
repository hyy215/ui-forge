/** 展示工具返回的文本、参数与结构化内容，避免将协议外壳混入对话正文。 */
import { z } from "zod";
import styles from "./Sessions.module.css";

/** 参数显示为字段列表；工具文本保留换行，深层结构才使用局部 JSON。 */
export function NativeValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return <pre>{value}</pre>;
  const blocks = z
    .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    .safeParse(value);
  if (blocks.success)
    return (
      <>
        {blocks.data.map((block, index) =>
          block.text ? (
            <pre key={index}>{block.text}</pre>
          ) : (
            <p key={index} className={styles.hint}>
              {(
                {
                  image: "工具返回图片",
                  inputImage: "工具返回图片",
                  resource: "工具返回资源",
                  resource_link: "工具返回资源链接",
                } as Record<string, string>
              )[block.type] ?? "工具返回附件"}
            </p>
          ),
        )}
      </>
    );
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (record.success)
    return (
      <dl className={styles.valueFields}>
        {Object.entries(record.data).map(([key, entry]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{typeof entry === "string" ? entry : JSON.stringify(entry, null, 2)}</dd>
          </div>
        ))}
      </dl>
    );
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
