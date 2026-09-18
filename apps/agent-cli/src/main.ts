#!/usr/bin/env node
/** ui-forge 可执行入口；命令注册、执行与错误输出由 CLI 模块负责。 */
import { runCli } from "./cli.js";

await runCli(process.argv.slice(2));
