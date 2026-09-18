/** serve 命令：在前台运行本地服务，并响应终端或进程的关闭信号。 */
import { AgentServer } from "@ui-forge/agent-server";
import type { Command } from "commander";

/** 注册本机服务命令；监听失败时关闭服务并交给入口报告错误。 */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("前台运行本机 Agent Server")
    .action(async () => {
      const server = new AgentServer();
      const close = () => {
        void server.close();
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
      process.once("SIGHUP", close);
      try {
        await server.listen({ host: "127.0.0.1", port: Number(process.env.UI_FORGE_PORT ?? 4310) });
      } catch (error) {
        process.removeListener("SIGINT", close);
        process.removeListener("SIGTERM", close);
        process.removeListener("SIGHUP", close);
        await server.close();
        throw error;
      }
    });
}
