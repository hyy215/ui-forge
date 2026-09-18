/** 会话文件链接协议；实际路径必须由服务按任务目录校验后解析。 */
import { z } from "zod";
import { sessionIdSchema } from "../sessions/sessionProtocol.js";

/** 打开本地文件：服务解析路径，VS Code 宿主使用原生编辑器打开。 */
export const sessionFileMethods = { open: "ui-forge.files.open" } as const;
/** 浏览器入口只读获取文件内容的地址。 */
export const sessionFileRoute = "/api/session-file";
/** 模型给出的文件链接，支持相对路径、绝对路径和本地 file URI。 */
export const sessionFileInputSchema = sessionIdSchema.extend({
  path: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !/[\u0000-\u001f]/.test(value), "文件路径包含无效字符。"),
});
/** 经过目录范围和存在性校验的真实文件及可选行列位置。 */
export const sessionFileSchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().positive().max(2_147_483_647).optional(),
  column: z.number().int().positive().max(2_147_483_647).optional(),
});
/** 打开或预览指定任务引用的文件。 */
export type SessionFileInput = z.infer<typeof sessionFileInputSchema>;
/** 文件解析结果。 */
export type SessionFile = z.infer<typeof sessionFileSchema>;
