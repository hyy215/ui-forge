/** 展示 Server 已确认的 MasterGo 设计摘要、真实预览或布局结构降级图。 */
import { useState } from "react";
import { Alert, Button, Image, Tag } from "antd";
import type { InspectedDesignSummary } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { DesignDataDrawer } from "./DesignDataDrawer";
import { StructurePreview } from "./StructurePreview";

/** MasterGo 设计摘要卡片参数。 */
export interface DesignSummaryCardProps {
  summary: InspectedDesignSummary;
  taskId: string;
  dataSource: TaskWorkflowDataSource;
}

/** 渲染目标图层预览、身份信息、规模统计和解析警告。 */
export function DesignSummaryCard({ summary, taskId, dataSource }: DesignSummaryCardProps) {
  const [designDataOpen, setDesignDataOpen] = useState(false);
  const hasVisual = summary.preview !== null || summary.structurePreview !== null;
  return (
    <>
      <div className={`design-summary ${hasVisual ? "design-summary--with-preview" : ""}`}>
        {summary.preview && (
          <div className="design-preview">
            <Image
              alt={`${summary.name} 设计预览`}
              src={summary.preview.url}
              preview={{ mask: "查看大图" }}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        {!summary.preview && summary.structurePreview && (
          <StructurePreview preview={summary.structurePreview} />
        )}

        <div className="design-summary-content">
          <div className="design-summary-heading">
            <div>
              <span>设计稿</span>
              <strong>{summary.name}</strong>
            </div>
            <Tag color="success">读取完成</Tag>
          </div>

          <div className="design-summary-node">
            <span>目标节点</span>
            <strong>{summary.nodeName}</strong>
            <code>{summary.nodeId}</code>
          </div>

          <div className="design-summary-stats" aria-label="设计规模">
            <span><strong>{summary.regionCount}</strong> 个区域</span>
            <span><strong>{summary.nodeCount}</strong> 个节点</span>
            <span><strong>{summary.tokenCount}</strong> 个 Token</span>
          </div>

          {summary.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              title="设计解析存在提示"
              description={summary.warnings.join("；")}
            />
          )}

          {summary.designData && (
            <div className="design-summary-actions">
              <Button size="small" onClick={() => setDesignDataOpen(true)}>
                查看设计源回传数据
              </Button>
            </div>
          )}
        </div>
      </div>
      {summary.designData && (
        <DesignDataDrawer
          open={designDataOpen}
          taskId={taskId}
          artifact={summary.designData}
          dataSource={dataSource}
          onClose={() => setDesignDataOpen(false)}
        />
      )}
    </>
  );
}
