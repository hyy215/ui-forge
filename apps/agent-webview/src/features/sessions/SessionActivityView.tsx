/** 呈现原生轮次的计划和补丁更新；未知事件集中在折叠的技术详情中。 */
import { z } from "zod";
import { Alert } from "antd";
import { nativeItemSchema, type NativeThread } from "@ui-forge/shared-protocol";
import { DiffView } from "./DiffView";
import { NativeItemView } from "./NativeItemView";
import { NativeValueView } from "./NativeValueView";
import { stringValue, type SessionPresentation } from "@ui-forge/client-core";
import { currentNativeRetry } from "./currentNativeRetry";
import styles from "./Sessions.module.css";

// 这些通知用于同步状态或流式内部细节，单独展示只会让启动阶段看起来像异常。
const hiddenActivityMethods = new Set([
  "thread/started",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "item/reasoning/textDelta",
  "item/reasoning/summaryPartAdded",
  "turn/moderationMetadata",
  "mcpServer/startupStatus/updated",
  "mcpServer/event/stream/notification",
  "fs/changed",
  "model/rerouted",
  "model/verification",
]);

/** 展示归并后的活动内容；完整诊断数据不占据默认对话区域。 */
export function SessionActivityView({
  activities,
  thread,
}: {
  activities: SessionPresentation["activities"];
  thread: NativeThread | undefined;
}) {
  const known = activities.filter((activity) =>
    [
      "turn/diff/updated",
      "turn/plan/updated",
      "item/mcpToolCall/progress",
      "item/started",
      "item/completed",
    ].includes(activity.method),
  );
  const unknown = activities.filter(
    (activity) => !known.includes(activity) && !hiddenActivityMethods.has(activity.method),
  );
  return (
    <>
      {currentNativeRetry(thread, activities) && (
        <Alert
          type="info"
          showIcon
          title="Codex 正在重试"
          description="原生服务仍在处理当前轮次，暂无需手动继续。"
        />
      )}
      {known.map((activity, index) => {
        const params = z.record(z.string(), z.unknown()).catch({}).parse(activity.params);
        if (activity.method === "turn/diff/updated")
          return (
            <details key={index} className={styles.toolItem}>
              <summary>
                <span className={styles.toolIcon}>±</span>
                <span>本轮代码差异</span>
                <span className={styles.chevron}>›</span>
              </summary>
              <DiffView diff={stringValue(params.diff)} />
            </details>
          );
        if (activity.method === "turn/plan/updated") {
          const plan = z
            .array(z.object({ step: z.string(), status: z.string() }))
            .catch([])
            .parse(params.plan);
          return (
            <details key={index} className={styles.toolItem}>
              <summary>
                <span className={styles.toolIcon}>☷</span>
                <span>任务计划</span>
                <span className={styles.toolSummary}>
                  {plan.filter((step) => step.status === "completed").length} / {plan.length}
                </span>
                <span className={styles.chevron}>›</span>
              </summary>
              <div className={styles.toolBody}>
                <p>{stringValue(params.explanation)}</p>
                <ol className={styles.planSteps}>
                  {plan.map((step, row) => (
                    <li key={row} data-status={step.status}>
                      <span>
                        {step.status === "completed"
                          ? "✓"
                          : step.status === "inProgress"
                            ? "◉"
                            : "○"}
                      </span>
                      {step.step}
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          );
        }
        const item = nativeItemSchema.safeParse(params.item);
        return item.success ? (
          <div key={index} className={styles.childActivity}>
            <span className={styles.hint}>子任务活动</span>
            <NativeItemView item={item.data} />
          </div>
        ) : (
          <p key={index} className={styles.hint}>
            {stringValue(params.message)}
          </p>
        );
      })}
      {unknown.length > 0 && (
        <details className={styles.activities}>
          <summary>其他活动（{unknown.length}）</summary>
          {unknown.map((activity, index) => (
            <details key={index}>
              <summary>{activity.method}</summary>
              <NativeValueView value={activity.params} />
            </details>
          ))}
        </details>
      )}
    </>
  );
}
