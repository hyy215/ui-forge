/** 读取并导出字段受限的诊断报告，不恢复会话、不发送输入或订阅执行。 */
import {
  diagnosticMethods,
  taskDiagnosticsSchema,
  type TaskDiagnostics,
  type DiagnosticWarning,
} from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { LocalClient } from "../client.js";
import { readJsonOption, readTaskId } from "../options.js";

const warningLabels: Record<DiagnosticWarning, string> = {
  rulesUnavailable: "未记录任务创建时的规则指纹",
  tokenUsageUnavailable: "未采集到原生 Token 统计",
  metadataReadFailed: "诊断元数据读取失败，报告不完整",
  metadataWriteFailed: "诊断元数据保存失败，报告不完整",
  historyIncomplete: "原生历史未提供完整工具项",
  runtimeUnavailable: "未采集到运行时信息",
  agentsUnavailable: "未采集到子代理信息",
  concurrencyUnavailable: "未采集到并发统计",
};

function readable(report: TaskDiagnostics): string {
  const unknown = "未知";
  const lines = [
    `任务：${report.taskId}；状态：${report.status}`,
    `模型：${report.model ?? unknown}；提供方：${report.modelProvider ?? unknown}；推理强度：${report.reasoningEffort ?? unknown}`,
    `会话记录的 Codex 版本：${report.codexVersion ?? unknown}；适配协议：${report.protocolVersion}`,
    `生成时间：${report.generatedAt}；来源：原生 thread/read；范围：线程树`,
    `运行时：${report.runtime?.executablePath ?? unknown}；Codex Home：${report.runtime?.codexHome ?? unknown}；服务层级：${report.runtime?.serviceTier ?? unknown}`,
    `并发：当前 ${report.runtime?.currentConcurrency ?? unknown}；峰值 ${report.runtime?.peakConcurrency ?? unknown}；配置 ${report.runtime?.configuredConcurrency ?? unknown}`,
    `代理：${report.agents.length}`,
    `设计规则 SHA-256：${report.ruleFingerprints?.design ?? unknown}`,
    `工程规则 SHA-256：${report.ruleFingerprints?.project ?? unknown}`,
    `原生累计 Token：${report.tokenUsage?.total.totalTokens ?? unknown}`,
    ...(report.tokenUsage ? [`Token 观测时间：${report.tokenUsage.observedAt}`] : []),
    `轮次：${report.turns.length}`,
  ];
  for (const agent of report.agents) {
    lines.push(
      `  Agent ${agent.threadId} | 父线程：${agent.parentThreadId ?? "根线程"} | 状态：${agent.status} | 模型：${agent.model ?? unknown} | 推理强度：${agent.reasoningEffort ?? unknown} | 错误码：${agent.errorCodes.join(",") || "未记录"}`,
    );
  }
  for (const turn of report.turns) {
    lines.push(
      `  ${turn.turnId} | ${turn.status} | ${turn.durationMs === null ? unknown : `${turn.durationMs} ms`} | 错误码：${turn.errorCode ?? "未记录"}`,
    );
    for (const tool of turn.tools) {
      lines.push(
        `    ${tool.type}：${tool.count} 项，完成 ${tool.completed}，失败 ${tool.failed}，执行中 ${tool.inProgress}，其他 ${tool.other}；已知耗时 ${tool.knownDurationMs === null ? unknown : `${tool.knownDurationMs} ms`}（${tool.timedCount} 项）`,
      );
    }
  }
  lines.push("工具已知耗时是工具项之和，不等于轮次耗时；执行状态不代表验收结论。");
  for (const warning of report.warnings) lines.push(`注意：${warningLabels[warning]}`);
  return lines.join("\n");
}

/** 注册诊断命令；JSON 输出保持报告 Schema，未知历史不补造数据。 */
export function registerDiagnosticsCommand(program: Command): void {
  const command = program
    .command("diagnostics")
    .description("查看任务诊断摘要或用 --json 导出白名单报告")
    .argument("<task-id>", "任务标识");
  command.action(async (value: unknown) => {
    const taskId = readTaskId(value);
    const client = new LocalClient();
    await client.connect();
    const report = await client.request(diagnosticMethods.read, { taskId }, taskDiagnosticsSchema);
    process.stdout.write(
      `${readJsonOption(command) ? JSON.stringify(report) : readable(report)}\n`,
    );
  });
}
