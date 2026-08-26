/** 展示真实构建、页面渲染、视觉差异门禁和按需加载的图片证据。 */

import { useEffect, useState } from "react";
import { Alert, Image, Tag, Typography } from "antd";
import type {
  DeliveryEvidenceImage,
  DeliveryValidationViewModel,
} from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../../data-sources/task-workflow";
import styles from "./CodeGenerationPanel.module.css";

/** 自动交付验收面板所需的权威结果和证据读取能力。 */
export interface DeliveryValidationPanelProps {
  taskId: string;
  dataSource: TaskWorkflowDataSource;
  validation: DeliveryValidationViewModel;
}

/** 渲染三项自动门禁，并只在结果存在时按任务所有权读取 PNG。 */
export function DeliveryValidationPanel({
  taskId,
  dataSource,
  validation,
}: DeliveryValidationPanelProps) {
  const [images, setImages] = useState<DeliveryEvidenceImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const actualReference = validation.status === "pending" ? undefined : validation.render?.actualImage;
  const differenceReference = validation.status === "pending" ? undefined : validation.visual?.differenceImage;

  useEffect(() => {
    const references = [actualReference, differenceReference].filter(
      (reference): reference is NonNullable<typeof reference> => reference !== undefined,
    );
    if (references.length === 0) {
      setImages([]);
      setImageError(undefined);
      return;
    }
    const controller = new AbortController();
    setImageError(undefined);
    void Promise.all(references.map((reference) => dataSource.getDeliveryEvidence({
      taskId,
      evidenceId: reference.evidenceId,
    }, controller.signal))).then(setImages).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setImageError(error instanceof Error ? error.message : "验收图片读取失败。");
      }
    });
    return () => controller.abort();
  }, [actualReference, dataSource, differenceReference, taskId]);

  if (validation.status === "pending") {
    return <Alert type="info" showIcon title="等待自动交付验收" description="代码落盘后将继续执行构建、页面渲染和视觉差异门禁。" />;
  }
  const passed = validation.status === "passed";
  return <section className={styles.validationPanel}>
    <div className={styles.acceptanceHeader}>
      <strong>自动交付验收</strong>
      <Tag color={passed ? "success" : "warning"}>{passed ? "3 项通过" : "需人工处理"}</Tag>
    </div>
    <Alert
      type={passed ? "success" : "warning"}
      showIcon
      title={validation.summary}
      description={validation.status === "blocked" ? validation.reasons.join("；") : undefined}
    />
    <div className={styles.validationStages}>
      <div>
        <Tag color={validation.build.status === "passed" ? "success" : "error"}>构建</Tag>
        <span>{validation.build.summary}</span>
        <small>{validation.build.durationMs} ms</small>
      </div>
      {validation.render ? <div>
        <Tag color={validation.render.status === "passed" ? "success" : "error"}>渲染</Tag>
        <span>{validation.render.summary}</span>
        <small>{validation.render.durationMs} ms</small>
      </div> : null}
      {validation.visual ? <div>
        <Tag color={validation.visual.status === "passed" ? "success" : "error"}>视觉</Tag>
        <span>{`显著差异 ${(validation.visual.pixelDifferenceRatio * 100).toFixed(2)}% · 阈值 ${(validation.visual.threshold * 100).toFixed(2)}%`}</span>
        <small>{validation.visual.durationMs} ms</small>
      </div> : null}
    </div>
    {validation.build.outputSummary ? <details className={styles.buildOutput}>
      <summary><code>{validation.build.command}</code> 输出摘要</summary>
      <pre>{validation.build.outputSummary}</pre>
    </details> : null}
    {imageError ? <Alert type="warning" showIcon title="验收图片暂不可用" description={imageError} /> : null}
    {images.length > 0 ? <div className={styles.evidenceGrid}>
      {images.map((image) => <figure key={image.reference.evidenceId}>
        <Image
          src={image.dataUrl}
          alt={image.reference.kind === "actual" ? "页面实际渲染截图" : "页面视觉差异图"}
        />
        <Typography.Text type="secondary">
          {image.reference.kind === "actual" ? "实际渲染" : "视觉差异"}
        </Typography.Text>
      </figure>)}
    </div> : null}
  </section>;
}
