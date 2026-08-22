/** 在单视图右侧集中展示 MasterGo 摘要、预览和读取证据。 */

import { useState } from "react";
import { Button, Collapse, Image, Tag, Typography } from "antd";
import type { InspectedDesignSummary, SvgTool } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { ToolCall } from "../preview/ToolCall";
import { DesignDataDrawer } from "../setup/DesignDataDrawer";
import { StructurePreview } from "../setup/StructurePreview";

/** MasterGo 设计上下文面板所需真实数据。 */
export interface DesignContextPanelProps {
  design: InspectedDesignSummary;
  tools: SvgTool[];
  taskId: string;
  dataSource: TaskWorkflowDataSource;
  confirmed: boolean;
}

/** 在右侧展示设计摘要，默认展开 SVG 预览并提供确认入口。 */
export function DesignContextPanel({
  design,
  tools,
  taskId,
  dataSource,
  confirmed,
}: DesignContextPanelProps) {
  const [designDataOpen, setDesignDataOpen] = useState(false);
  const hasVisual = design.preview !== null || design.structurePreview !== null;
  return (
    <>
      <section className="design-context-panel">
        <div className="design-context-head">
          <div><Typography.Text strong>MasterGo 设计</Typography.Text><small>{confirmed ? "设计稿已确认" : "设计稿已读取"}</small></div>
        </div>
        <div className="design-context-summary">
          <strong title={design.name}>{design.name}</strong>
          <div className="design-context-target">
            <small>目标</small>
            <span title={design.nodeName}>{design.nodeName}</span>
            <code title={design.nodeId}>{design.nodeId}</code>
          </div>
          <div className="design-context-stats">
            <span>{design.nodeCount} 节点</span>
            <span>{design.regionCount} 区域</span>
            <span>{design.tokenCount} Token</span>
          </div>
          {design.warnings.length > 0 && <div className="design-context-warnings">
            {design.warnings.map((warning) => <Tag color="warning" key={warning}>{warning}</Tag>)}
          </div>}
          {design.designData && <Button className="design-source-button" type="text" size="small" onClick={() => setDesignDataOpen(true)}>查看设计源回传数据</Button>}
        </div>
        <Collapse
          className="design-context-details"
          ghost
          defaultActiveKey={hasVisual ? ["preview"] : []}
          items={[
            ...(hasVisual ? [{
              key: "preview",
              label: design.preview ? "查看 SVG 预览" : "查看结构预览",
              children: <div className="visual-review-image">
                {design.preview
                  ? <Image src={design.preview.url} alt={`${design.name} SVG 预览`} />
                  : design.structurePreview && <StructurePreview preview={design.structurePreview} />}
              </div>,
            }] : []),
            {
              key: "evidence",
              label: "查看读取证据",
              children: <div className="design-tool-evidence">
                {tools.map((tool) => <ToolCall key={tool.name} tool={tool} />)}
              </div>,
            },
          ]}
        />
      </section>
      {design.designData && <DesignDataDrawer
        open={designDataOpen}
        taskId={taskId}
        artifact={design.designData}
        dataSource={dataSource}
        onClose={() => setDesignDataOpen(false)}
      />}
    </>
  );
}
