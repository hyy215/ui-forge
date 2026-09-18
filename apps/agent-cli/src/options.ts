/** 各命令共用的参数校验；保留脚本显式启用 JSON 输入输出的约束。 */
import type { Command } from "commander";
import { z } from "zod";

const jsonOptionsSchema = z.object({ json: z.boolean().default(false) });

/** 读取并校验继承的全局 JSON 开关，不信任命令库默认的宽泛选项类型。 */
export function readJsonOption(command: Command): boolean {
  return jsonOptionsSchema.parse(command.optsWithGlobals<Record<string, unknown>>()).json;
}

/** 非交互输入必须使用 NDJSON，避免脚本无法明确回复审批或问题。 */
export function requireTaskInputMode(json: boolean): void {
  if (!process.stdin.isTTY && !json) {
    throw new Error("脚本运行请使用 --json，审批和回答通过 stdin 提交。");
  }
}

/** 校验任务标识，拒绝空白标识；参数数量由 Commander 检查。 */
export function readTaskId(value: unknown): string {
  return z.string().trim().min(1, "需要一个非空 task-id。").parse(value);
}
