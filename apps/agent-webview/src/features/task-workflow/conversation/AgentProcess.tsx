/** 以可折叠阶段时间线展示服务端提供的安全执行过程与判断依据。 */

import { useEffect, useState } from "react";
import { Collapse } from "antd";
import type {
  AgentToolProgress,
  ConversationStreamState,
} from "../model/conversationStreamState";
import { formatDurationInSeconds } from "./durationFormat";
import {
  ProcessTreeNode,
  type AgentProcessTreeNode,
} from "./ProcessTreeNode";

export type { AgentProcessTreeNode } from "./ProcessTreeNode";

/** Agent 执行过程组件所需的流状态。 */
export interface AgentProcessProps {
  conversation: ConversationStreamState;
}

/** 以可折叠时间线展示进度摘要，不展示模型内部隐藏思维链。 */
export function AgentProcess({ conversation }: AgentProcessProps) {
  const hasProcess = conversation.processEntries.length > 0;
  const running = conversation.status === "validating_project"
    || conversation.status === "analyzing_design"
    || conversation.status === "planning";
  const [activeKeys, setActiveKeys] = useState<string[]>(running ? ["process"] : []);

  useEffect(() => {
    setActiveKeys(running ? ["process"] : []);
  }, [running]);

  if (!hasProcess) return null;

  return (
    <Collapse
      className="agent-process"
      ghost
      activeKey={activeKeys}
      onChange={(keys) => setActiveKeys(typeof keys === "string" ? [keys] : keys)}
      items={[{
        key: "process",
        label: <div className="agent-process-label">
          <span className={running ? "agent-process-pulse" : "agent-process-done"} />
          <strong>{running ? "正在执行" : "执行过程已完成"}</strong>
          <small>{createProcessSummary(conversation)}</small>
        </div>,
        children: <div className="agent-process-timeline">
          {createProcessTree(conversation.processEntries).map((node) => (
            <ProcessTreeNode key={node.entry.toolCallId} node={node} />
          ))}
        </div>,
      }]}
    />
  );
}

/** 根据协议中的 parentToolCallId 创建稳定树形结构，孤立子项回退为顶层展示。 */
export function createProcessTree(entries: readonly AgentToolProgress[]): AgentProcessTreeNode[] {
  const nodes = new Map(entries.map((entry) => [entry.toolCallId, {
    entry,
    children: [] as AgentProcessTreeNode[],
  }]));
  const roots: AgentProcessTreeNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.toolCallId);
    if (!node) continue;
    const parent = entry.parentToolCallId ? nodes.get(entry.parentToolCallId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 创建折叠状态下仍可读的执行摘要。 */
function createProcessSummary(conversation: ConversationStreamState): string {
  if (conversation.processEntries.some((tool) => tool.outcome === "running")) return "工具调用中";
  const completed = conversation.processEntries.filter((tool) => tool.metrics !== null);
  if (completed.length > 0) {
    const durationMs = completed.reduce((total, tool) => total + (tool.metrics?.durationMs ?? 0), 0);
    const totalTokens = completed.reduce(
      (total, tool) => total + (tool.metrics?.tokenUsage?.totalTokens ?? 0),
      0,
    );
    return `${formatDurationInSeconds(durationMs)}${totalTokens > 0 ? ` · ${totalTokens} Token` : ""}`;
  }
  return conversation.processEntries.at(-1)?.summary ?? "等待下一步";
}
