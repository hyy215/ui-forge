/** 展示系统将执行的真实命令、Workspace 范围和精确哈希批准入口。 */

import { Alert, Button, Space, Tag, Typography } from "antd";
import type { DeliveryCommandPlanViewModel } from "@ui-forge/shared-protocol";
import styles from "./CodeGenerationPanel.module.css";

/** 命令审阅面板所需的权威计划和显式用户操作。 */
export interface DeliveryCommandApprovalPanelProps {
  plan: DeliveryCommandPlanViewModel;
  isApproving: boolean;
  canApprove: boolean;
  canContinue: boolean;
  onApprove: () => void;
  onContinue: () => void;
}

/** 渲染 cwd、真实 executable/argv，并阻止目录外计划出现批准按钮。 */
export function DeliveryCommandApprovalPanel({
  plan,
  isApproving,
  canApprove,
  canContinue,
  onApprove,
  onContinue,
}: DeliveryCommandApprovalPanelProps) {
  if (plan.status === "pending") {
    return <Alert
      type="info"
      showIcon
      title="等待准备交付命令"
      description="代码安全落盘后，系统会先展示真实命令，再等待单独批准。"
    />;
  }
  const manualOnly = plan.status === "manual_only";
  const approved = plan.status === "approved";
  return <section className={styles.commandApprovalPanel}>
    <div className={styles.acceptanceHeader}>
      <strong>真实命令审阅</strong>
      <Tag color={manualOnly ? "warning" : approved ? "success" : "processing"}>
        {manualOnly ? "仅限人工" : approved ? "已精确批准" : "等待批准"}
      </Tag>
    </div>
    <Alert
      type={manualOnly ? "warning" : approved ? "success" : "info"}
      showIcon
      title={plan.summary}
      description={manualOnly
        ? plan.reason
        : "批准只绑定下面展示的 cwd、executable、argv、Patch 和命令哈希；任一字段变化都必须重新审阅。"}
    />
    <Typography.Text type="secondary">Workspace：<code>{plan.workspaceRoot}</code></Typography.Text>
    <div className={styles.commandList}>
      {plan.commands.map((command) => <article key={command.commandId}>
        <div>
          <Tag>{command.purpose}</Tag>
          <Tag color={command.workspaceScope === "within-workspace" ? "success" : "warning"}>
            {command.workspaceScope === "within-workspace" ? "Workspace 内" : "仅限人工"}
          </Tag>
          {command.networkAccess === "required" ? <Tag color="warning">需要网络</Tag> : null}
        </div>
        <Typography.Text type="secondary">cwd：<code>{command.cwd}</code></Typography.Text>
        <Typography.Text type="secondary">
          executable：<code>{command.executable}</code>
        </Typography.Text>
        <Typography.Text type="secondary">
          argv：<code>{JSON.stringify(command.arguments)}</code>
        </Typography.Text>
        <Typography.Paragraph copyable={{ text: command.displayCommand }}>
          <code>{command.displayCommand}</code>
        </Typography.Paragraph>
      </article>)}
    </div>
    <code>Command plan · {plan.commandPlanHash.slice(0, 12)}</code>
    <Space>
      {plan.status === "approval_required" ? <Button
        type="primary"
        loading={isApproving}
        disabled={!canApprove}
        onClick={onApprove}
      >批准以上真实命令</Button> : null}
      {approved ? <Button type="primary" disabled={!canContinue} onClick={onContinue}>
        执行已批准命令
      </Button> : null}
    </Space>
  </section>;
}
