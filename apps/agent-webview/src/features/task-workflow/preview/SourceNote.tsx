/** 以统一样式标记确定性设计读取证据的数据来源。 */

/** 数据来源说明组件接收的文本内容。 */
export type SourceNoteProps = {
  children: string;
};

/** 展示工具证据的来源标签。 */
export function SourceNote({ children }: SourceNoteProps) {
  return <span className="source-note">来源：{children}</span>;
}
