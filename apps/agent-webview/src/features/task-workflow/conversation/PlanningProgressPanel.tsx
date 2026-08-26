/** 展示真实方案草稿，并在代码生成阶段让候选 Patch 成为主要审阅内容。 */

import { useEffect, useState } from "react";
import { Alert, Button, Empty, Tag, Typography } from "antd";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { PlanDetails } from "./PlanDetails";
import { PlanLoading } from "./PlanLoading";
import styles from "./PlanningProgressPanel.module.css";

/** 右侧方案进度面板所需状态与审批操作。 */
export interface PlanningProgressPanelProps {
  conversation: ConversationStreamState;
  collapseForCodeGeneration: boolean;
}

/** 展示权威 Plan；代码生成开始后自动折叠，并允许审阅者随时重新展开。 */
export function PlanningProgressPanel({
  conversation,
  collapseForCodeGeneration,
}: PlanningProgressPanelProps) {
  const isPlanning = conversation.status === "planning";
  const isReady = conversation.status === "ready" && conversation.plan !== null;
  const isBlocked = isReady && conversation.plan?.status === "blocked";
  const [isCollapsed, setIsCollapsed] = useState(collapseForCodeGeneration);

  useEffect(() => {
    if (collapseForCodeGeneration) setIsCollapsed(true);
    else if (!isReady) setIsCollapsed(false);
  }, [collapseForCodeGeneration, isReady]);

  return (
    <section className="planning-progress-panel" aria-live="polite">
      <div className="planning-progress-head">
        <div>
          <Typography.Text strong>整体修改方案</Typography.Text>
          <small>{isBlocked ? "上下文不足，需要补充信息" : isReady ? "已生成，仅供审阅" : isPlanning ? "主 Agent 正在生成" : "等待真实规划结果"}</small>
        </div>
        <span className={styles.actions}>
          <Tag color={isBlocked ? "warning" : isReady ? "success" : isPlanning ? "processing" : "default"}>
            {isBlocked ? "受阻" : isReady ? "已完成" : isPlanning ? "生成中" : "等待中"}
          </Tag>
          {isReady ? <Button
            type="text"
            size="small"
            aria-controls="planning-progress-content"
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "展开" : "折叠"}整体修改方案`}
            onClick={() => setIsCollapsed((value) => !value)}
          >{isCollapsed ? "展开" : "折叠"}</Button> : null}
        </span>
      </div>
      {!isCollapsed ? <div id="planning-progress-content" className="planning-progress-body">
        {isReady && conversation.plan ? <>
          <Alert type="info" showIcon title="当前方案可用于生成候选代码" description="代码生成需要再次明确确认；Patch 应用、执行验证和交付尚未接入。" />
          <PlanDetails plan={conversation.plan} />
        </> : null}
        {isPlanning ? <PlanLoading /> : null}
        {!isPlanning && !isReady ? <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={conversation.status === "unsupported"
            ? "当前项目不支持进入修改方案规划"
            : "仓库组件匹配与规划完成后显示最终修改方案"}
        /> : null}
      </div> : null}
    </section>
  );
}
