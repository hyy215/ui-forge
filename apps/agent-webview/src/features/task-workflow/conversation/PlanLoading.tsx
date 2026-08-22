/** 在尚未收到首个真实方案条目前展示紧凑加载占位。 */

import { Skeleton, Typography } from "antd";

/** 仅在服务端发送 plan-start 后展示方案生成状态。 */
export function PlanLoading() {
  return (
    <section className="plan-loading" aria-label="正在生成整体修改方案">
      <Typography.Text strong>正在生成第一项方案内容</Typography.Text>
      <Skeleton active title={{ width: "44%" }} paragraph={{ rows: 3 }} />
    </section>
  );
}
