/** 在右侧以紧凑摘要和按需详情展示组件候选及最终判断。 */

import { Alert, Collapse, Empty, Tag, Typography } from "antd";
import type { DesignComponentRecognition } from "@ui-forge/shared-protocol";
import type { ConversationStreamState } from "../model/conversationStreamState";
import { ComponentEvidence } from "./ComponentEvidence";
import { formatDesignComponentType } from "./deterministicConclusion";

/** 设计组件分析结果面板接收的公开数据。 */
export interface DesignComponentRecognitionPanelProps {
  recognition: DesignComponentRecognition;
  status: ConversationStreamState["status"];
}

/** 默认只展示一行结论，将 Tool、目录、视觉和决策依据收进候选详情。 */
export function DesignComponentRecognitionPanel({ recognition, status }: DesignComponentRecognitionPanelProps) {
  if (recognition.status === "unavailable") {
    return <Alert type="warning" showIcon title="设计组件暂不可识别" description={recognition.warnings.join("；")} />;
  }
  if (recognition.components.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现明确的设计组件候选" />;
  }
  const confirmedCount = recognition.components.filter((component) => component.effectiveTypeId).length;
  const unresolvedCount = recognition.components.filter((component) => component.resolvedBy === "unresolved").length;
  const pendingCount = recognition.components.length - confirmedCount - unresolvedCount;
  const instanceCount = recognition.components.reduce((total, component) => total + component.instanceCount, 0);
  const panelState = createPanelState(status, confirmedCount, unresolvedCount, recognition.components.length);
  return <section className="component-recognition-panel" aria-live="polite">
    <div className="component-recognition-head">
      <div>
        <Typography.Text strong>组件判断</Typography.Text>
        <small>{confirmedCount}/{recognition.components.length} 已确认 · {instanceCount} 个实例</small>
      </div>
      <Tag color={panelState.color}>{panelState.label}</Tag>
    </div>
    <div className="component-recognition-stats">
      <span><strong>{confirmedCount}</strong> 已确认</span>
      <span><strong>{pendingCount}</strong> 待确认</span>
      <span><strong>{unresolvedCount}</strong> 未解决</span>
    </div>
    {status === "planning" ? <p className="component-recognition-note">
      视觉建议仅供主 Plan Agent 参考，不等于最终确认。
    </p> : null}
    <div className="component-recognition-list">
      {recognition.components.map((component) => <article key={component.id}>
        <div className="component-recognition-title">
          <div>
            <Typography.Text strong title={component.name}>{component.name}</Typography.Text>
            <small>{component.instanceCount} 个实例 · {formatResolutionSource(component.resolvedBy)}</small>
          </div>
          <Tag color={component.effectiveTypeId ? "blue" : component.resolvedBy === "unresolved" ? "warning" : "default"}>
            {component.effectiveTypeId
              ? formatDesignComponentType(component.effectiveTypeId)
              : component.resolvedBy === "unresolved" ? "未解决" : status === "planning" ? "确认中" : "待确认"}
          </Tag>
        </div>
        {component.visualSuggestion ? <div className="component-visual-summary">
          <small>视觉建议</small>
          <span>{component.visualSuggestion.suggestedTypeId
            ? formatDesignComponentType(component.visualSuggestion.suggestedTypeId)
            : "无法判断"}</span>
          <em>{Math.round(component.visualSuggestion.confidence * 100)}%</em>
        </div> : null}
        <Collapse
          className="component-recognition-details"
          ghost
          size="small"
          items={[{
            key: `${component.id}-evidence`,
            label: "查看判断依据",
            children: <ComponentEvidence component={component} />,
          }]}
        />
      </article>)}
    </div>
    {recognition.warnings.map((warning) => <Alert key={warning} type="warning" showIcon title={warning} />)}
  </section>;
}

/** 将整体确认进度转换为侧栏状态标签。 */
function createPanelState(
  status: ConversationStreamState["status"],
  confirmedCount: number,
  unresolvedCount: number,
  totalCount: number,
): { label: string; color: "default" | "processing" | "success" | "warning" } {
  if (totalCount > 0 && confirmedCount === totalCount) return { label: "已确认", color: "success" };
  if (status === "planning") return { label: "确认中", color: "processing" };
  if (unresolvedCount > 0) return { label: "需关注", color: "warning" };
  return { label: "待确认", color: "default" };
}

/** 将最终决策来源转换为用户可读文字。 */
function formatResolutionSource(source: "catalog" | "model" | "unresolved" | undefined): string {
  switch (source) {
    case "catalog": return "目录约束";
    case "model": return "模型判断";
    case "unresolved": return "未解决";
    default: return "等待主 Agent";
  }
}
