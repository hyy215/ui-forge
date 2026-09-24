/** 只读展示交付声明及证据核对结果，不恢复任务或自行推导验收通过。 */
import { deliveryGaps } from "@ui-forge/client-core";
import {
  deliveryMethods,
  taskDeliverySchema,
  type DeliveryEvidenceResult,
  type DeliveryManifest,
  type TaskDelivery,
} from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { LocalClient } from "../client.js";
import { readJsonOption, readTaskId } from "../options.js";
import { terminalText } from "../terminalText.js";

const availabilityLabels: Record<TaskDelivery["availability"], string> = {
  available: "报告可用",
  missing: "未生成交付报告",
  invalid: "交付报告无效",
};
const issueLabels: Record<NonNullable<TaskDelivery["issue"]>, string> = {
  "invalid-report": "报告格式无效",
  "identity-mismatch": "报告任务标识不匹配",
  "outside-scope": "报告位置超出允许范围",
  unreadable: "报告无法读取",
  "too-large": "报告超过大小限制",
};
const declaredLabels: Record<DeliveryManifest["checks"][number]["declaredStatus"], string> = {
  passed: "通过",
  failed: "失败",
  blocked: "受阻",
  "not-verified": "未验证",
};
const categoryLabels: Record<DeliveryManifest["checks"][number]["category"], string> = {
  build: "构建",
  interaction: "交互",
  visual: "视觉",
  performance: "性能",
  review: "审查",
  other: "其他",
};
const sourceLabels: Record<TaskDelivery["source"]["state"], string> = {
  matches: "所列文件一致（不代表全项目）",
  stale: "源码清单已过期，需重新验证",
  unverifiable: "无法核对源码清单，不代表一致",
};
const evidenceLabels: Record<DeliveryEvidenceResult["state"], string> = {
  matched: "文件 SHA-256 一致（仅证明内容指纹一致，不代表验收通过）",
  changed: "文件内容已变化，需重新验证",
  missing: "证据缺失",
  "outside-scope": "超出允许范围",
  unavailable: "证据无法读取或核对",
  unsupported: "不支持核对此类工具",
  incomplete: "原生工具尚未完成",
  failed: "原生工具执行失败",
  succeeded: "原生工具已完成（不代表独立验收通过）",
};
const sourceFileLabels: Record<TaskDelivery["source"]["files"][number]["state"], string> = {
  matched: "指纹一致",
  changed: "内容已变化",
  missing: "文件缺失",
  "outside-scope": "超出允许范围",
  unavailable: "无法读取",
};

function readable(delivery: TaskDelivery): string {
  const lines = [
    `任务：${delivery.taskId}`,
    `交付记录：${availabilityLabels[delivery.availability]}（${delivery.availability}）`,
    `服务核对时间：${delivery.checkedAt}`,
  ];
  if (delivery.issue) lines.push(`原因：${issueLabels[delivery.issue]}`);
  const report = delivery.report;
  if (report) {
    lines.push(`生成时间（报告声明）：${report.generatedAt}`);
    if (report.summary) lines.push(`摘要（报告声明）：${report.summary}`);
  }
  const gaps = delivery.availability === "available" && report ? deliveryGaps(delivery) : [];
  if (gaps.length > 0) {
    lines.push("证据缺口：");
    for (const gap of gaps) lines.push(`  - ${gap.message}`);
  }
  lines.push(`源码核对：${sourceLabels[delivery.source.state]}`);
  for (const file of delivery.source.files) {
    lines.push(`  ${file.path}：${sourceFileLabels[file.state]}`);
  }
  if (report) {
    for (const check of report.checks) {
      lines.push(
        `${categoryLabels[check.category]} | ${check.title} | 报告声明：${declaredLabels[check.declaredStatus]}（${check.declaredStatus}）`,
      );
      if (check.details) lines.push(`  说明（报告声明）：${check.details}`);
      if (check.evidence.length === 0) lines.push("  证据：未附证据");
      for (const [index, reference] of check.evidence.entries()) {
        const evidence = delivery.evidence.find(
          (entry) => entry.checkId === check.id && entry.index === index,
        );
        const label =
          reference.kind === "file"
            ? `文件 ${reference.path}`
            : reference.kind === "native"
              ? `原生工具 ${reference.turnId}/${reference.itemId}`
              : `旧格式证据 ${reference.path}`;
        const exitCode = evidence?.exitCode;
        const exitLabel = exitCode === null || exitCode === undefined ? "" : `；退出码 ${exitCode}`;
        lines.push(
          `  ${label}：${evidence ? evidenceLabels[evidence.state] : "未核对"}${exitLabel}`,
        );
      }
    }
  } else {
    lines.push("没有可展示的验收声明；不能据此推断已通过或未通过。");
  }
  if (delivery.history === "unavailable") {
    lines.push("注意：原生历史不可用，相关工具证据无法核对。");
  }
  lines.push("检查项状态由报告声明；文件指纹或工具状态核对不等于独立验收通过。");
  return terminalText(lines.join("\n"));
}

/** 注册交付查询；JSON 保留报告协议，读取失败不恢复任务或重试执行。 */
export function registerDeliveryCommand(program: Command): void {
  const command = program
    .command("delivery")
    .description("只读查看交付声明、源码及证据核对结果")
    .argument("<task-id>", "任务标识");
  command.action(async (value: unknown) => {
    const taskId = readTaskId(value);
    const client = new LocalClient();
    await client.connect();
    const delivery = await client.request(deliveryMethods.read, { taskId }, taskDeliverySchema);
    process.stdout.write(
      `${readJsonOption(command) ? JSON.stringify(delivery) : readable(delivery)}\n`,
    );
  });
}
