/** 使用布局坐标绘制明确标注为非截图的设计结构预览。 */

import type { InspectedDesignSummary } from "@ui-forge/shared-protocol";

/** 结构预览参数。 */
export interface StructurePreviewProps {
  preview: NonNullable<InspectedDesignSummary["structurePreview"]>;
}

/** 将设计区域边界绘制到保持原始宽高比的 SVG 坐标系。 */
export function StructurePreview({ preview }: StructurePreviewProps) {
  return (
    <figure className="design-preview design-structure-preview">
      <svg
        aria-label="设计结构预览"
        role="img"
        viewBox={`0 0 ${preview.width} ${preview.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width={preview.width} height={preview.height} fill={preview.background ?? "#ffffff"} />
        {preview.regions.map((region) => (
          <g key={region.id}>
            <rect
              className="design-structure-region"
              x={region.x}
              y={region.y}
              width={region.width}
              height={region.height}
            >
              <title>{`${region.name} · ${region.id}`}</title>
            </rect>
            {region.width >= 100 && region.height >= 28 && (
              <text x={region.x + 7} y={region.y + 17}>{region.name}</text>
            )}
          </g>
        ))}
      </svg>
      <figcaption>结构预览 · 由布局坐标生成，非设计截图</figcaption>
    </figure>
  );
}
