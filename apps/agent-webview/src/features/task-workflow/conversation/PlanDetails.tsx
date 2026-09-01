/** 展示服务端返回的真实组件、步骤、文件和停止条件。 */

import type { PlanningResult } from "@ui-forge/shared-protocol";

/** 方案详情组件接收的当前实施计划。 */
export interface PlanDetailsProps {
  plan: PlanningResult;
}

/** 展示当前方案的组件复用、实施步骤、修改范围和停止条件。 */
export function PlanDetails({ plan }: PlanDetailsProps) {
  return (
    <div className="plan-details">
      <p>{plan.summary}</p>
      <section className="plan-section">
        <div className="plan-section-title"><span>1</span><strong>布局与交互理解</strong></div>
        <p>{plan.designUnderstanding.layout.summary}</p>
        <div className="plan-component-list">
          {plan.designUnderstanding.layout.regions.map((region) => <div key={region.id}>
            <code>{region.name}</code><p>{region.role} · {region.relationship}</p>
          </div>)}
        </div>
        {plan.designUnderstanding.layout.warnings.length > 0 ? <p>
          布局降级信息：{plan.designUnderstanding.layout.warnings.join("；")}
        </p> : null}
        {plan.designUnderstanding.interactions.length > 0 ? <ul>
          {plan.designUnderstanding.interactions.map((interaction) => <li key={interaction.id}>
            <strong>{interaction.trigger}</strong>：{interaction.expectedEffect}（{interaction.status === "inferred" ? "静态稿推断" : "未解决"}，{Math.round(interaction.confidence * 100)}%）
          </li>)}
        </ul> : <p>未从静态设计中识别出可审阅的交互线索。</p>}
        {(plan.designUnderstanding.elements?.length ?? 0) > 0 ? <div className="plan-component-list">
          {plan.designUnderstanding.elements?.map((element) => <div key={element.id}>
            <code>{element.name}</code>
            <p>{element.kind} · {element.implementation === "required" ? "必须实现" : "仅供参考"}
              {element.states.length > 0 ? ` · 状态 ${element.states.join("/")}` : ""}</p>
            {element.text ? <small>文本：{element.text}{element.textStatus === "uncertain" ? "（待确认）" : ""}</small> : null}
          </div>)}
        </div> : null}
      </section>
      <section className="plan-section">
        <div className="plan-section-title"><span>2</span><strong>组件复用决策</strong></div>
        <div className="plan-component-list">
          {plan.componentDecisions.map((decision) => <div key={decision.candidateId}>
            <code>{decision.candidateId}</code>
            <p>{formatReuseSource(decision.source)} · {formatReuseAction(decision.action)}：{decision.reason}</p>
            {decision.catalogComponentId ? <small>设计系统组件：{decision.catalogComponentId}</small> : null}
            {decision.repositoryComponentId ? <small>仓库候选：{decision.repositoryComponentId}</small> : null}
          </div>)}
        </div>
      </section>
      <section className="plan-section">
        <div className="plan-section-title"><span>3</span><strong>设计系统组件</strong></div>
        <div className="plan-component-list">
          {plan.reusableComponents.map((component) => <div key={component.typeId}><code>{component.name}</code><p>{component.description}</p></div>)}
        </div>
        <strong>新建组件</strong>
        <div className="plan-component-list">
          {plan.newComponents.map((component) => <div key={component.typeId}><code>{component.name}</code><p>{component.description}</p></div>)}
        </div>
      </section>
      <section className="plan-section">
        <div className="plan-section-title"><span>4</span><strong>修改步骤与验收条件</strong></div>
        <p>自动渲染入口：<code>{plan.validationTarget.previewPath}</code></p>
        <ol className="plan-step-list">
          {plan.steps.map((step) => <li key={step.id}>
            <div className="plan-step-content">
              <strong>{step.title}</strong>
              <small>{formatStepKind(step.kind)} · {step.targetId} · {step.decision}</small>
              <span className="plan-step-description">{step.description}</span>
              {step.files.length > 0 ? <div className="plan-file-list">
                {step.files.map((file) => <code key={`${file.action}:${file.path}`}>{file.action} {file.path}</code>)}
              </div> : null}
              {(step.designElementIds?.length ?? 0) > 0
                ? <small>覆盖视觉元素：{step.designElementIds?.join("、")}</small>
                : null}
              <div className="plan-step-acceptance"><small>验收条件</small><span>{step.acceptanceCriteria.join("；")}</span></div>
            </div>
          </li>)}
        </ol>
      </section>
      <section className="plan-section">
        <div className="plan-section-title"><span>5</span><strong>预计修改范围与影响</strong></div>
        <div className="plan-component-list">{plan.fileImpacts.map((impact) => <div key={`${impact.action}:${impact.path}`}>
          <code>{impact.action} {impact.path}</code>
          <p>{impact.reason} · 风险 {impact.risk}</p>
          {impact.downstreamConsumers.length > 0 ? <small>影响消费者：{impact.downstreamConsumers.join("、")}</small> : null}
        </div>)}</div>
      </section>
      <section className="plan-section">
        <div className="plan-section-title"><span>6</span><strong>异常处理与停止条件</strong></div>
        <p>{plan.stopConditions.join("；")}</p>
      </section>
      {plan.contextGaps.length > 0 ? <section className="plan-section">
        <div className="plan-section-title"><span>7</span><strong>上下文缺口</strong></div>
        <ul>{plan.contextGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
      </section> : null}
    </div>
  );
}

/** 将组件复用枚举转换为紧凑中文结论。 */
function formatReuseAction(action: PlanningResult["componentDecisions"][number]["action"]): string {
  switch (action) {
    case "reuse-directly": return "直接复用";
    case "reuse-configured": return "配置后复用";
    case "reuse-with-wrapper": return "包装后复用";
    case "extend-existing": return "扩展现有组件";
    case "create-new": return "新建组件";
    case "unresolved": return "证据不足";
  }
}

/** 将实现来源转换为审阅者可区分的中文标签。 */
function formatReuseSource(source: PlanningResult["componentDecisions"][number]["source"]): string {
  switch (source) {
    case "catalog": return "组件目录";
    case "repository": return "目标仓库";
    case "new": return "项目内新建";
    case "unresolved": return "来源未解决";
  }
}

/** 将计划步骤类型转换为用户可读阶段。 */
function formatStepKind(kind: PlanningResult["steps"][number]["kind"]): string {
  switch (kind) {
    case "initialize": return "项目初始化";
    case "layout": return "外部布局";
    case "component": return "组件";
    case "interaction": return "交互";
    case "cross-cutting": return "跨文件影响";
    case "validation": return "验证";
  }
}
