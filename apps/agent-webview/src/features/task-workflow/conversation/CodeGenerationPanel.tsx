/** 展示 Plan 授权后的代码落盘、独立命令授权、人工介入原因和审计 Diff。 */

import { Alert, Button, Empty, Space, Tag, Typography } from "antd";
import type {
  D2CWorkflowStatus,
  PlanApprovalViewModel,
  PlanningResult,
} from "@ui-forge/shared-protocol";
import type { CodeGenerationState } from "../model/codeGenerationState";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { DeliveryValidationPanel } from "./DeliveryValidationPanel";
import { DeliveryCommandApprovalPanel } from "./DeliveryCommandApprovalPanel";
import styles from "./CodeGenerationPanel.module.css";

/** 候选代码生成面板所需状态和显式用户操作。 */
export interface CodeGenerationPanelProps {
  taskId: string;
  dataSource: TaskWorkflowDataSource;
  plan: PlanningResult | null;
  workflowStatus: D2CWorkflowStatus;
  planApproval: PlanApprovalViewModel | null;
  conversationStreamActive: boolean;
  isApprovingPlan: boolean;
  isApprovingCommands: boolean;
  state: CodeGenerationState;
  isStopping: boolean;
  onApprove: () => void;
  onApproveCommands: () => void;
  onGenerate: () => void;
  onStop: () => void;
}

/** 分别以 Plan 授权和精确命令授权驱动写入与自动交付验收。 */
export function CodeGenerationPanel({
  taskId,
  dataSource,
  plan,
  workflowStatus,
  planApproval,
  conversationStreamActive,
  isApprovingPlan,
  isApprovingCommands,
  state,
  isStopping,
  onApprove,
  onApproveCommands,
  onGenerate,
  onStop,
}: CodeGenerationPanelProps) {
  const canApprove = workflowStatus === "analysis_ready" && planApproval?.status === "pending"
    && plan?.status === "reviewable" && plan.files.length > 0
    && !conversationStreamActive && !state.streamActive;
  const canGenerate = (workflowStatus === "plan_approved" || workflowStatus === "patch_ready"
    || workflowStatus === "patch_applied" || workflowStatus === "command_approved"
    || workflowStatus === "validation_blocked")
    && planApproval?.status === "approved"
    && plan?.status === "reviewable" && plan.files.length > 0 && !state.streamActive;
  const acceptanceCriteriaCount = plan?.steps.reduce(
    (count, step) => count + step.acceptanceCriteria.length,
    0,
  ) ?? 0;
  const application = state.result.status === "ready" ? state.result.application : null;
  const deliveryValidation = state.result.status === "ready"
    ? state.result.deliveryValidation
    : null;
  const deliveryCommands = state.result.status === "ready"
    ? state.result.deliveryCommands
    : null;
  const canApproveCommands = workflowStatus === "command_approval_required"
    && deliveryCommands?.status === "approval_required"
    && !state.streamActive;
  const applicationInProgress = state.progress.at(-1)?.phase === "applying-patch";
  const status = deliveryValidation?.status === "passed"
    ? { color: "success" as const, label: "交付就绪" }
    : deliveryValidation?.status === "blocked"
      ? { color: "warning" as const, label: "验收需处理" }
      : application?.status === "applied"
        ? deliveryCommands?.status === "approval_required"
          ? { color: "warning" as const, label: "命令待批准" }
          : deliveryCommands?.status === "approved"
            ? { color: "processing" as const, label: "命令已批准" }
            : deliveryCommands?.status === "manual_only"
              ? { color: "warning" as const, label: "仅限人工" }
              : { color: "processing" as const, label: "验收中" }
    : application?.status === "blocked"
      ? { color: "warning" as const, label: "需人工处理" }
      : state.status === "ready"
        ? { color: "processing" as const, label: "等待应用" }
    : state.status === "blocked"
      ? { color: "warning" as const, label: "受阻" }
      : state.status === "generating"
        ? { color: "processing" as const, label: "生成中" }
        : state.status === "error"
          ? { color: "error" as const, label: "失败" }
          : state.status === "stopped"
            ? { color: "default" as const, label: "已停止" }
            : planApproval?.status === "approved"
              ? { color: "processing" as const, label: "已授权" }
              : { color: "default" as const, label: "等待批准" };

  return (
    <section className={styles.panel} aria-live="polite">
      <div className={styles.header}>
        <div>
          <Typography.Text strong>代码生成、安全落盘与自动验收</Typography.Text>
          <small>Plan 只授权生成与落盘；真实命令展示后另行精确授权</small>
        </div>
        <Tag color={status.color}>{status.label}</Tag>
      </div>
      <div className={styles.body}>
        {state.status === "idle" ? <>
          <Alert
            type="info"
            showIcon
            title={planApproval?.status === "approved"
              ? "继续已授权的生成与安全落盘"
              : "批准后将自动生成并安全写入项目"}
            description={planApproval?.status === "approved"
              ? "系统会复用已生成候选 Patch 或继续安全落盘；任何命令都要等真实 cwd、executable 和 argv 展示后再单独授权。"
              : "这次授权只绑定当前 Plan，用于生成候选 Patch 和安全落盘；不会预先授权尚未生成的构建或安装命令。"}
          />
          {planApproval?.status === "approved" ? <>
            <div className={styles.hashes}>
              <code>已批准 Plan v{planApproval.planVersion} · {planApproval.planHash.slice(0, 12)}</code>
            </div>
            <Button type="primary" disabled={!canGenerate} onClick={onGenerate}>
              继续生成并应用
            </Button>
          </> : <>
            <Button
              type="primary"
              loading={isApprovingPlan}
              disabled={!canApprove}
              onClick={onApprove}
            >批准方案并生成、应用</Button>
            {conversationStreamActive || (plan && !planApproval) ? <Typography.Text type="secondary">
              方案正在提交到权威任务，提交完成后才能批准。
            </Typography.Text> : null}
          </>}
          {plan?.status === "blocked" ? <Typography.Text type="warning">
            当前方案存在上下文缺口，暂不能进入代码生成。
          </Typography.Text> : null}
        </> : null}

        {state.status === "generating" ? <>
          <div className={styles.progressList}>
            {state.progress.map((entry, index) => <div key={`${entry.phase}:${index}`}>
              <span />
              <p>{entry.summary}</p>
              {entry.metrics ? <small>{entry.metrics.durationMs} ms</small> : null}
            </div>)}
          </div>
          <Button
            danger={!applicationInProgress}
            loading={isStopping && !applicationInProgress}
            disabled={applicationInProgress}
            onClick={onStop}
          >{applicationInProgress ? "正在安全落盘（不可中断）" : "停止当前执行"}</Button>
        </> : null}

        {state.status === "blocked" && state.result.status === "blocked" ? <>
          <Alert
            type="warning"
            showIcon
            title={state.result.summary}
            description={state.result.reasons.join("；")}
          />
          <Button disabled={!canGenerate} onClick={onGenerate}>重新读取并生成</Button>
        </> : null}

        {state.status === "error" ? <>
          <Alert type="error" showIcon title="候选代码生成失败" description={state.errorMessage} />
          <Button disabled={!canGenerate} onClick={onGenerate}>重试</Button>
        </> : null}

        {state.status === "stopped" ? <>
          <Alert type="info" showIcon title="自动执行已停止" description="已完成的安全落盘不会撤销；可以从当前权威状态继续。" />
          <Button disabled={!canGenerate} onClick={onGenerate}>继续执行</Button>
        </> : null}

        {state.status === "ready" && state.result.status === "ready" ? <>
          {state.result.deliveryValidation.status === "passed" ? <Alert
            type="success"
            showIcon
            title="代码已安全写入并通过自动交付验收"
            description={`${state.result.patchSet.summary}；构建、页面渲染和视觉差异门禁均已通过。`}
          /> : state.result.deliveryValidation.status === "blocked" ? <>
            <Alert
              type="warning"
              showIcon
              title={state.result.deliveryValidation.summary}
              description={state.result.deliveryValidation.reasons.join("；")}
            />
            <Button disabled={!canGenerate} onClick={onGenerate}>问题处理后继续验收</Button>
          </> : state.result.application.status === "applied" ? <Alert
            type="info"
            showIcon
            title={state.result.deliveryCommands.status === "manual_only"
              ? "代码已安全写入，后续命令只能人工执行"
              : state.result.deliveryCommands.status === "approval_required"
                ? "代码已安全写入，等待批准真实命令"
                : "代码已安全写入，等待执行已批准命令"}
            description={`${state.result.patchSet.summary}；系统不会在精确命令获得单独批准前启动子进程。`}
          /> : state.result.application.status === "blocked" ? <>
            <Alert
              type="warning"
              showIcon
              title={state.result.application.summary}
              description={state.result.application.reasons.join("；")}
            />
            <Button disabled={!canGenerate} onClick={onGenerate}>问题处理后重试安全应用</Button>
          </> : <Alert
            type="info"
            showIcon
            title="候选 Patch 已持久化，等待继续安全应用"
            description={state.result.patchSet.summary}
          />}
          <div className={styles.hashes}>
            <code>Plan v{state.result.patchSet.planVersion} · {state.result.patchSet.planHash.slice(0, 12)}</code>
            <code>Patch · {state.result.patchSet.patchSetHash.slice(0, 12)}</code>
          </div>
          {state.result.application.status === "applied" ? <DeliveryCommandApprovalPanel
            plan={state.result.deliveryCommands}
            isApproving={isApprovingCommands}
            canApprove={canApproveCommands}
            canContinue={canGenerate}
            onApprove={onApproveCommands}
            onContinue={onGenerate}
          /> : null}
          {state.result.application.status === "applied" ? <DeliveryValidationPanel
            taskId={taskId}
            dataSource={dataSource}
            validation={state.result.deliveryValidation}
          /> : null}
          {state.result.application.status === "pending" ? <Button
            type="primary"
            disabled={!canGenerate}
            onClick={onGenerate}
          >继续安全落盘</Button> : null}
          {plan ? <section className={styles.acceptanceReview}>
            <div className={styles.acceptanceHeader}>
              <strong>验收条件状态</strong>
              <Tag color={state.result.deliveryValidation.status === "passed" ? "success" : "warning"}>
                {state.result.deliveryValidation.status === "passed"
                  ? `3 项自动门禁通过 · ${acceptanceCriteriaCount} 条方案条件有验收证据`
                  : `${acceptanceCriteriaCount} 条方案条件待问题处理`}
              </Tag>
            </div>
            <Alert
              type={state.result.deliveryValidation.status === "passed" ? "success" : "info"}
              showIcon
              title={state.result.deliveryValidation.status === "passed" ? "自动交付门禁已完成" : "方案条件尚未全部获得通过证据"}
              description={state.result.deliveryValidation.status === "passed"
                ? "构建、页面渲染和全局视觉差异均有真实执行证据；下面的业务条件仍保留供人工按需抽查。"
                : "系统会保留已完成阶段证据，待问题处理后继续自动验收。"}
            />
            <ol className={styles.acceptanceList}>
              {plan.steps.map((step) => <li key={step.id}>
                <div>
                  <strong>{step.title}</strong>
                  <Tag color={deliveryValidation?.status === "passed" ? "success" : "warning"}>
                    {deliveryValidation?.status === "passed" ? "有自动证据" : "待验证"}
                  </Tag>
                </div>
                <ul>{step.acceptanceCriteria.map((criterion, index) => <li key={`${index}:${criterion}`}>{criterion}</li>)}</ul>
              </li>)}
            </ol>
          </section> : null}
          <div className={styles.patchList}>
            {state.result.patchSet.patches.map((patch) => <section key={patch.patchHash}>
              <div className={styles.patchTitle}>
                <strong>{patch.stepId}</strong>
                <code>{patch.patchHash.slice(0, 12)}</code>
              </div>
              {patch.operations.map((operation) => <details key={`${operation.action}:${operation.path}`}>
                <summary><code>{operation.action} {operation.path}</code></summary>
                <pre>{operation.reviewDiff}</pre>
              </details>)}
            </section>)}
          </div>
          {state.result.patchSet.warnings.length > 0 ? <Alert
            type="warning"
            showIcon
            title="生成降级信息"
            description={state.result.patchSet.warnings.join("；")}
          /> : null}
          <Space><Typography.Text type="secondary">
            {state.result.deliveryValidation.status === "passed"
              ? "目标项目已写入并达到自动交付就绪状态。"
              : "安全门禁未通过时不会继续覆盖目标文件。"}
          </Typography.Text></Space>
        </> : null}

        {!plan ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="方案生成后才能创建候选代码" /> : null}
      </div>
    </section>
  );
}
