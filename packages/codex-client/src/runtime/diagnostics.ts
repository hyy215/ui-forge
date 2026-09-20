/** 保存有限的 stderr 尾部，报告前移除认证信息与截断的不完整首行。 */
const MAX_BYTES = 16 * 1024;
const sensitiveLine =
  /authorization|cookie|token|secret|password|api[_-]?key|\bbearer\s|\bsk-[\w-]{8,}/i;

/** 日志只在内存中暂存，最多 16 KiB，不主动输出或写入文件。 */
export class StderrTail {
  private bytes = Buffer.alloc(0);
  private truncated = false;

  /** 合并相邻字节，避免分块导致认证字段漏检。 */
  append(chunk: Buffer): void {
    const combined = Buffer.concat([this.bytes, chunk]);
    this.truncated ||= combined.length > MAX_BYTES;
    this.bytes = Buffer.from(combined.subarray(-MAX_BYTES));
  }

  /** 按完整行脱敏；任何包含认证字段的行整体省略。 */
  read(): string {
    let text = this.bytes.toString("utf8");
    if (this.truncated) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "[truncated stderr line omitted]" : text.slice(newline + 1);
    }
    return text
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .split(/\r?\n/)
      .map((line) => (sensitiveLine.test(line) ? "[redacted authentication diagnostic]" : line))
      .join("\n")
      .trim()
      .slice(-MAX_BYTES);
  }
}
