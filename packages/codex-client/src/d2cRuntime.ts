/** 准备新建和恢复会话共用的 D2C 运行配置，不读取规则或构造用户输入。 */
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NativeMethods } from "./generated/native.js";
import { prepareTemporaryWorkspace, temporaryWorkspaceEnvironment } from "./temporaryWorkspace.js";
import { loopbackUrl } from "./design/boundaries.js";

/** 随包分发的配置、skill 与规则根目录；与目标项目目录分开。 */
export const bundleDirectory = fileURLToPath(new URL("../", import.meta.url));
/** 运行配置接受工具搜索、设计接入与临时目录设置，不接受需求、规则或执行权限。 */
export const d2cRuntimeOptionsSchema = z.strictObject({
  search: z.boolean().optional(),
  designAccess: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("magic") }),
      z.strictObject({
        kind: z.literal("vibe"),
        bridgeUrl: z.string().transform((value) => loopbackUrl(value).href),
      }),
      z.strictObject({ kind: z.literal("local") }),
    ])
    .optional(),
  temporaryDirectory: z
    .string()
    .refine(isAbsolute, "temporaryDirectory must be absolute")
    .optional(),
});
/** 新建和恢复共用的工具运行选项。 */
export type D2CRuntimeOptions = z.input<typeof d2cRuntimeOptionsSchema>;
/** 可用于原生线程的运行配置；不包含 developerInstructions 或模型输入。 */
export interface PreparedD2CRuntime {
  /** 已解析的目标工作区。 */
  cwd: string;
  /** 包内 MCP、Agent 角色和临时环境配置，不增加执行权限。 */
  config: NonNullable<NativeMethods["thread/start"]["params"]["config"]>;
  /** 供新任务显式引用的 D2C skill。 */
  skillPath: string;
  /** 已存在的产物目录。 */
  temporaryDirectory: string;
}
const objectSchema = z.record(z.string(), z.json());
const configSchema = z.object({
  mcp_servers: z.record(z.string(), objectSchema),
  agents: objectSchema,
});

/** 校验目标与包配置，并准备工具环境；恢复旧会话无需读取当前规则文件。 */
export async function prepareD2CRuntime(
  cwd: string,
  options: D2CRuntimeOptions,
  readConfig: () => Promise<Pick<NativeMethods["config/read"]["result"], "layers">>,
): Promise<PreparedD2CRuntime> {
  const parsed = d2cRuntimeOptionsSchema.parse(options);
  const target = await realpath(cwd);
  if (!(await stat(target)).isDirectory()) throw new Error("D2C target must be a directory");
  const dotCodex = await realpath(join(bundleDirectory, ".codex"));
  const result = await readConfig();
  const layer = result.layers?.find(
    (entry) => entry.name.type === "project" && entry.name.dotCodexFolder === dotCodex,
  );
  if (!layer || layer.disabledReason)
    throw new Error(
      `Cannot load codex-client config: ${layer?.disabledReason ?? "package project layer is missing; trust the package project in Codex"}`,
    );
  const config = configSchema.parse(layer.config);
  const designAccess = parsed.designAccess ?? { kind: "magic" };
  if (designAccess.kind === "magic") {
    const mastergo = config.mcp_servers.mastergo;
    if (!mastergo) throw new Error("Package MasterGo configuration is missing");
    // Keep the credential helper independent of the target project's Git root and shell syntax.
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    mastergo.http_headers_helper = `${quote(process.execPath)} ${quote(join(bundleDirectory, "scripts/mastergo-headers.mjs"))}`;
  } else if (designAccess.kind === "vibe") {
    config.mcp_servers.mastergo = { url: "https://mastergo.com/mcp/xf/sse", enabled: false };
    config.mcp_servers.ui_forge_vibe = {
      url: designAccess.bridgeUrl,
      enabled: true,
      enabled_tools: ["read_design"],
      startup_timeout_sec: 30,
      tool_timeout_sec: 180,
    };
  } else {
    config.mcp_servers.mastergo = { url: "https://mastergo.com/mcp/xf/sse", enabled: false };
  }
  if (designAccess.kind !== "vibe")
    config.mcp_servers.ui_forge_vibe = { url: "http://127.0.0.1:9/mcp", enabled: false };
  for (const role of Object.values(config.agents)) {
    if (
      role &&
      typeof role === "object" &&
      !Array.isArray(role) &&
      typeof role.config_file === "string"
    ) {
      role.config_file = isAbsolute(role.config_file)
        ? role.config_file
        : resolve(dotCodex, role.config_file);
      await access(role.config_file);
    }
  }
  const skillPath = join(bundleDirectory, ".agents/skills/ui-forge-d2c/SKILL.md");
  await access(skillPath);
  const temporary =
    parsed.temporaryDirectory === undefined
      ? await prepareTemporaryWorkspace(target)
      : await realpath(parsed.temporaryDirectory);
  if (!(await stat(temporary)).isDirectory())
    throw new Error("Temporary workspace must be a directory");
  const environment = temporaryWorkspaceEnvironment(temporary);
  const playwright = config.mcp_servers.playwright;
  if (!playwright) throw new Error("Package Playwright configuration is missing");
  const args = z.array(z.string()).default([]).parse(playwright.args);
  const retainedArgs = args.filter(
    (argument, index) =>
      argument !== "--output-dir" &&
      args[index - 1] !== "--output-dir" &&
      !argument.startsWith("--output-dir="),
  );
  playwright.args = [...retainedArgs, "--output-dir", temporary];
  playwright.cwd = temporary;
  playwright.env = {
    ...z.record(z.string(), z.string()).default({}).parse(playwright.env),
    ...environment,
  };
  return {
    cwd: target,
    config: {
      ...config,
      shell_environment_policy: { set: environment },
      ...(parsed.search === undefined ? {} : { web_search: parsed.search ? "live" : "disabled" }),
    },
    skillPath,
    temporaryDirectory: temporary,
  };
}
