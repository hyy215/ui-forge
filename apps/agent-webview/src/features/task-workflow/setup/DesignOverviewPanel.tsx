/** 展示设计 Artifact 的来源、规模和传输摘要。 */

import { Descriptions, Tag } from "antd";
import type { DesignDataIndex } from "@ui-forge/shared-protocol";
import { formatDesignDataBytes } from "./designDataFormat";

/** 设计数据概览面板参数。 */
export interface DesignOverviewPanelProps {
  index: DesignDataIndex;
}

/** 展示不包含原始 Section 内容的设计数据概览。 */
export function DesignOverviewPanel({ index }: DesignOverviewPanelProps) {
  return (
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="设计名称">{index.name}</Descriptions.Item>
      <Descriptions.Item label="Provider"><Tag>{index.provider}</Tag></Descriptions.Item>
      <Descriptions.Item label="设计引用"><code>{index.reference}</code></Descriptions.Item>
      <Descriptions.Item label="节点数量">{index.nodeCount}</Descriptions.Item>
      <Descriptions.Item label="区域数量">{index.regions.length}</Descriptions.Item>
      <Descriptions.Item label="Token 数量">{Object.keys(index.tokens).length}</Descriptions.Item>
      <Descriptions.Item label="原始分段">{index.sections.length}</Descriptions.Item>
      <Descriptions.Item label="数据大小">{formatDesignDataBytes(index.byteSize)}</Descriptions.Item>
    </Descriptions>
  );
}
