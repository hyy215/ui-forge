/** 注册 CLI 子命令并统一处理环境加载、帮助、参数错误和异步执行失败。 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerDiagnosticsCommand } from "./commands/diagnostics.js";
import { registerDeliveryCommand } from "./commands/delivery.js";
import { registerDesignCheckCommand } from "./commands/designCheck.js";
import { registerListCommand } from "./commands/list.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerRunCommand } from "./commands/run.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerStatusCommand } from "./commands/status.js";
import { terminalText } from "./terminalText.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** 每次执行创建独立命令树，避免测试或嵌入调用之间保留参数状态。 */
function createProgram(): Command {
  const program = new Command()
    .name("ui-forge")
    .description("从设计输入创建、查看和继续本机 Codex 任务。")
    .option("--json", "输出 JSON；run / resume 使用 NDJSON 输入输出")
    .helpOption("-h, --help", "显示命令帮助")
    .helpCommand("help [command]", "显示指定命令的帮助")
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        process.stdout.write(text);
      },
      // Commander 会先输出再抛错，统一在 runCli 中输出一次，以兼容 JSON 错误格式。
      writeErr: () => undefined,
    });

  program.action(() => {
    program.outputHelp();
  });
  registerDoctorCommand(program, root);
  registerServeCommand(program);
  registerRunCommand(program);
  registerListCommand(program);
  registerStatusCommand(program);
  registerDiagnosticsCommand(program);
  registerDeliveryCommand(program);
  registerDesignCheckCommand(program);
  registerResumeCommand(program);
  return program;
}

/** 执行一组用户参数；正常帮助不算失败，其他错误写入 stderr 并设置退出码 1。 */
export async function runCli(argv: string[]): Promise<void> {
  try {
    if (existsSync(`${root}/.env`)) process.loadEnvFile(`${root}/.env`);
    await createProgram().parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    const message = error instanceof Error ? error.message : "ui-forge 执行失败。";
    const separator = argv.indexOf("--");
    const json = argv.slice(0, separator < 0 ? argv.length : separator).includes("--json");
    process.stderr.write(
      `${json ? JSON.stringify({ type: "error", message }) : terminalText(message)}\n`,
    );
    process.exitCode = 1;
  }
}
