/** 在单一对话视图中串联 Design URL 读取、SVG 确认与方案分析。 */

import { useEffect, useState } from "react";
import { Alert, Avatar, Button, Empty, Input, Space, Tag, Typography } from "antd";
import type { SvgTool, TaskWorkflowViewModel } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import {
  createConversationFailureTitle,
  type ConversationStreamState,
} from "../model/conversationStreamState";
import { AgentProcess } from "./AgentProcess";
import { AgentMessage } from "./AgentMessage";
import { ConversationRunTimer } from "./ConversationRunTimer";
import { DesignContextPanel } from "./DesignContextPanel";
import { DesignComponentRecognitionPanel } from "./DesignComponentRecognitionPanel";
import { DeterministicConclusionPanel } from "./DeterministicConclusionPanel";
import { DisabledComposer } from "./DisabledComposer";
import { PlanningProgressPanel } from "./PlanningProgressPanel";
import { ResultsIcon } from "./ResultsIcon";
import { UserMessage } from "./UserMessage";
import {
  classifyDesignConversationSubmission,
  designConfirmationCommand,
} from "./designConversationInput";

/** 单视图对话和设计上下文界面所需数据与操作。 */
export interface ConversationStageProps {
  setup: TaskWorkflowViewModel["setup"];
  taskId: string;
  dataSource: TaskWorkflowDataSource;
  tools: SvgTool[];
  conversation: ConversationStreamState;
  commandError: string | undefined;
  designConfirmed: boolean;
  isInspectingDesign: boolean;
  onInspectDesign: (designUrl: string) => void;
  onConfirmDesign: () => void;
  onReset: () => void;
  onRetryStream: () => void;
  onStopConversation: () => void;
  isStoppingConversation: boolean;
}

/** 展示设计读取消息、右侧预览确认和确认后的真实分析流。 */
export function ConversationStage({
  setup,
  taskId,
  dataSource,
  tools,
  conversation,
  commandError,
  designConfirmed,
  isInspectingDesign,
  onInspectDesign,
  onConfirmDesign,
  onReset,
  onRetryStream,
  onStopConversation,
  isStoppingConversation,
}: ConversationStageProps) {
  const [composerValue, setComposerValue] = useState("");
  const [submittedDesignUrl, setSubmittedDesignUrl] = useState(setup.designUrl);
  const [composerError, setComposerError] = useState<string>();
  const [resultsOpen, setResultsOpen] = useState(false);
  const designReady = setup.designSummary !== null;
  const statusTag = createStatusTag(
    conversation.status,
    designReady,
    designConfirmed,
    isInspectingDesign,
  );
  const canSubmit = composerValue.trim().length > 0 && !isInspectingDesign && !designConfirmed;

  useEffect(() => {
    setSubmittedDesignUrl(setup.designUrl);
    if (!setup.designSummary) {
      setComposerValue("");
      setComposerError(undefined);
    }
  }, [setup.designSummary, setup.designUrl]);

  useEffect(() => {
    if (commandError && !setup.designSummary && submittedDesignUrl) {
      setComposerValue(submittedDesignUrl);
    }
  }, [commandError, setup.designSummary, submittedDesignUrl]);

  useEffect(() => {
    if (!resultsOpen) return;
    /** 允许用户通过 Escape 关闭窄屏结果浮层。 */
    function closeResultsOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setResultsOpen(false);
    }
    window.addEventListener("keydown", closeResultsOnEscape);
    return () => window.removeEventListener("keydown", closeResultsOnEscape);
  }, [resultsOpen]);

  /** 按当前阶段确定性处理设计引用或确认口令。 */
  function submitComposer() {
    if (!canSubmit) return;
    const submission = classifyDesignConversationSubmission(designReady, composerValue);
    switch (submission.kind) {
      case "inspect-design":
        setSubmittedDesignUrl(submission.reference);
        setComposerValue("");
        setComposerError(undefined);
        onInspectDesign(submission.reference);
        return;
      case "confirm-design":
        setComposerValue("");
        setComposerError(undefined);
        onConfirmDesign();
        return;
      case "invalid-confirmation":
        setComposerError(`请输入完整口令“${designConfirmationCommand}”以开始分析。`);
        return;
      case "empty":
        return;
    }
  }

  return (
    <section className="stage-content stage-content--wide stage-content--conversation" aria-labelledby="stage-title">
      <div className="stage-heading compact-heading">
        <div>
          <Typography.Title id="stage-title" level={2} className="stage-title">
            生成前端视图
          </Typography.Title>
          <Typography.Paragraph type="secondary">输入设计稿链接，确认 SVG 预览后开始项目检查、组件判断与方案生成。</Typography.Paragraph>
        </div>
        <Space className="stage-heading-actions" size={8} wrap>
          {(setup.designSummary || designConfirmed) && <Button className="stage-back-button" onClick={onReset}>重新选择设计</Button>}
          <Button
            className={`results-toggle ${resultsOpen ? "results-toggle--open" : ""}`}
            type={resultsOpen ? "default" : "primary"}
            aria-label={resultsOpen ? "收起设计与分析结果" : "查看设计与分析结果"}
            aria-expanded={resultsOpen}
            aria-controls="conversation-results"
            icon={<ResultsIcon />}
            onClick={() => setResultsOpen((open) => !open)}
          >{resultsOpen ? "收起结果" : "查看结果"}</Button>
          <Tag color={statusTag.color}>{statusTag.label}</Tag>
        </Space>
      </div>
      <div className="stage-scroll">
        {commandError && <Alert className="stage-alert" type="error" showIcon title="任务操作失败" description={commandError} />}
        <div className="agent-layout">
          {resultsOpen && <button
            className="results-backdrop"
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setResultsOpen(false)}
          />}
          <div className="conversation-panel">
            <div className="conversation-feed" aria-live="polite">
              <AgentMessage><p>当前工具用于结合设计稿生成前端视图，请输入 Design URL。</p></AgentMessage>
              {submittedDesignUrl && <UserMessage>{submittedDesignUrl}</UserMessage>}
              {isInspectingDesign && <AgentMessage>
                <p className="streaming-placeholder"><span />正在读取设计稿并生成 SVG 预览…</p>
              </AgentMessage>}
              {!isInspectingDesign && setup.designSummary && <AgentMessage>
                <p>设计稿读取完成，请检查右侧 SVG 预览。预览无误请回复“{designConfirmationCommand}”。</p>
              </AgentMessage>}
              {designConfirmed && <>
                <UserMessage>{designConfirmationCommand}</UserMessage>
                <div className="message message--agent">
                  <Avatar size={28} className="agent-avatar">U</Avatar>
                  <div className="agent-message-content">
                    <div className="agent-message-header">
                      <strong>ui-forge</strong>
                      <ConversationRunTimer conversation={conversation} />
                    </div>
                    {conversation.status === "validating_project" && conversation.processEntries.length === 0
                      ? <p className="streaming-placeholder"><span />正在校验当前项目…</p>
                      : null}
                    <AgentProcess conversation={conversation} />
                    {conversation.status === "stopped" && <Alert
                      type="info"
                      showIcon
                      title="分析已终止"
                      description="已停止本次思考，已经返回的识别结果和修改摘要仍会保留。"
                      action={<Button size="small" onClick={onRetryStream}>重新分析</Button>}
                    />}
                    {conversation.status === "error" && <Alert
                      type="error"
                      showIcon
                      title={createConversationFailureTitle(conversation.failureStage)}
                      description={conversation.errorMessage}
                      action={<Button size="small" onClick={onRetryStream}>重试</Button>}
                    />}
                  </div>
                </div>
              </>}
            </div>

            {!designConfirmed ? <div className="composer">
              <Input.TextArea
                value={composerValue}
                disabled={isInspectingDesign}
                {...(composerError ? { status: "error" as const } : {})}
                placeholder={designReady ? `输入“${designConfirmationCommand}”开始分析` : "粘贴 MasterGo 页面或节点链接"}
                variant="borderless"
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={(event) => {
                  setComposerValue(event.target.value);
                  if (composerError) setComposerError(undefined);
                }}
                onPressEnter={(event) => {
                  if (!event.shiftKey) {
                    event.preventDefault();
                    submitComposer();
                  }
                }}
              />
              <div className="composer-footer">
                <Typography.Text type={composerError ? "danger" : "secondary"}>
                  {composerError ?? (designReady ? `仅精确口令“${designConfirmationCommand}”会启动分析` : "Enter 发送，Shift + Enter 换行")}
                </Typography.Text>
                <Button
                  type="primary"
                  shape="circle"
                  aria-label={designReady ? "发送确认口令" : "读取设计"}
                  loading={isInspectingDesign}
                  disabled={!canSubmit}
                  onClick={submitComposer}
                >↑</Button>
              </div>
            </div> : <DisabledComposer
              conversation={conversation}
              isStoppingConversation={isStoppingConversation}
              onStopConversation={onStopConversation}
            />}
          </div>

          <aside
            id="conversation-results"
            className={`conversation-aside ${resultsOpen ? "conversation-aside--open" : ""}`}
            aria-label="设计与分析结果"
          >
            <div className="conversation-results-head">
              <div>
                <strong>设计与分析结果</strong>
                <small>设计预览与分析进度</small>
              </div>
              <Button
                className="results-close"
                shape="circle"
                aria-label="关闭结果浮层"
                title="关闭结果浮层"
                onClick={() => setResultsOpen(false)}
              >×</Button>
            </div>
            {setup.designSummary && !isInspectingDesign ? <DesignContextPanel
              design={setup.designSummary}
              tools={tools}
              taskId={taskId}
              dataSource={dataSource}
              confirmed={designConfirmed}
            /> : <section className="design-context-panel design-context-panel--empty">
              <div className="design-context-head">
                <div><Typography.Text strong>MasterGo 设计</Typography.Text><small>{isInspectingDesign ? "正在生成 SVG 预览" : "SVG 预览将显示在这里"}</small></div>
              </div>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={isInspectingDesign ? "设计读取完成后将在这里显示预览" : "请先在左侧输入 Design URL"}
              />
            </section>}
            {designConfirmed && <>
              <DeterministicConclusionPanel conversation={conversation} />
              {conversation.designComponentRecognition ? <DesignComponentRecognitionPanel
                recognition={conversation.designComponentRecognition}
                status={conversation.status}
              /> : null}
              <PlanningProgressPanel conversation={conversation} />
            </>}
          </aside>
        </div>
      </div>
    </section>
  );
}

/** 将设计读取与分析状态映射为页面标签。 */
function createStatusTag(
  status: ConversationStreamState["status"],
  designLoaded: boolean,
  designConfirmed: boolean,
  isInspectingDesign: boolean,
): {
  label: string;
  color: "default" | "processing" | "success" | "warning" | "error";
} {
  if (isInspectingDesign) return { label: "正在读取设计", color: "processing" };
  if (!designLoaded) return { label: "等待 Design URL", color: "default" };
  if (!designConfirmed) return { label: "等待确认设计", color: "processing" };
  switch (status) {
    case "idle": return { label: "等待项目校验", color: "default" };
    case "validating_project": return { label: "正在校验项目", color: "processing" };
    case "analyzing_design": return { label: "正在识别组件", color: "processing" };
    case "validated": return { label: "项目校验完成", color: "success" };
    case "planning": return { label: "正在生成方案", color: "processing" };
    case "ready": return { label: "方案已生成", color: "success" };
    case "unsupported": return { label: "项目不支持", color: "warning" };
    case "error": return { label: "校验失败", color: "error" };
    case "stopped": return { label: "已终止", color: "default" };
  }
}
