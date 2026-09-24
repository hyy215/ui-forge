/** 分开展示报告作者声明、证据核对事实和源码清单状态，保留失败与未知。 */
import { Alert, Tag } from "antd";
import { deliveryGaps } from "@ui-forge/client-core";
import type { DeliveryEvidenceResult, TaskDelivery } from "@ui-forge/shared-protocol";
import { SessionFileLink } from "./SessionFileLink";
import styles from "./TaskDelivery.module.css";

const declaredLabels = {
  passed: "声明通过",
  failed: "声明失败",
  blocked: "声明受阻",
  "not-verified": "声明未验证",
};
const evidenceLabels: Record<DeliveryEvidenceResult["state"], string> = {
  matched: "文件指纹一致",
  changed: "文件已变化",
  missing: "证据缺失",
  "outside-scope": "超出可读范围",
  unavailable: "无法核对",
  unsupported: "不支持核对",
  incomplete: "工具尚未结束",
  failed: "工具执行失败",
  succeeded: "工具执行成功",
};
const sourceLabels: Record<TaskDelivery["source"]["files"][number]["state"], string> = {
  matched: "指纹一致",
  changed: "已变化",
  missing: "已缺失",
  "outside-scope": "超出可读范围",
  unavailable: "无法读取",
};
const issueLabels: Record<NonNullable<TaskDelivery["issue"]>, string> = {
  "invalid-report": "报告格式无效。",
  "identity-mismatch": "报告不属于当前任务。",
  "outside-scope": "报告超出可读范围。",
  unreadable: "报告无法读取。",
  "too-large": "报告超过大小限制。",
};

/** 所列文件一致只适用于清单范围；不合成整体通过状态，也不渲染报告里的任意链接。 */
export function TaskDeliveryReport({ delivery }: { delivery: TaskDelivery }) {
  const report = delivery.availability === "available" ? delivery.report : null;
  const gaps = report ? deliveryGaps(delivery) : [];
  const sourceState = delivery.source.files.length ? delivery.source.state : "unverifiable";
  return (
    <div className={styles.report} aria-label="交付记录">
      <p className={styles.note}>
        核对时间：
        <time dateTime={delivery.checkedAt}>
          {new Date(delivery.checkedAt).toLocaleString("zh-CN")}
        </time>
      </p>
      {!report ? (
        <Alert
          type="warning"
          showIcon
          title={
            delivery.availability === "missing"
              ? "暂无交付报告，验收未验证。"
              : "交付报告无效，无法确认验收。"
          }
          description={delivery.issue ? issueLabels[delivery.issue] : "本轮结束不代表验收通过。"}
        />
      ) : (
        <>
          {sourceState === "stale" && (
            <Alert type="warning" showIcon title="此报告对应的源码已变化，以下为历史结论。" />
          )}
          {gaps.length > 0 && (
            <section className={styles.gaps} aria-label="证据缺口">
              <Alert
                type="warning"
                showIcon
                title="证据缺口"
                description={
                  <ul className={styles.gapList}>
                    {gaps.map((gap, index) => (
                      <li key={`${gap.code}:${gap.checkId ?? ""}:${index}`}>{gap.message}</li>
                    ))}
                  </ul>
                }
              />
            </section>
          )}
          <section className={styles.section} aria-label="报告结论">
            <h2>报告结论</h2>
            <p className={styles.note}>以下为报告作者声明，不等同于独立验收结果。</p>
            {report.summary && <p className={styles.text}>{report.summary}</p>}
            <p className={styles.note}>
              报告时间（声明）：
              <time dateTime={report.generatedAt}>
                {new Date(report.generatedAt).toLocaleString("zh-CN")}
              </time>
            </p>
            {report.checks.map((check) => (
              <div className={styles.check} key={check.id}>
                <h3>
                  {check.title}
                  <Tag>{declaredLabels[check.declaredStatus]}</Tag>
                </h3>
                {check.details && <p className={styles.text}>{check.details}</p>}
              </div>
            ))}
          </section>
          <section className={styles.section} aria-label="源码状态">
            <h2>源码状态</h2>
            <Alert
              showIcon
              type={sourceState === "matches" ? "info" : "warning"}
              title={
                sourceState === "matches"
                  ? "所列文件一致"
                  : sourceState === "stale"
                    ? "源码已变化，需要重新验证"
                    : "源码状态无法核对"
              }
              description={
                sourceState === "matches"
                  ? "仅核对报告列出的文件，不代表整个项目一致。"
                  : sourceState === "stale"
                    ? "保留报告原结论；该结论不能用于当前源码。"
                    : "清单为空或文件无法读取，不能确认报告适用于当前源码。"
              }
            />
            {delivery.source.files.length > 0 && (
              <ul className={styles.files}>
                {delivery.source.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <span>{sourceLabels[file.state]}</span>
                  </li>
                ))}
              </ul>
            )}
            {(delivery.source.manifestFingerprint || delivery.reportSha256) && (
              <details className={styles.fingerprints}>
                <summary>内容指纹</summary>
                {delivery.source.manifestFingerprint && (
                  <p>
                    源码清单指纹（非全项目版本）<code>{delivery.source.manifestFingerprint}</code>
                  </p>
                )}
                {delivery.reportSha256 && (
                  <p>
                    报告内容指纹<code>{delivery.reportSha256}</code>
                  </p>
                )}
              </details>
            )}
          </section>
          <section className={styles.section} aria-label="证据核对">
            <h2>证据核对</h2>
            <p className={styles.note}>
              文件仅核对指纹；工具成功仅表示执行成功，不证明业务或视觉验收通过。
            </p>
            {delivery.history === "unavailable" && (
              <Alert type="warning" showIcon title="原生历史不可用，工具证据尚未确认。" />
            )}
            {report.checks.map((check) => (
              <div className={styles.check} key={check.id}>
                <h3>{check.title}</h3>
                {check.evidence.length === 0 ? (
                  <p className={styles.note}>未提供证据，无法独立核对。</p>
                ) : (
                  <ul className={styles.evidence}>
                    {check.evidence.map((evidence, index) => {
                      const result = delivery.evidence.find(
                        (entry) => entry.checkId === check.id && entry.index === index,
                      );
                      return (
                        <li key={index}>
                          <span>{result ? evidenceLabels[result.state] : "尚未核对"}</span>
                          {evidence.kind === "file" ? (
                            result?.state === "matched" && result.resolvedPath ? (
                              <SessionFileLink path={result.resolvedPath}>
                                {evidence.path}
                              </SessionFileLink>
                            ) : (
                              <code>{evidence.path}</code>
                            )
                          ) : evidence.kind === "native" ? (
                            <code>
                              {evidence.turnId} / {evidence.itemId}
                            </code>
                          ) : (
                            <code>{evidence.path}</code>
                          )}
                          {result?.exitCode !== null && result?.exitCode !== undefined && (
                            <span>退出码：{result.exitCode}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
