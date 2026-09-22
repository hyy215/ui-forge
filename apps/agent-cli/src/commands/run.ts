/** run 命令：校验设计输入、上传图片、创建任务并连接原生会话终端。 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  createdSessionSchema,
  sessionMethods,
  sessionSnapshotSchema,
  type CreateSessionInput,
} from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { z } from "zod";
import { LocalClient } from "../client.js";
import { readJsonOption, requireTaskInputMode } from "../options.js";
import { watchTask } from "../taskSession.js";
import { addDesignSourceOptions, readDesignSourceOptions } from "../designSourceOptions.js";

const runOptionsSchema = z.object({
  target: z
    .string()
    .min(1, "run 需要 --target。")
    .transform((value) => resolve(value)),
  image: z
    .string()
    .min(1)
    .transform((value) => resolve(value))
    .optional(),
});

/** 读取受支持格式的设计图片，并在上传前限制单图大小。 */
async function readDesignImages(image: string | undefined): Promise<CreateSessionInput["images"]> {
  if (!image) return [];
  if ((await stat(image)).size > 5 * 1024 * 1024) throw new Error("设计图片超过 5 MiB。");
  const mime = (
    { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" } as Record<string, string>
  )[extname(image).toLowerCase()];
  if (!mime) throw new Error("设计图片须为 PNG、JPEG 或 WebP。");
  return [
    {
      name: basename(image),
      dataUrl: `data:image/${mime};base64,${(await readFile(image)).toString("base64")}`,
    },
  ];
}

/** 注册创建任务命令；命令行需求仅拼接文本，不经过 shell 或模板展开。 */
export function registerRunCommand(program: Command): void {
  const command = addDesignSourceOptions(
    program
      .command("run")
      .description("根据需求、设计链接或图片创建并连接任务")
      .requiredOption("--target <directory>", "已存在的目标项目目录")
      .option("--image <path>", "PNG、JPEG 或 WebP 图片（最多 5 MiB）")
      .argument("[requirements...]", "需求文本；包含选项形式的文字时放在 -- 之后")
      .addHelpText(
        "after",
        '\n示例：\n  ui-forge run --target /absolute/app --image ./design.png -- "支持搜索与重置"',
      ),
  );

  command.action(async (requirements: unknown) => {
    const options = runOptionsSchema.parse(command.optsWithGlobals<Record<string, unknown>>());
    const designSource = readDesignSourceOptions(command.opts());
    const text = z.array(z.string()).parse(requirements).join(" ").trim();
    if (!text && designSource.kind === "local" && !options.image) {
      throw new Error("run 需要 --target，以及需求文本、设计链接或图片。");
    }
    const json = readJsonOption(command);
    requireTaskInputMode(json);
    const images = await readDesignImages(options.image);
    const client = new LocalClient();
    await client.connect();
    const result = await client.request(
      sessionMethods.create,
      {
        projectPath: options.target,
        prompt: text,
        images,
        designSource,
      },
      createdSessionSchema,
    );
    if (result.warning) process.stderr.write(`${result.warning}\n`);
    const snapshot = await client.request(
      sessionMethods.read,
      { taskId: result.taskId },
      sessionSnapshotSchema,
    );
    process.exitCode = await watchTask(client, snapshot, json);
  });
}
