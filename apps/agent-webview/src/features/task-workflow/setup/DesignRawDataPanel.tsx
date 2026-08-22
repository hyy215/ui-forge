/** 按需选择、搜索并查看单个设计来源原始数据 Section。 */

import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Select, Spin, Typography } from "antd";
import type {
  DesignDataSection,
  DesignDataSectionSummary,
} from "@ui-forge/shared-protocol";
import { formatDesignDataBytes } from "./designDataFormat";
import styles from "./designDataDrawer.module.css";

/** 原始 Section 浏览面板参数。 */
export interface DesignRawDataPanelProps {
  sections: DesignDataSectionSummary[];
  loadedSections: Record<number, DesignDataSection>;
  loadingSection?: number;
  onLoadSection: (sectionIndex: number) => Promise<void>;
}

/** 每次只加载并渲染用户选择的 Section，避免一次展开完整原始响应。 */
export function DesignRawDataPanel({
  sections,
  loadedSections,
  loadingSection,
  onLoadSection,
}: DesignRawDataPanelProps) {
  const [sectionIndex, setSectionIndex] = useState(sections[0]?.index ?? 0);
  const [search, setSearch] = useState("");
  const section = loadedSections[sectionIndex];

  useEffect(() => {
    if (sections.some((item) => item.index === sectionIndex)) void onLoadSection(sectionIndex);
  }, [onLoadSection, sectionIndex, sections]);

  const formatted = useMemo(() => {
    if (!section) return "";
    const text = JSON.stringify(section.data, null, 2);
    if (!search.trim()) return text;
    const query = search.trim().toLocaleLowerCase();
    return text.split("\n").filter((line) => line.toLocaleLowerCase().includes(query)).join("\n");
  }, [search, section]);

  if (sections.length === 0) return <Empty description="没有可读取的原始 Section" />;
  return (
    <div className={styles.rawPanel!}>
      <div className={styles.rawToolbar!}>
        <Select
          value={sectionIndex}
          options={sections.map((item) => ({
            value: item.index,
            label: `${item.label} · ${formatDesignDataBytes(item.byteSize)}`,
          }))}
          onChange={setSectionIndex}
          className={styles.sectionSelect!}
        />
        <Input.Search
          allowClear
          value={search}
          placeholder="过滤当前 Section 的字段或值"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {loadingSection === sectionIndex && !section
        ? <div className={styles.loading!}><Spin description="正在读取 Section…" /></div>
        : <>
            {search && !formatted && <Typography.Text type="secondary">没有匹配行</Typography.Text>}
            <pre className={styles.jsonViewer!}>{formatted}</pre>
          </>}
    </div>
  );
}
