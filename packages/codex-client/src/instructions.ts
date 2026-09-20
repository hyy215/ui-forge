/** 读取与保存共享的设计、工程规则；自定义文件缺失时报告错误，不静默回退。 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const kindSchema = z.enum(["design", "project"]);
const contentSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Instructions must not be empty");

/** 两种共享规则；默认文件位于包内 instructions/。 */
export type InstructionKind = z.infer<typeof kindSchema>;

/** 返回默认规则或调用方指定的 Markdown 文件路径；自定义路径必须是绝对路径。 */
export function instructionPath(kind: InstructionKind, path?: string): string {
  kindSchema.parse(kind);
  if (path !== undefined)
    return z
      .string()
      .refine(isAbsolute)
      .refine((value) => value.endsWith(".md"))
      .parse(path);
  return fileURLToPath(new URL(`../instructions/${kind}.md`, import.meta.url));
}

/** 每次从磁盘读取，已保存规则会在下一次准备 D2C 请求时生效。 */
export async function readInstructions(kind: InstructionKind, path?: string): Promise<string> {
  return contentSchema.parse(await readFile(instructionPath(kind, path), "utf8"));
}

/** 保存宿主明确指定的规则；不创建目录，写入失败直接向调用方报告。 */
export async function saveInstructions(
  kind: InstructionKind,
  content: string,
  path?: string,
): Promise<void> {
  await writeFile(instructionPath(kind, path), contentSchema.parse(content), "utf8");
}
