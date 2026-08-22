/** 展示设计确认后只允许终止分析的只读对话编辑器。 */

import { Button, Input, Typography } from "antd";
import type { ConversationStreamState } from "../model/conversationStreamState";

/** 只读编辑器的流状态与终止操作。 */
interface DisabledComposerProps {
  conversation: ConversationStreamState;
  isStoppingConversation: boolean;
  onStopConversation: () => void;
}

/** 渲染确认设计后尚未开放自由输入的对话编辑器。 */
export function DisabledComposer({
  conversation,
  isStoppingConversation,
  onStopConversation,
}: DisabledComposerProps) {
  return <div className="composer composer--disabled">
    <Input.TextArea
      disabled
      placeholder="后续对话调整能力接入后，可在这里继续补充要求。"
      variant="borderless"
      autoSize={{ minRows: 3, maxRows: 5 }}
    />
    <div className="composer-footer">
      <Typography.Text type="secondary">当前开放项目校验、组件识别与方案审阅</Typography.Text>
      {conversation.streamActive ? <Button
        danger
        shape="circle"
        aria-label="终止分析"
        title="终止分析"
        loading={isStoppingConversation}
        onClick={onStopConversation}
      >■</Button> : <Button type="primary" shape="circle" aria-label="发送消息" disabled>↑</Button>}
    </div>
  </div>;
}
