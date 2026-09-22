/** 展示经校验的主会话诊断报告，不以局部统计替代验收结果。 */
import { Alert, Tag } from "antd";
import type { TaskDiagnostics } from "@ui-forge/shared-protocol";
import {
  diagnosticErrorLabels,
  diagnosticToolLabels,
  diagnosticTurnLabels,
  diagnosticWarningLabels,
  formatDiagnosticDuration,
} from "./diagnosticsPresentation";
import styles from "./TaskDiagnostics.module.css";

const statusLabels: Record<TaskDiagnostics["status"], string> = {
  notLoaded: "未加载",
  idle: "空闲",
  systemError: "系统错误",
  active: "运行中",
  unknown: "未知",
};

/** 所有未知值保持明确的空缺标记；工具耗时只展示已记录值。 */
export function TaskDiagnosticsReport({ report }: { report: TaskDiagnostics }) {
  const toolCount = report.turns.reduce(
    (sum, turn) => sum + turn.tools.reduce((count, tool) => count + tool.count, 0),
    0,
  );
  return (
    <div className={styles.report} aria-label="诊断报告">
      {report.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="数据缺口"
          description={
            <ul className={styles.warnings}>
              {report.warnings.map((warning) => (
                <li key={warning}>{diagnosticWarningLabels[warning]}</li>
              ))}
            </ul>
          }
        />
      )}
      <section className={styles.section}>
        <h2>运行信息</h2>
        <dl className={styles.fields}>
          <div>
            <dt>任务</dt>
            <dd>{report.taskId}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{statusLabels[report.status]}</dd>
          </div>
          <div>
            <dt>实际模型</dt>
            <dd>{report.model ?? "未知"}</dd>
          </div>
          <div>
            <dt>模型提供方</dt>
            <dd>{report.modelProvider ?? "未知"}</dd>
          </div>
          <div>
            <dt>推理强度</dt>
            <dd>{report.reasoningEffort ?? "未知"}</dd>
          </div>
          <div>
            <dt>记录的 Codex 版本</dt>
            <dd>{report.codexVersion ?? "未知"}</dd>
          </div>
          <div>
            <dt>协议版本</dt>
            <dd>{report.protocolVersion}</dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>
              <time dateTime={report.generatedAt}>
                {new Date(report.generatedAt).toLocaleString("zh-CN")}
              </time>
            </dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>Codex 原生会话历史</dd>
          </div>
          <div>
            <dt>统计范围</dt>
            <dd>线程树，包含已采集的子代理摘要</dd>
          </div>
        </dl>
      </section>
      <section className={styles.section}>
        <h2>运行时与代理</h2>
        <dl className={styles.fields}>
          <div>
            <dt>可执行文件</dt>
            <dd>{report.runtime?.executablePath ?? "未知"}</dd>
          </div>
          <div>
            <dt>Codex Home</dt>
            <dd>{report.runtime?.codexHome ?? "未知"}</dd>
          </div>
          <div>
            <dt>服务层级</dt>
            <dd>{report.runtime?.serviceTier ?? "未知"}</dd>
          </div>
          <div>
            <dt>平台 / 架构</dt>
            <dd>
              {report.runtime
                ? `${report.runtime.platform ?? "未知"} / ${report.runtime.arch ?? "未知"}`
                : "未知"}
            </dd>
          </div>
          <div>
            <dt>并发</dt>
            <dd>
              {report.runtime
                ? `当前 ${report.runtime.currentConcurrency ?? "未知"}，峰值 ${report.runtime.peakConcurrency ?? "未知"}，配置 ${report.runtime.configuredConcurrency ?? "未知"}`
                : "未知"}
            </dd>
          </div>
          <div>
            <dt>代理数量</dt>
            <dd>{report.agents.length}</dd>
          </div>
        </dl>
        {report.agents.length === 0 ? (
          <p>暂无主线程或子代理摘要。</p>
        ) : (
          <div className={styles.agentList} aria-label="Agent 摘要">
            {report.agents.map((agent) => (
              <article className={styles.agent} key={agent.threadId}>
                <h3>
                  {agent.threadId} <Tag>{statusLabels[agent.status]}</Tag>
                </h3>
                <dl className={styles.fields}>
                  <div>
                    <dt>父线程</dt>
                    <dd>{agent.parentThreadId ?? "根线程"}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>{agent.source ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>{agent.model ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt>提供方</dt>
                    <dd>{agent.modelProvider ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt>推理强度</dt>
                    <dd>{agent.reasoningEffort ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt>服务层级</dt>
                    <dd>{agent.serviceTier ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt>错误类别</dt>
                    <dd>
                      {agent.errorCodes.length === 0
                        ? "无记录"
                        : agent.errorCodes.map((code) => diagnosticErrorLabels[code]).join("、")}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className={styles.section}>
        <h2>规则指纹</h2>
        <dl className={styles.fields}>
          <div>
            <dt>设计规则 SHA-256</dt>
            <dd>
              <code>{report.ruleFingerprints?.design ?? "未知"}</code>
            </dd>
          </div>
          <div>
            <dt>工程规则 SHA-256</dt>
            <dd>
              <code>{report.ruleFingerprints?.project ?? "未知"}</code>
            </dd>
          </div>
        </dl>
      </section>
      <section className={styles.section}>
        <h2>Token 用量</h2>
        {report.tokenUsage ? (
          <>
            <p className={styles.note}>
              最后一次原生累计记录：{new Date(report.tokenUsage.observedAt).toLocaleString("zh-CN")}
            </p>
            <dl className={styles.fields}>
              <div>
                <dt>总计</dt>
                <dd>{report.tokenUsage.total.totalTokens.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>输入</dt>
                <dd>{report.tokenUsage.total.inputTokens.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>缓存输入</dt>
                <dd>{report.tokenUsage.total.cachedInputTokens.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>缓存写入</dt>
                <dd>{report.tokenUsage.total.cacheWriteInputTokens.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{report.tokenUsage.total.outputTokens.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>推理输出</dt>
                <dd>{report.tokenUsage.total.reasoningOutputTokens.toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p>未采集</p>
        )}
      </section>
      <section className={styles.section}>
        <h2>轮次与工具</h2>
        <p className={styles.note}>
          {report.turns.length} 轮，{toolCount}{" "}
          个工具条目。工具耗时为已记录条目的耗时总和，可能包含并行执行，不代表轮次耗时。
        </p>
        {report.turns.length === 0 && <p>暂无轮次记录。</p>}
        {report.turns.map((turn, index) => (
          <section key={turn.turnId} className={styles.turn} aria-label={`第 ${index + 1} 轮诊断`}>
            <h3>
              第 {index + 1} 轮{" "}
              <Tag color={turn.status === "failed" ? "error" : "default"}>
                {diagnosticTurnLabels[turn.status]}
              </Tag>
            </h3>
            <dl className={styles.fields}>
              <div>
                <dt>轮次 ID</dt>
                <dd>{turn.turnId}</dd>
              </div>
              <div>
                <dt>轮次耗时</dt>
                <dd>{formatDiagnosticDuration(turn.durationMs)}</dd>
              </div>
              <div>
                <dt>错误类别</dt>
                <dd>{turn.errorCode ? diagnosticErrorLabels[turn.errorCode] : "无记录"}</dd>
              </div>
            </dl>
            {turn.tools.map((tool) => (
              <div className={styles.tool} key={tool.type}>
                <h4>{diagnosticToolLabels[tool.type]}</h4>
                <p>
                  总数 {tool.count} · 完成 {tool.completed} · 失败 {tool.failed} · 进行中{" "}
                  {tool.inProgress} · 其他 {tool.other}
                </p>
                <p className={styles.note}>
                  已知工具耗时合计：{formatDiagnosticDuration(tool.knownDurationMs)}（
                  {tool.timedCount}/{tool.count} 个条目有记录）
                </p>
              </div>
            ))}
          </section>
        ))}
      </section>
    </div>
  );
}
