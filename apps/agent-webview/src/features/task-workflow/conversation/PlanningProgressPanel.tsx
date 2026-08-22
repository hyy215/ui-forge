/** 在第二步右侧逐项展示真实方案草稿，不把尚未接线的审批能力伪装为可用操作。 */

import { Alert, Empty, Tag, Typography } from "antd";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { PlanDetails } from "./PlanDetails";
import { PlanLoading } from "./PlanLoading";

/** 右侧方案进度面板所需状态与审批操作。 */
export interface PlanningProgressPanelProps { conversation: ConversationStreamState }

/** 在规划期间展示等待状态，并以完整 plan-result 作为唯一权威内容。 */
export function PlanningProgressPanel({
  conversation,
}: PlanningProgressPanelProps) {
  const isPlanning = conversation.status === "planning";
  const isReady = conversation.status === "ready" && conversation.plan !== null;
  const isBlocked = isReady && conversation.plan?.status === "blocked";
  return (
    <section className="planning-progress-panel" aria-live="polite">
      <div className="planning-progress-head">
        <div>
          <Typography.Text strong>整体修改方案</Typography.Text>
          <small>{isBlocked ? "上下文不足，需要补充信息" : isReady ? "已生成，仅供审阅" : isPlanning ? "主 Agent 正在生成" : "等待真实规划结果"}</small>
        </div>
        <Tag color={isBlocked ? "warning" : isReady ? "success" : isPlanning ? "processing" : "default"}>
          {isBlocked ? "受阻" : isReady ? "已完成" : isPlanning ? "生成中" : "等待中"}
        </Tag>
      </div>
      <div className="planning-progress-body">
        {isReady && conversation.plan ? <>
          <Alert type="info" showIcon title="当前方案仅供审阅" description="Patch、受控写入、执行验证和交付尚未接入。" />
          <PlanDetails plan={conversation.plan} />
        </> : null}
        {isPlanning ? <PlanLoading /> : null}
        {!isPlanning && !isReady ? <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={conversation.status === "unsupported"
            ? "当前项目不支持进入修改方案规划"
            : "仓库组件匹配与规划完成后显示最终修改方案"}
        /> : null}
      </div>
    </section>
  );
}
