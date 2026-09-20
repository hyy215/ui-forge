/** 为 Codex 的 HTTP MCP 鉴权读取仓库根目录 .env；仅向 Codex 输出所需请求头。 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

let token = process.env.MG_MCP_TOKEN;
if (!token) {
  try {
    token = parseEnv(readFileSync(new URL("../../../.env", import.meta.url), "utf8")).MG_MCP_TOKEN;
  } catch {
    console.error("MasterGo: set MG_MCP_TOKEN in the repository root .env or the environment.");
    process.exit(1);
  }
}
if (!token?.trim() || /[\r\n]/.test(token)) {
  console.error("MasterGo: MG_MCP_TOKEN must be a non-empty, single-line token.");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ "x-mg-useraccesstoken": token.trim() }));
