/** 创建在外层、内部 Completions 与配置克隆路径上都禁止远程编码表的 OpenAI 兼容模型。 */

import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import {
  ChatOpenAI,
  ChatOpenAICompletions,
  type ChatOpenAIFields,
} from "@langchain/openai";
import { countMessageTokensLocally } from "./localTokenCounter.js";

/** 创建完整保留本地 Token 统计能力的 OpenAI 兼容聊天模型。 */
export function createLocallyTokenizedChatOpenAI(fields: ChatOpenAIFields): ChatOpenAI {
  const completions = new LocallyTokenizedChatOpenAICompletions(fields);
  return new LocallyTokenizedChatOpenAI({ ...fields, completions });
}

/** 覆盖外层统计，并确保 bindTools/withConfig 不会退化为普通 ChatOpenAI。 */
class LocallyTokenizedChatOpenAI extends ChatOpenAI {
  /** 使用本地编码表统计单段消息内容。 */
  override async getNumTokens(content: MessageContent): Promise<number> {
    return countMessageTokensLocally(content);
  }

  /** 使用本地编码表统计整组消息。 */
  override async getNumTokensFromMessages(messages: BaseMessage[]): Promise<{
    totalCount: number;
    countPerMessage: number[];
  }> {
    return countMessagesLocally(messages);
  }

  /** 克隆调用配置时保留本地模型类型以及自定义内部 Completions 实例。 */
  override withConfig(
    config: Parameters<ChatOpenAI["withConfig"]>[0],
  ): ReturnType<ChatOpenAI["withConfig"]> {
    const newModel = new LocallyTokenizedChatOpenAI(this.fields);
    newModel.defaultOptions = {
      ...this.defaultOptions,
      ...config,
    };
    return newModel;
  }
}

/** 覆盖流式响应结束后由 SDK 内部执行的输入与输出 Token 估算。 */
class LocallyTokenizedChatOpenAICompletions extends ChatOpenAICompletions {
  /** 使用本地编码表统计单段消息内容。 */
  override async getNumTokens(content: MessageContent): Promise<number> {
    return countMessageTokensLocally(content);
  }

  /** 使用本地编码表统计整组消息。 */
  override async getNumTokensFromMessages(messages: BaseMessage[]): Promise<{
    totalCount: number;
    countPerMessage: number[];
  }> {
    return countMessagesLocally(messages);
  }
}

/** 按 OpenAI 消息记账规则聚合本地文本 Token 数。 */
function countMessagesLocally(messages: BaseMessage[]): {
  totalCount: number;
  countPerMessage: number[];
} {
  const countPerMessage = messages.map((message) => countMessageTokensLocally(message.content)
    + countMessageTokensLocally(message.getType())
    + (message.name ? countMessageTokensLocally(message.name) + 1 : 0)
    + 3);
  return {
    totalCount: countPerMessage.reduce((total, count) => total + count, 3),
    countPerMessage,
  };
}
