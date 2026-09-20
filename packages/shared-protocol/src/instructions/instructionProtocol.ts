/** 规则配置仅允许编辑固定的两份 Markdown 文件，不接收任意磁盘路径。 */
import { z } from "zod";
/** 配置页面读写方法。 */
export const instructionMethods = {
  read: "ui-forge.instructions.read",
  save: "ui-forge.instructions.save",
} as const;
/** 规则文件种类。 */
export const instructionKindSchema = z.enum(["design", "project"]);
/** 读取指定规则。 */
export const readInstructionSchema = z.strictObject({ kind: instructionKindSchema });
/** 保存全文并携带已读取版本，避免覆盖其他页面的编辑。 */
export const saveInstructionSchema = readInstructionSchema.extend({
  content: z
    .string()
    .max(500_000)
    .refine((v) => v.trim().length > 0, "规则内容不能为空。"),
  revision: z.string().min(1),
});
/** 磁盘读取结果与内容版本，路径仅用于展示。 */
export const instructionDocumentSchema = z.object({
  kind: instructionKindSchema,
  path: z.string(),
  content: z.string(),
  revision: z.string(),
});
/** 可编辑规则类型。 */
export type InstructionKind = z.infer<typeof instructionKindSchema>;
/** 真实文件内容与版本。 */
export type InstructionDocument = z.infer<typeof instructionDocumentSchema>;
