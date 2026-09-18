/** 从仓库本地环境配置创建 AgentServer Facade 并启动 HTTP 监听。 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentServer } from "./agentServer.js";

const localEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

const host = process.env.UI_FORGE_HOST ?? "127.0.0.1";
const port = Number(process.env.UI_FORGE_PORT ?? 4310);
const server = new AgentServer();

const close = () => {
  void server.close();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
process.once("SIGHUP", close);

try {
  await server.listen({ host, port });
} catch (error) {
  server.application.log.error(error instanceof Error ? error.message : "Server 启动失败");
  await server.close();
  process.exitCode = 1;
}
