/** 定义客户端按需浏览设计索引与原始 Section 的通信协议。 */

import { z } from "zod";

/** 校验快照中携带的轻量设计 Artifact 引用。 */
export const designArtifactReferenceSchema = z.object({
  artifactId: z.string().uuid(),
  sectionCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
});

/** 校验读取设计 Artifact 索引所需的任务归属信息。 */
export const getDesignDataIndexInputSchema = z.object({
  taskId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

/** 校验读取单个原始设计 Section 的参数。 */
export const getDesignDataSectionInputSchema = getDesignDataIndexInputSchema.extend({
  sectionIndex: z.number().int().nonnegative(),
});

/** 校验设计数据浏览器展示的标准化区域。 */
export const designDataRegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

/** 校验原始设计数据中一个可按需读取的 Section 摘要。 */
export const designDataSectionSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  label: z.string(),
  byteSize: z.number().int().nonnegative(),
});

/** 校验设计 Artifact 的轻量索引，不包含原始 Section 内容。 */
export const designDataIndexSchema = z.object({
  artifactId: z.string().uuid(),
  provider: z.string(),
  reference: z.string(),
  name: z.string(),
  nodeCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  regions: z.array(designDataRegionSchema),
  tokens: z.record(z.string(), z.union([z.string(), z.number()])),
  sections: z.array(designDataSectionSummarySchema),
});

/** 校验客户端按需读取的单个原始设计 Section。 */
export const designDataSectionSchema = designDataSectionSummarySchema.extend({
  artifactId: z.string().uuid(),
  data: z.unknown(),
});

/** 快照携带的轻量设计 Artifact 引用。 */
export type DesignArtifactReference = z.infer<typeof designArtifactReferenceSchema>;
/** 读取设计数据索引的请求参数。 */
export type GetDesignDataIndexInput = z.infer<typeof getDesignDataIndexInputSchema>;
/** 读取原始设计 Section 的请求参数。 */
export type GetDesignDataSectionInput = z.infer<typeof getDesignDataSectionInputSchema>;
/** 设计数据浏览器使用的标准化区域。 */
export type DesignDataRegion = z.infer<typeof designDataRegionSchema>;
/** 原始设计 Section 的轻量摘要。 */
export type DesignDataSectionSummary = z.infer<typeof designDataSectionSummarySchema>;
/** 不包含原始 Section 内容的设计 Artifact 索引。 */
export type DesignDataIndex = z.infer<typeof designDataIndexSchema>;
/** 客户端按需读取的单个原始设计 Section。 */
export type DesignDataSection = z.infer<typeof designDataSectionSchema>;
