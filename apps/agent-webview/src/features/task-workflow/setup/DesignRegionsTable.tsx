/** 使用可分页表格展示标准化设计区域。 */

import { Table } from "antd";
import type { TableColumnsType } from "antd";
import type { DesignDataIndex, DesignDataRegion } from "@ui-forge/shared-protocol";

/** 设计区域表格参数。 */
export interface DesignRegionsTableProps {
  regions: DesignDataIndex["regions"];
}

const columns: TableColumnsType<DesignDataRegion> = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "ID", dataIndex: "id", key: "id", render: (value: string) => <code>{value}</code> },
  { title: "类型", dataIndex: "role", key: "role", render: (value?: string) => value ?? "—" },
  {
    title: "位置",
    key: "position",
    render: (_, region) => region.x === undefined || region.y === undefined
      ? "—"
      : `${region.x}, ${region.y}`,
  },
  {
    title: "尺寸",
    key: "size",
    render: (_, region) => region.width === undefined || region.height === undefined
      ? "—"
      : `${region.width} × ${region.height}`,
  },
];

/** 分页展示区域名称、身份、类型、位置和尺寸。 */
export function DesignRegionsTable({ regions }: DesignRegionsTableProps) {
  return (
    <Table
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={regions}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 720 }}
    />
  );
}
