/** 清理人类可读终端文本，避免远端输出中的控制序列改写终端状态。 */
import { stripVTControlCharacters } from "node:util";

/** 保留普通文字和换行，移除 ANSI/OSC、回车、退格及其他 C0/C1 控制字符。 */
export function terminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}
