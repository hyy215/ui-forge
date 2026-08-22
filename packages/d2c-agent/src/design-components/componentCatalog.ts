/** 定义可由组合入口配置的平台无关组件目录与运行时校验。 */

import { z } from "zod";

/** 组件类型 ID 使用稳定的小写短横线格式，避免绑定具体设计平台枚举。 */
export const componentTypeIdSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  "组件类型 ID 必须使用小写字母、数字和短横线。",
);

/** 单个组件类型的可配置识别提示和可选实现映射。 */
export const componentCatalogEntrySchema = z.object({
  id: componentTypeIdSchema,
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  implementation: z.object({
    packageName: z.string().trim().min(1),
    exportName: z.string().trim().min(1),
  }).optional(),
});

/** 完整组件目录；同一 ID 只能定义一次。 */
export const componentCatalogSchema = z.object({
  components: z.array(componentCatalogEntrySchema).min(1),
}).superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const [index, component] of catalog.components.entries()) {
    if (ids.has(component.id)) {
      context.addIssue({
        code: "custom",
        path: ["components", index, "id"],
        message: `组件类型 ID 重复：${component.id}`,
      });
    }
    ids.add(component.id);
  }
});

/** 组件目录中的稳定类型 ID。 */
export type ComponentTypeId = z.infer<typeof componentTypeIdSchema>;

/** 可配置的单个组件类型定义。 */
export type ComponentCatalogEntry = z.infer<typeof componentCatalogEntrySchema>;

/** 由 Server 组合入口注入的组件目录。 */
export type ComponentCatalog = z.infer<typeof componentCatalogSchema>;

/** 校验并复制外部组件目录，防止调用方在运行期间修改配置。 */
export function parseComponentCatalog(input: unknown): ComponentCatalog {
  return structuredClone(componentCatalogSchema.parse(input));
}
