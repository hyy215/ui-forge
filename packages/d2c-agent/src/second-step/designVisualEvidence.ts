/** 定义 Plan DeepAgent 可消费的受控设计图片证据端口。 */

import type { DesignInspection } from "../design-context/designInspection.js";
import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { DesignStructureEvidence } from "../design-context/designStructure.js";

/** 一张已转换为安全栅格 data URL 的视觉证据。 */
export interface DesignVisualImage {
  label: string;
  dataUrl: string;
  candidateId?: string;
}

/** 汇总整体预览与按候选裁剪的图片证据。 */
export interface DesignVisualEvidence {
  images: DesignVisualImage[];
  structure?: DesignStructureEvidence;
  warnings: string[];
}

/** 隔离 D2C 领域编排与 SVG 栅格化、图片裁剪实现。 */
export interface DesignVisualEvidenceProvider {
  /** 为当前设计和候选创建有界的 PNG 视觉证据。 */
  create(
    inspection: DesignInspection,
    recognition: DesignComponentRecognition,
    signal?: AbortSignal,
  ): Promise<DesignVisualEvidence>;
}
