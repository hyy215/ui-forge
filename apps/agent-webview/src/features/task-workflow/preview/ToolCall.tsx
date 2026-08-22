/** 展示一次经过协议校验的确定性设计工具调用证据。 */

import { Badge, Collapse, Tag } from "antd";
import type { SvgTool } from "@ui-forge/shared-protocol";
import { SourceNote } from "./SourceNote";
import { formatDurationInSeconds } from "../conversation/durationFormat";

/** 工具调用结果组件所需的结构化工具数据。 */
export interface ToolCallProps {
  tool: SvgTool;
}

/** 展示一次工具调用的摘要、来源和可展开结构化结果。 */
export function ToolCall({ tool }: ToolCallProps) {
  return (
    <div className="tool-call">
      <div className="tool-call-head"><Badge status="success" /><code>{tool.name}</code><Tag color="success">完成 · {formatDurationInSeconds(tool.durationMs)}</Tag></div>
      <p>{tool.summary}</p>
      <SourceNote>{tool.source}</SourceNote>
      {tool.details && <Collapse
        className="tool-result-collapse"
        ghost
        size="small"
        items={[{
          key: `${tool.name}-response`,
          label: tool.details.label,
          children: <div className="tool-result-content">
            <div className="tool-result-meta">
              <span><small>文件</small><strong>{tool.details.file}</strong></span>
              <span><small>节点</small><code>{tool.details.node}</code></span>
              <span><small>节点数量</small><strong>{tool.details.nodeCount}</strong></span>
            </div>
            <pre>{JSON.stringify(tool.details.payload, null, 2)}</pre>
          </div>,
        }]}
      />}
    </div>
  );
}
