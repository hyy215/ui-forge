/** 检查本包的 D2C 配置或输出原生请求预览；不创建任务、启动 MCP 或调用模型。 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CodexClient, checkCodexVersion } from "../dist/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    check: { type: "boolean" },
    "dry-run": { type: "boolean" },
    target: { type: "string" },
    codex: { type: "string" },
    model: { type: "string" },
    image: { type: "string", short: "i", multiple: true },
    search: { type: "boolean" },
    "design-constraints": { type: "string" },
    "project-constraints": { type: "string" },
  },
});
if (Boolean(values.check) === Boolean(values["dry-run"]))
  throw new Error("Choose --check or --dry-run");
// npm workspace scripts change cwd; INIT_CWD retains the caller's directory.
const caller = process.env.INIT_CWD || process.cwd();
const target = resolve(caller, values.target || ".");
const client = new CodexClient({
  cwd: target,
  executable: values.codex || process.env.UI_FORGE_CODEX_PATH || "codex",
});
try {
  const prepared = await client.prepareD2C({
    prompt: positionals.join(" ") || (values.check ? "检查 D2C 配置" : ""),
    images: values.image,
    model: values.model,
    search: values.search,
    designInstructions: values["design-constraints"],
    projectInstructions: values["project-constraints"],
  });
  if (values["dry-run"]) {
    // Print the payload structure without exposing user-edited MCP credentials or rule contents.
    console.log(
      JSON.stringify(
        {
          thread: {
            ...prepared.thread,
            config: {
              mcpServers: Object.keys(prepared.thread.config.mcp_servers),
              agents: Object.keys(prepared.thread.config.agents).filter((name) =>
                name.startsWith("d2c_"),
              ),
            },
            developerInstructions: "Loaded design/project rules (omitted from console)",
          },
          input: prepared.input,
        },
        null,
        2,
      ),
    );
  } else {
    const skills = await client.request("skills/list", { cwds: [target], forceReload: true });
    const skill = skills.data
      .flatMap((entry) => entry.skills)
      .find((entry) => entry.path === prepared.input[0].path);
    if (!skill?.enabled) throw new Error("Package D2C skill is unavailable or disabled");
    const account = await client.request("account/read", {});
    const version = await checkCodexVersion(
      values.codex || process.env.UI_FORGE_CODEX_PATH || "codex",
    );
    const pillow = spawnSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
    console.log(
      JSON.stringify(
        {
          target: prepared.thread.cwd,
          packageConfig: "loaded",
          skill: skill.name,
          version,
          authenticated: account.account !== null || !account.requiresOpenaiAuth,
          mcpServers: Object.keys(prepared.thread.config.mcp_servers),
          mcpConnection: "not checked (no MCP process or network request started)",
          optionalImageScripts:
            pillow.status === 0 ? "Python/Pillow available" : "Python/Pillow unavailable",
        },
        null,
        2,
      ),
    );
  }
} finally {
  await client.close();
}
