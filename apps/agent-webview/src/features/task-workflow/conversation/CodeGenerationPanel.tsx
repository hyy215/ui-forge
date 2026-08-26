/** 展示按已审阅 Plan 生成候选 Patch 的真实进度、阻塞原因和代码 Diff。 */

import { Alert, Button, Empty, Space, Tag, Typography } from "antd";
import type { PlanningResult } from "@ui-forge/shared-protocol";
import type { CodeGenerationState } from "../model/codeGenerationState";
import styles from "./CodeGenerationPanel.module.css";

/** 候选代码生成面板所需状态和显式用户操作。 */
export interface CodeGenerationPanelProps {
  plan: PlanningResult | null;
  state: CodeGenerationState;
  isStopping: boolean;
  onGenerate: () => void;
  onStop: () => void;
}

/** 只有用户明确点击后才启动代码生成，并始终把结果标记为未应用 Patch。 */
export function CodeGenerationPanel({
  plan,
  state,
  isStopping,
  onGenerate,
  onStop,
}: CodeGenerationPanelProps) {
  const canGenerate = plan?.status === "reviewable" && plan.files.length > 0 && !state.streamActive;
  const acceptanceCriteriaCount = plan?.steps.reduce(
    (count, step) => count + step.acceptanceCriteria.length,
    0,
  ) ?? 0;
  const status = state.status === "ready"
    ? { color: "success" as const, label: "已生成" }
    : state.status === "blocked"
      ? { color: "warning" as const, label: "受阻" }
      : state.status === "generating"
        ? { color: "processing" as const, label: "生成中" }
        : state.status === "error"
          ? { color: "error" as const, label: "失败" }
          : { color: "default" as const, label: state.status === "stopped" ? "已停止" : "等待确认" };

  return (
    <section className={styles.panel} aria-live="polite">
      <div className={styles.header}>
        <div>
          <Typography.Text strong>候选代码 Patch</Typography.Text>
          <small>严格绑定当前 Plan 与文件版本</small>
        </div>
        <Tag color={status.color}>{status.label}</Tag>
      </div>
      <div className={styles.body}>
        {state.status === "idle" ? <>
          <Alert
            type="info"
            showIcon
            title="生成操作不会修改项目文件"
            description="点击后只生成可审阅的结构化 Patch；应用、构建和视觉验证仍需后续批准。"
          />
          <Button type="primary" disabled={!canGenerate} onClick={onGenerate}>
            按此方案生成代码
          </Button>
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
          <Button danger loading={isStopping} onClick={onStop}>停止生成</Button>
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
          <Alert type="info" showIcon title="代码生成已停止" description="目标项目没有被修改，可以从当前 Plan 重新生成。" />
          <Button disabled={!canGenerate} onClick={onGenerate}>重新生成</Button>
        </> : null}

        {state.status === "ready" && state.result.status === "ready" ? <>
          <Alert type="success" showIcon title="候选 Patch 已生成但尚未应用" description={state.result.patchSet.summary} />
          <div className={styles.hashes}>
            <code>Plan v{state.result.patchSet.planVersion} · {state.result.patchSet.planHash.slice(0, 12)}</code>
            <code>Patch · {state.result.patchSet.patchSetHash.slice(0, 12)}</code>
          </div>
          {plan ? <section className={styles.acceptanceReview}>
            <div className={styles.acceptanceHeader}>
              <strong>验收条件状态</strong>
              <Tag>{`0 项已验证 · ${acceptanceCriteriaCount} 项待验证`}</Tag>
            </div>
            <Alert
              type="info"
              showIcon
              title="候选代码尚未执行验收"
              description="当前只生成了候选 Patch，尚未运行构建、页面渲染或视觉比对，因此不能判定验收条件已经达到。"
            />
            <ol className={styles.acceptanceList}>
              {plan.steps.map((step) => <li key={step.id}>
                <div>
                  <strong>{step.title}</strong>
                  <Tag color="warning">待验证</Tag>
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
          <Space><Typography.Text type="secondary">目标项目文件仍保持原样。</Typography.Text></Space>
        </> : null}

        {!plan ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="方案生成后才能创建候选代码" /> : null}
      </div>
    </section>
  );
}
