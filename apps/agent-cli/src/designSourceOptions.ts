/** run 与 design-check 共用的显式设计来源参数，不创建或恢复任务。 */
import {
  designSourceSchema,
  defaultVibeEndpoint,
  defaultVibeStatusEndpoint,
  type DesignSource,
} from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { z } from "zod";

const optionsSchema = z.object({
  designSource: z.enum(["local", "mastergo"]).optional(),
  designUrl: z.string().trim().min(1).optional(),
  mastergoConnection: z.enum(["magic", "vibe"]).optional(),
  vibeEndpoint: z.string().optional(),
  vibeStatusEndpoint: z.string().optional(),
});

/** 注册来源和平台接入两组参数；未选择平台时保持图片/文字来源。 */
export function addDesignSourceOptions(command: Command): Command {
  return command
    .option("--design-source <source>", "设计来源：local（图片/文字）或 mastergo")
    .option("--design-url <url>", "MasterGo HTTPS 文件或图层链接")
    .option("--mastergo-connection <connection>", "MasterGo 接入方式：magic 或 vibe（须显式选择）")
    .option("--vibe-endpoint <url>", `Vibe MCP 地址（默认 ${defaultVibeEndpoint}）`)
    .option(
      "--vibe-status-endpoint <url>",
      `Vibe 画布状态地址（默认 ${defaultVibeStatusEndpoint}）`,
    );
}

/** 拒绝跨来源或跨接入选项，避免把链接静默降级为普通提示词。 */
export function readDesignSourceOptions(value: unknown): DesignSource {
  const options = optionsSchema.parse(value);
  if (!options.designSource && options.designUrl)
    throw new Error(
      "--design-url 需要显式指定 --design-source mastergo 和 --mastergo-connection。",
    );
  const kind = options.designSource ?? "local";
  if (kind === "local") {
    if (
      options.designUrl ||
      options.mastergoConnection ||
      options.vibeEndpoint !== undefined ||
      options.vibeStatusEndpoint !== undefined
    )
      throw new Error("local 来源不能使用 MasterGo 链接或接入参数。");
    return { kind };
  }
  if (!options.designUrl || !options.mastergoConnection)
    throw new Error("mastergo 来源需要 --design-url 和显式 --mastergo-connection magic|vibe。");
  if (
    options.mastergoConnection === "magic" &&
    (options.vibeEndpoint !== undefined || options.vibeStatusEndpoint !== undefined)
  )
    throw new Error("Magic 接入不能使用 Vibe 地址参数。");
  return designSourceSchema.parse({
    kind,
    url: options.designUrl,
    connection:
      options.mastergoConnection === "magic"
        ? { kind: "magic" }
        : {
            kind: "vibe",
            endpoint: options.vibeEndpoint ?? defaultVibeEndpoint,
            statusEndpoint: options.vibeStatusEndpoint ?? defaultVibeStatusEndpoint,
          },
  });
}
