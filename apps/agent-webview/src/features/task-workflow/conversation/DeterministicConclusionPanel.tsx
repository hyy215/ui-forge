/** 在右侧单独展示 Server 已筛选的项目事实，组件判断由相邻面板负责。 */

import { Empty, Tag, Typography } from "antd";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { createDeterministicConclusion } from "./deterministicConclusion";

/** 确定性结论面板所需的对话状态。 */
export interface DeterministicConclusionPanelProps {
  conversation: ConversationStreamState;
}

/** 只展示项目支持结论，避免与紧凑组件判断面板重复。 */
export function DeterministicConclusionPanel({ conversation }: DeterministicConclusionPanelProps) {
  const conclusion = createDeterministicConclusion(
    conversation.projectValidation,
    conversation.designComponentRecognition,
  );
  const hasConclusion = conclusion.projectConclusion !== null;
  return <section className="deterministic-conclusion-panel" aria-live="polite">
    <div className="deterministic-conclusion-head">
      <div>
        <Typography.Text strong>项目判断</Typography.Text>
        <small>目标项目的确定性支持结论</small>
      </div>
      <Tag color={conclusion.blocked ? "warning" : hasConclusion ? "success" : "default"}>
        {conclusion.blocked ? "受阻" : hasConclusion ? "已确认" : "等待中"}
      </Tag>
    </div>
    <div className="deterministic-conclusion-body">
      {conclusion.projectConclusion ? <section>
        <strong>项目结论</strong>
        <p>{conclusion.projectConclusion}</p>
      </section> : null}
      {!hasConclusion ? <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="等待项目检查结果"
      /> : null}
    </div>
  </section>;
}
