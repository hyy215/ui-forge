/** 递归展示一次工具调用及其显式声明的子调用。 */

import type { AgentToolProgress } from "../model/conversationStreamState";
import { formatDurationInSeconds } from "./durationFormat";

/** 描述一次工具调用及其显式声明的子调用。 */
export interface AgentProcessTreeNode {
  entry: AgentToolProgress;
  children: AgentProcessTreeNode[];
}

/** 递归展示一个工具及其子调用，不改变原始事件与指标。 */
export function ProcessTreeNode({ node }: { node: AgentProcessTreeNode }) {
  const entry = node.entry;
  return <div className="agent-process-event-tree">
    <div className="agent-process-event">
      <span className={`agent-process-event-dot agent-process-event-dot--${entry.outcome}`} />
      <div>
        <div className="agent-process-event-title">
          <code>{entry.toolName}</code>
          <small>{createToolMetricsLabel(entry)}</small>
        </div>
        <p>{entry.summary}</p>
      </div>
    </div>
    {node.children.length > 0 ? <div className="agent-process-event-children">
      {node.children.map((child) => <ProcessTreeNode key={child.entry.toolCallId} node={child} />)}
    </div> : null}
  </div>;
}

/** 将工具状态、耗时和可用的模型 Token 用量组合为一行。 */
function createToolMetricsLabel(tool: AgentToolProgress): string {
  const outcome = readToolOutcome(tool.outcome);
  if (!tool.metrics) return outcome;
  const duration = formatDurationInSeconds(tool.metrics.durationMs);
  const usage = tool.metrics.tokenUsage;
  if (!usage) return `${outcome} · ${duration}`;
  return `${outcome} · ${duration} · ${usage.totalTokens} Token`;
}

/** 把工具结果状态转换为紧凑中文标签。 */
function readToolOutcome(outcome: AgentToolProgress["outcome"]): string {
  switch (outcome) {
    case "running": return "执行中";
    case "success": return "已完成";
    case "warning": return "需注意";
    case "error": return "失败";
  }
}
