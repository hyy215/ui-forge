/** 通过分层 Tab 按需展示任意设计来源 Artifact 的标准化索引和原始数据。 */

import { Alert, Drawer, Spin, Tabs } from "antd";
import type { DesignArtifactReference } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import { DesignOverviewPanel } from "./DesignOverviewPanel";
import { DesignRawDataPanel } from "./DesignRawDataPanel";
import { DesignRegionsTable } from "./DesignRegionsTable";
import { DesignTokensTable } from "./DesignTokensTable";
import { useDesignData } from "./useDesignData";
import styles from "./designDataDrawer.module.css";

/** 设计数据 Drawer 参数。 */
export interface DesignDataDrawerProps {
  open: boolean;
  taskId: string;
  artifact: DesignArtifactReference;
  dataSource: TaskWorkflowDataSource;
  onClose: () => void;
}

/** 打开时读取轻量索引，并在原始数据 Tab 中按 Section 延迟加载内容。 */
export function DesignDataDrawer({
  open,
  taskId,
  artifact,
  dataSource,
  onClose,
}: DesignDataDrawerProps) {
  const designData = useDesignData(open, taskId, artifact, dataSource);
  return (
    <Drawer
      title="设计源回传数据"
      width="min(920px, 92vw)"
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {designData.error && <Alert type="error" showIcon title="设计数据读取失败" description={designData.error} />}
      {designData.loadingIndex && <div className={styles.loading!}><Spin description="正在读取设计数据索引…" /></div>}
      {designData.index && (
        <Tabs items={[
          {
            key: "overview",
            label: "概览",
            children: <DesignOverviewPanel index={designData.index} />,
          },
          {
            key: "regions",
            label: `区域 (${designData.index.regions.length})`,
            children: <DesignRegionsTable regions={designData.index.regions} />,
          },
          {
            key: "tokens",
            label: `Token (${Object.keys(designData.index.tokens).length})`,
            children: <DesignTokensTable tokens={designData.index.tokens} />,
          },
          {
            key: "raw",
            label: `原始数据 (${designData.index.sections.length})`,
            children: (
              <DesignRawDataPanel
                sections={designData.index.sections}
                loadedSections={designData.sections}
                {...(designData.loadingSection === undefined
                  ? {}
                  : { loadingSection: designData.loadingSection })}
                onLoadSection={designData.loadSection}
              />
            ),
          },
        ]} />
      )}
    </Drawer>
  );
}
