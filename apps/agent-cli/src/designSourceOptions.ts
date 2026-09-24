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
  const parsedOptions = optionsSchema.safeParse(value);
  if (!parsedOptions.success) {
    const field = parsedOptions.error.issues[0]?.path[0];
    switch (field) {
      case "designSource":
        throw new Error("--design-source 只能为 local 或 mastergo。");
      case "mastergoConnection":
        throw new Error("--mastergo-connection 只能为 magic 或 vibe。");
      case "designUrl":
        throw new Error("请输入完整的 MasterGo HTTPS 文件或图层链接。");
      case "vibeEndpoint":
      case "vibeStatusEndpoint":
        throw new Error("Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。");
      default:
        throw new Error("设计来源参数无效；请检查 --design-source、--design-url 和接入选项。");
    }
  }
  const options = parsedOptions.data;
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
  if (!options.designUrl) throw new Error("mastergo 来源需要 --design-url。");
  if (!options.mastergoConnection)
    throw new Error("mastergo 来源需要显式指定 --mastergo-connection magic|vibe。");
  if (
    options.mastergoConnection === "magic" &&
    (options.vibeEndpoint !== undefined || options.vibeStatusEndpoint !== undefined)
  )
    throw new Error("Magic 接入不能使用 Vibe 地址参数。");
  const source = designSourceSchema.safeParse({
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
  if (!source.success) {
    const endpointIssue = source.error.issues.some((issue) => issue.path.includes("connection"));
    throw new Error(
      endpointIssue
        ? "Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。"
        : "请输入完整的 MasterGo HTTPS 文件或图层链接。",
    );
  }
  return source.data;
}
