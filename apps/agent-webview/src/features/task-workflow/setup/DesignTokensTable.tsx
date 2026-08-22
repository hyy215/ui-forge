/** 使用表格展示标准化 Design Token 名称和值。 */

import { Empty, Table } from "antd";
import type { TableColumnsType } from "antd";
import type { DesignDataIndex } from "@ui-forge/shared-protocol";

interface TokenRow {
  name: string;
  value: string | number;
}

/** Design Token 表格参数。 */
export interface DesignTokensTableProps {
  tokens: DesignDataIndex["tokens"];
}

const columns: TableColumnsType<TokenRow> = [
  { title: "Token", dataIndex: "name", key: "name", render: (value: string) => <code>{value}</code> },
  { title: "值", dataIndex: "value", key: "value", render: (value) => String(value) },
];

/** 分页展示 Token；没有识别结果时提供明确空状态。 */
export function DesignTokensTable({ tokens }: DesignTokensTableProps) {
  const rows = Object.entries(tokens).map(([name, value]) => ({ name, value }));
  if (rows.length === 0) return <Empty description="当前设计数据中没有识别到 Token" />;
  return (
    <Table
      rowKey="name"
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 12, showSizeChanger: false }}
    />
  );
}
