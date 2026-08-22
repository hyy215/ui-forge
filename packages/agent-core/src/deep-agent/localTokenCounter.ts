/** 使用随应用安装的编码表为模型上下文管理提供无网络依赖的 Token 估算。 */

import type { MessageContent } from "@langchain/core/messages";
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

let localEncoding: Tiktoken | undefined;

/** 使用本地 o200k 编码统计文本消息；编码异常时采用兼顾中英文的保守估算。 */
export function countMessageTokensLocally(content: MessageContent): number {
  const text = readMessageText(content);
  if (!text) return 0;
  try {
    localEncoding ??= new Tiktoken(o200kBase);
    return localEncoding.encode(text, [], []).length;
  } catch {
    return estimateTokenCount(text);
  }
}

/** 提取 LangChain Token 预算实际消费的文本内容并忽略图片等非文本块。 */
function readMessageText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item.type === "text" && "text" in item && typeof item.text === "string") {
      return [item.text];
    }
    return [];
  }).join("");
}

/** 在本地编码不可用时按 CJK 字符和其余文本分别估算，避免中文被四倍低估。 */
function estimateTokenCount(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;
  for (const character of text) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return cjkCount + Math.ceil(otherCount / 4);
}
