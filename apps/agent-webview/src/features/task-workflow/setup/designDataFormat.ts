/** 提供设计数据浏览器共用的轻量展示格式化函数。 */

/** 将字节数格式化为适合界面阅读的容量文本。 */
export function formatDesignDataBytes(byteSize: number): string {
  if (byteSize < 1_024) return `${byteSize} B`;
  if (byteSize < 1_024 * 1_024) return `${(byteSize / 1_024).toFixed(1)} KB`;
  return `${(byteSize / (1_024 * 1_024)).toFixed(1)} MB`;
}
