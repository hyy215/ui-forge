import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryMethods, taskDeliverySchema, type TaskDelivery } from "@ui-forge/shared-protocol";
import { deliveryGaps } from "@ui-forge/client-core";
import { registerDeliveryCommand } from "./delivery.js";

const runtime = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  request: vi.fn<(method: string, params: unknown, schema: unknown) => Promise<unknown>>(),
}));
vi.mock("../client.js", () => ({
  LocalClient: class {
    connect = runtime.connect;
    request = runtime.request;
  },
}));

const fingerprint = "a".repeat(64);
const report: TaskDelivery = {
  version: 1,
  taskId: "task-1",
  checkedAt: "2026-09-23T02:00:00.000Z",
  availability: "available",
  issue: null,
  reportSha256: fingerprint,
  report: {
    version: 1,
    taskId: "task-1",
    generatedAt: "2026-09-23T01:00:00.000Z",
    summary: "交付摘要",
    sourceFiles: [{ path: "src/App.tsx", sha256: fingerprint }],
    checks: [
      {
        id: "build",
        category: "build",
        title: "构建检查",
        declaredStatus: "passed",
        details: "构建命令退出码为零",
        evidence: [
          { kind: "file", path: "evidence/build.txt", sha256: fingerprint },
          { kind: "native", turnId: "turn-1", itemId: "tool-1" },
        ],
      },
      {
        id: "interaction",
        category: "interaction",
        title: "保存失败处理",
        declaredStatus: "failed",
        details: "错误后输入丢失",
        evidence: [],
      },
      {
        id: "visual",
        category: "visual",
        title: "严格像素验收",
        declaredStatus: "blocked",
        details: "缺少参考图",
        evidence: [],
      },
      {
        id: "review",
        category: "review",
        title: "代码审查",
        declaredStatus: "not-verified",
        details: "尚未执行",
        evidence: [],
      },
    ],
  },
  source: {
    state: "matches",
    manifestFingerprint: fingerprint,
    files: [{ path: "src/App.tsx", state: "matched" }],
  },
  evidence: [
    {
      checkId: "build",
      index: 0,
      state: "matched",
      resolvedPath: "/tmp/evidence/build.txt",
      exitCode: null,
    },
    { checkId: "build", index: 1, state: "succeeded", resolvedPath: null, exitCode: 0 },
  ],
  history: "available",
};
let stdout: string[];

async function runDelivery(options: string[] = ["task-1"]): Promise<void> {
  const program = new Command().option("--json").exitOverride();
  registerDeliveryCommand(program);
  await program.parseAsync(["delivery", ...options], { from: "user" });
}

beforeEach(() => {
  vi.resetAllMocks();
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  runtime.connect.mockResolvedValue();
  runtime.request.mockResolvedValue(report);
});
afterEach(() => vi.restoreAllMocks());

describe("delivery command", () => {
  it("labels declarations and evidence without treating the record as independent acceptance", async () => {
    await runDelivery();
    const output = stdout.join("");
    expect(output).toContain("报告可用（available）");
    expect(output).toContain("服务核对时间：2026-09-23T02:00:00.000Z");
    expect(output).toContain("生成时间（报告声明）：2026-09-23T01:00:00.000Z");
    expect(output).toContain("所列文件一致（不代表全项目）");
    expect(output).toContain("报告声明：通过（passed）");
    expect(output).toContain("报告声明：失败（failed）");
    expect(output).toContain("报告声明：受阻（blocked）");
    expect(output).toContain("报告声明：未验证（not-verified）");
    expect(output).toContain("文件 SHA-256 一致（仅证明内容指纹一致，不代表验收通过）");
    expect(output).toContain("原生工具已完成（不代表独立验收通过）；退出码 0");
    expect(output).toContain("证据：未附证据");
    expect(output).not.toContain("证据缺口：");
    expect(output).not.toContain("整体验收通过");
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      deliveryMethods.read,
      { taskId: "task-1" },
      taskDeliverySchema,
    );
  });

  it("exports the exact service report as JSON with one read-only request", async () => {
    await runDelivery(["task-1", "--json"]);
    expect(stdout).toEqual([`${JSON.stringify(report)}\n`]);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      deliveryMethods.read,
      { taskId: "task-1" },
      taskDeliverySchema,
    );
  });

  it("labels legacy evidence as unsupported without treating it as a match", async () => {
    if (!report.report) throw new Error("Missing delivery fixture report");
    const legacy: TaskDelivery = {
      ...report,
      report: {
        ...report.report,
        checks: [
          ...report.report.checks,
          {
            id: "performance",
            category: "performance",
            title: "性能检查",
            declaredStatus: "passed",
            details: "旧报告格式",
            evidence: [{ kind: "legacy", path: "/tmp/performance.json" }],
          },
        ],
      },
      evidence: [
        ...report.evidence,
        {
          checkId: "performance",
          index: 0,
          state: "unsupported",
          resolvedPath: null,
          exitCode: null,
        },
      ],
    };
    runtime.request.mockResolvedValue(legacy);
    await runDelivery();
    const output = stdout.join("");
    expect(output).toContain("性能 | 性能检查 | 报告声明：通过（passed）");
    expect(output).toContain("旧格式证据 /tmp/performance.json：不支持核对此类工具");
    expect(output).toContain("证据缺口：");
  });

  it("lists evidence gaps without changing declarations, querying again or modifying JSON", async () => {
    if (!report.report) throw new Error("Missing delivery fixture report");
    const unsupported: TaskDelivery = {
      ...report,
      report: {
        ...report.report,
        checks: report.report.checks
          .filter((check) => check.category !== "review")
          .map((check) => (check.id === "build" ? { ...check, evidence: [] } : check)),
      },
      evidence: [],
    };
    runtime.request.mockResolvedValue(unsupported);
    await runDelivery();
    const gaps = deliveryGaps(unsupported);
    expect(gaps).toHaveLength(2);
    expect(stdout.join("")).toContain("证据缺口：");
    for (const gap of gaps) expect(stdout.join("")).toContain(`  - ${gap.message}`);
    expect(stdout.join("")).toContain("报告声明：通过（passed）");
    expect(stdout.join("")).toContain("报告声明：失败（failed）");
    expect(stdout.join("")).toContain("报告声明：受阻（blocked）");
    expect(stdout.join("")).toContain("证据：未附证据");
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      deliveryMethods.read,
      { taskId: "task-1" },
      taskDeliverySchema,
    );
    stdout.length = 0;
    await runDelivery(["task-1", "--json"]);
    expect(stdout).toEqual([`${JSON.stringify(unsupported)}\n`]);
    expect(runtime.request).toHaveBeenCalledTimes(2);
  });

  it("strips terminal controls from report text while retaining line breaks and raw JSON values", async () => {
    if (!report.report) throw new Error("Missing delivery fixture report");
    const unsafe: TaskDelivery = {
      ...report,
      report: {
        ...report.report,
        summary: "摘要\u001b]52;c;c2VjcmV0\u0007\n第二行\r\u0008",
        checks: report.report.checks.map((check) => ({
          ...check,
          title: `\u001b[31m${check.title}\u001b[0m`,
          details: "说明\u009b\u001b[2J\u0000",
        })),
      },
    };
    runtime.request.mockResolvedValue(unsafe);
    await runDelivery();
    expect(stdout.join("")).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(stdout.join("")).toContain("摘要（报告声明）：摘要\n第二行");
    expect(stdout.join("")).toContain("构建检查");
    expect(stdout.join("")).not.toContain("c2VjcmV0");
    stdout.length = 0;
    await runDelivery(["task-1", "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(unsafe);
  });

  it.each([
    ["stale", "源码清单已过期，需重新验证"],
    ["unverifiable", "无法核对源码清单，不代表一致"],
  ] as const)(
    "keeps %s source state separate from a passed declaration",
    async (state, message) => {
      runtime.request.mockResolvedValue({
        ...report,
        source: { ...report.source, state },
      } satisfies TaskDelivery);
      await runDelivery();
      expect(stdout.join("")).toContain(message);
      expect(stdout.join("")).toContain("报告声明：通过（passed）");
      expect(stdout.join("")).not.toContain("所列文件一致");
    },
  );

  it.each([
    ["missing", null, "未生成交付报告"],
    ["invalid", "identity-mismatch", "报告任务标识不匹配"],
    ["invalid", "invalid-report", "报告格式无效"],
    ["invalid", "unreadable", "报告无法读取"],
    ["invalid", "outside-scope", "报告位置超出允许范围"],
    ["invalid", "too-large", "报告超过大小限制"],
  ] as const)(
    "shows unavailable records without fabricating checks: %s %s",
    async (availability, issue, message) => {
      runtime.request.mockResolvedValue({
        ...report,
        availability,
        issue,
        report: null,
        reportSha256: null,
        source: { state: "unverifiable", manifestFingerprint: null, files: [] },
        evidence: [],
        history: "not-requested",
      } satisfies TaskDelivery);
      await runDelivery();
      expect(stdout.join("")).toContain(message);
      expect(stdout.join("")).toContain("没有可展示的验收声明");
      expect(stdout.join("")).not.toContain("报告声明：通过");
      expect(stdout.join("")).not.toContain("证据缺口：");
    },
  );

  it("retains unavailable native history and failed evidence instead of trusting a passed declaration", async () => {
    runtime.request.mockResolvedValue({
      ...report,
      evidence: [
        { checkId: "build", index: 0, state: "changed", resolvedPath: null, exitCode: null },
        { checkId: "build", index: 1, state: "unavailable", resolvedPath: null, exitCode: null },
      ],
      history: "unavailable",
    } satisfies TaskDelivery);
    await runDelivery();
    expect(stdout.join("")).toContain("文件内容已变化，需重新验证");
    expect(stdout.join("")).toContain("证据无法读取或核对");
    expect(stdout.join("")).toContain("原生历史不可用");
    expect(stdout.join("")).toContain("报告声明：通过（passed）");
    expect(stdout.join("")).not.toContain("原生工具已完成");
  });

  it("does not interpret an unchecked evidence reference as success", async () => {
    runtime.request.mockResolvedValue({ ...report, evidence: [] } satisfies TaskDelivery);
    await runDelivery();
    expect(stdout.join("")).toContain("文件 evidence/build.txt：未核对");
    expect(stdout.join("")).toContain("原生工具 turn-1/tool-1：未核对");
  });

  it("does not retry or output a partial result after a failed read", async () => {
    runtime.request.mockRejectedValue(new Error("交付记录无法读取"));
    await expect(runDelivery()).rejects.toThrow("交付记录无法读取");
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(stdout).toEqual([]);
  });
});
