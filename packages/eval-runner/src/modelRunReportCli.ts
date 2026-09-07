/** 离线读取用户指定的模型诊断 JSONL，并把脱敏报告写到标准输出。 */

import { readFile, stat } from "node:fs/promises";
import { createModelRunReport, parseModelRunEvents } from "./modelRunReport.js";

const paths = process.argv.slice(2);
if (paths.length !== 1 || !paths[0]) throw new Error("用法：node packages/eval-runner/dist/modelRunReportCli.js <日志.jsonl>");
const info = await stat(paths[0]);
if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("日志必须是小于 16 MB 的普通文件。");
const report = createModelRunReport(parseModelRunEvents(await readFile(paths[0], "utf8")));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
