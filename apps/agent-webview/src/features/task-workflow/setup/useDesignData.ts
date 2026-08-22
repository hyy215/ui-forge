/** 按 Drawer 生命周期加载设计 Artifact 索引和用户选中的原始 Section。 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignArtifactReference,
  DesignDataIndex,
  DesignDataSection,
} from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";

/**
 * 管理设计数据 Drawer 的按需读取状态。
 *
 * Drawer 关闭或依赖变化时取消索引请求；原始 Section 只有被选择后才读取，
 * 已读取 Section 会在当前 Drawer 生命周期内缓存。
 */
export function useDesignData(
  open: boolean,
  taskId: string,
  artifact: DesignArtifactReference,
  dataSource: TaskWorkflowDataSource,
) {
  const [index, setIndex] = useState<DesignDataIndex>();
  const [sections, setSections] = useState<Record<number, DesignDataSection>>({});
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [loadingSection, setLoadingSection] = useState<number>();
  const [error, setError] = useState<string>();
  const loadedSectionIndexes = useRef(new Set<number>());
  const sectionController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadingIndex(true);
    setError(undefined);
    setIndex(undefined);
    setSections({});
    loadedSectionIndexes.current.clear();
    sectionController.current?.abort();
    void dataSource.getDesignDataIndex({ taskId, artifactId: artifact.artifactId }, controller.signal)
      .then(setIndex)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "设计数据索引读取失败。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIndex(false);
      });
    return () => {
      controller.abort();
      sectionController.current?.abort();
    };
  }, [artifact.artifactId, dataSource, open, taskId]);

  /** 读取并缓存一个原始 Section，重复选择时复用现有结果。 */
  const loadSection = useCallback(async (sectionIndex: number) => {
    if (loadedSectionIndexes.current.has(sectionIndex)) return;
    sectionController.current?.abort();
    const controller = new AbortController();
    sectionController.current = controller;
    setLoadingSection(sectionIndex);
    setError(undefined);
    try {
      const section = await dataSource.getDesignDataSection({
        taskId,
        artifactId: artifact.artifactId,
        sectionIndex,
      }, controller.signal);
      if (controller.signal.aborted) return;
      loadedSectionIndexes.current.add(sectionIndex);
      setSections((current) => ({ ...current, [sectionIndex]: section }));
    } catch (reason: unknown) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "设计数据 Section 读取失败。");
      }
    } finally {
      if (sectionController.current === controller) {
        sectionController.current = undefined;
        setLoadingSection(undefined);
      }
    }
  }, [artifact.artifactId, dataSource, taskId]);

  return { index, sections, loadingIndex, loadingSection, error, loadSection };
}
