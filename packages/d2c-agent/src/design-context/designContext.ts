/** 定义 D2C 下游能力消费的平台无关标准化设计模型。 */

import type { DesignSource } from "./designSource.js";

/** 表示从设计稿中识别出的顶层语义区域。 */
export interface DesignRegion {
  id: string;
  name: string;
  role?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** 描述设计来源提供的像素级预览。 */
export interface DesignPreview {
  url: string;
  width?: number;
  height?: number;
}

/** 描述可由布局坐标绘制的设计结构区域。 */
export interface DesignStructureRegion extends DesignRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 描述缺少像素级截图时可展示的结构轮廓。 */
export interface DesignStructurePreview {
  width: number;
  height: number;
  background?: string;
  regions: DesignStructureRegion[];
}

/** 表示供设计摘要展示与 SVG 生成消费的平台无关设计上下文。 */
export interface DesignContext {
  source: DesignSource;
  name: string;
  nodeCount: number;
  tokens: Record<string, string | number>;
  regions: DesignRegion[];
  preview?: DesignPreview;
  structurePreview?: DesignStructurePreview;
  warnings: string[];
}
