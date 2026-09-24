/** Records regression provenance and summarizes existing test reports without running tests or models. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parsePlaywrightReport, parseVitestReport, summarizeScenarios } from "./report.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const fingerprintFiles = [
  "package-lock.json",
  "scripts/regression/catalog.json",
  "packages/codex-client/instructions/design.md",
  "packages/codex-client/instructions/project.md",
  "packages/codex-client/.agents/skills/ui-forge-d2c/SKILL.md",
  "packages/codex-client/.agents/skills/ui-forge-d2c/scripts/compare_screenshots.py",
  "packages/codex-client/.agents/skills/ui-forge-d2c/scripts/slice_reference.py",
];
const checkNames = [
  "dependencies",
  "python",
  "images",
  "typecheck",
  "unit",
  "build",
  "browser",
  "package",
  "e2e",
];
const labels = {
  passed: "通过",
  failed: "失败",
  skipped: "跳过",
  "not-run": "未执行",
  incomplete: "不完整",
};
const emptyCounts = () => ({ passed: 0, failed: 0, skipped: 0, notRun: 0 });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function command(root, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error("Empty regression catalog");
  const ids = new Set();
  for (const item of catalog) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-z0-9-]+$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== "string" ||
      typeof item.description !== "string"
    ) {
      throw new Error("Invalid regression scenario");
    }
    ids.add(item.id);
    for (const runner of ["vitest", "playwright"]) {
      if (!Array.isArray(item[runner])) throw new Error("Invalid scenario file list");
      for (const file of item[runner]) {
        if (
          typeof file !== "string" ||
          isAbsolute(file) ||
          file.split("/").some((part) => part === ".." || part === "." || !part) ||
          /[\\\x00-\x1f\x7f]/.test(file) ||
          file.includes(".live.") ||
          !file.endsWith(runner === "vitest" ? ".test.ts" : ".spec.ts")
        ) {
          throw new Error("Invalid or live scenario file");
        }
      }
    }
    if (item.vitest.length + item.playwright.length === 0) throw new Error("Empty scenario");
  }
  return catalog;
}

async function fingerprints(root) {
  const result = {};
  for (const file of fingerprintFiles) {
    result[file] = digest(await readFile(join(root, file)));
  }
  return result;
}

/** Initializes a fresh evidence directory; existing directories and reports are never overwritten. */
export async function prepareRun(root, directory) {
  const catalog = validateCatalog(
    JSON.parse(await readFile(join(root, "scripts/regression/catalog.json"), "utf8")),
  );
  for (const file of new Set(catalog.flatMap((item) => [...item.vitest, ...item.playwright]))) {
    await readFile(join(root, file));
  }
  const status = command(root, "git", ["status", "--porcelain", "--untracked-files=normal"]);
  const manifest = {
    version: 1,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    git: {
      commit: command(root, "git", ["rev-parse", "HEAD"]),
      dirty: status === null ? null : status.length > 0,
    },
    fingerprints: await fingerprints(root),
    catalog,
  };
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  await writeFile(join(directory, "run.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  return manifest;
}

async function environment(root, env) {
  const packages = {};
  for (const name of ["vitest", "@playwright/test"]) {
    try {
      const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json")));
      packages[name] = typeof metadata.version === "string" ? metadata.version : null;
    } catch {
      packages[name] = null;
    }
  }
  const python = command(root, env.UI_FORGE_TEST_PYTHON || "python3", [
    "-c",
    "import json, platform, PIL; print(json.dumps({'python': platform.python_version(), 'pillow': PIL.__version__}))",
  ]);
  let images = null;
  try {
    const parsed = JSON.parse(python);
    if (typeof parsed?.python === "string" && typeof parsed?.pillow === "string") {
      images = { python: parsed.python, pillow: parsed.pillow };
    }
  } catch {
    // Missing optional dependencies remain unknown, not a fabricated version or a test failure.
  }
  return {
    observedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    packages,
    images,
  };
}

async function readReport(directory, name, parse, options) {
  let bytes;
  try {
    bytes = await readFile(join(directory, name));
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error("Report exceeds 32 MiB");
    return {
      ...parse(JSON.parse(bytes.toString("utf8")), options),
      artifact: name,
      sha256: digest(bytes),
    };
  } catch (error) {
    const missing = error.code === "ENOENT";
    return {
      status: missing ? "missing" : "invalid",
      files: [],
      counts: emptyCounts(),
      runnerFailed: false,
      issue: missing ? "本次没有生成报告" : "报告无法读取或解析",
      artifact: bytes ? name : null,
      sha256: bytes ? digest(bytes) : null,
    };
  }
}

function markdown(summary, localLinks = true) {
  const safe = (value) => String(value ?? "未知").replace(/[\r\n|`<>]/g, " ");
  const lines = [
    "# ui-forge 自动回归汇总",
    "",
    `- 批次：${summary.run.runId}`,
    `- 代码：${safe(summary.run.git.commit)}；未提交修改：${safe(summary.run.git.dirty)}`,
    `- Node：${safe(summary.environment.node)}；系统：${safe(summary.environment.platform)}/${safe(summary.environment.arch)}`,
    "- 范围：测试替身、合成数据及本地自动化，不代表真实模型任务成功率或设计验收通过。",
    "- 场景按测试文件关联，文件可能重复关联，不能把场景计数相加。",
    "- 计数只表示报告中已记录的用例；缺报告时的 0 不表示已验证无失败。",
    summary.executionScope === "ci-workflow"
      ? "- 执行范围：CI 配置中的未筛选测试命令；场景通过仍只表示清单关联的自动化检查通过。"
      : "- 执行范围：本地报告包含的用例，无法排除筛选；即使已观察用例都通过，场景也保留为不完整。",
    "- 未提交修改仅记录 dirty，不归档源码差异，不能仅凭 commit 完整重建脏工作区。",
    "",
    "## CI 步骤",
    "",
    "| 步骤 | 结果 |",
    "| --- | --- |",
    ...summary.checks.map((check) => `| ${check.name} | ${labels[check.status]} |`),
    "",
    "## 测试报告",
    "",
    "| 来源 | 报告状态 | 通过 | 失败 | 跳过 | 未执行 |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, report] of Object.entries(summary.reports)) {
    const c = report.counts;
    const source = report.artifact && localLinks ? `[${name}](${report.artifact})` : name;
    lines.push(
      `| ${source} | ${safe(report.status)} | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.notRun} |`,
    );
  }
  for (const [name, report] of Object.entries(summary.reports)) {
    if (report.issue) lines.push(`\n${name}：${safe(report.issue)}`);
  }
  lines.push(
    "",
    "## 功能场景",
    "",
    "| 场景 | 结果 | 通过 | 失败 | 跳过 | 未执行 | 缺少文件数 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...summary.scenarios.map(
      ({ title, status, counts: c, missing }) =>
        `| ${safe(title)} | ${labels[status]} | ${c.passed} | ${c.failed} | ${c.skipped} | ${c.notRun} | ${missing.length} |`,
    ),
    "",
    localLinks
      ? "文件映射、缺项、规则/Skill 指纹和环境信息见 [summary.json](summary.json) 与 [run.json](run.json)。"
      : "完整 JSON、Markdown 和原始报告见本次运行的 regression-evidence 附件；在 Actions 运行页的 Artifacts 区域下载。",
    "原始 JSON 可能包含测试名称、路径和失败输出，公开转发前需检查。",
  );
  if (summary.integrityErrors.length)
    lines.push("", "## 归档问题", ...summary.integrityErrors.map((item) => `- ${safe(item)}`));
  return lines.join("\n") + "\n";
}

/** Reads only this run's reports and writes summaries; missing or stale evidence never becomes a pass. */
export async function summarizeRun(root, directory, env = {}) {
  const run = JSON.parse(await readFile(join(directory, "run.json"), "utf8"));
  if (
    run.version !== 1 ||
    !Number.isFinite(Date.parse(run.startedAt)) ||
    typeof run.runId !== "string"
  ) {
    throw new Error("Invalid regression run manifest");
  }
  validateCatalog(run.catalog);
  const options = { root, startedAt: run.startedAt };
  const reports = {
    vitest: await readReport(directory, "vitest.json", parseVitestReport, options),
    playwright: await readReport(directory, "playwright.json", parsePlaywrightReport, options),
  };
  const checks = checkNames.map((name) => {
    const outcome = env[`UI_FORGE_CHECK_${name.toUpperCase()}`];
    return {
      name,
      outcome: ["success", "failure", "skipped", "cancelled"].includes(outcome) ? outcome : null,
      status: outcome === "success" ? "passed" : outcome === "failure" ? "failed" : "not-run",
    };
  });
  const integrityErrors = [];
  for (const [name, report] of Object.entries(reports)) {
    const check = checks.find((item) => item.name === (name === "vitest" ? "unit" : "e2e"));
    if (check.status === "failed" && report.status === "available") {
      report.runnerFailed = true;
      report.issue = [report.issue, "CI 测试步骤失败，单项结果不代表该步骤通过"]
        .filter(Boolean)
        .join("; ");
      for (const file of report.files) if (file.status === "passed") file.status = "incomplete";
    }
    if (["cancelled", "skipped"].includes(check.outcome) && report.status === "available") {
      report.issue = [report.issue, "CI 测试步骤未完成，已有结果仅作为部分记录"]
        .filter(Boolean)
        .join("; ");
      for (const file of report.files) if (file.status === "passed") file.status = "incomplete";
    }
    if (["invalid", "stale"].includes(report.status))
      integrityErrors.push(`${name}: ${report.status}`);
    if (
      check.status === "passed" &&
      (report.status !== "available" ||
        report.runnerFailed ||
        !report.files.length ||
        report.files.some((file) => file.status === "failed"))
    ) {
      integrityErrors.push(`${name}: CI 步骤通过但缺少有效的成功报告`);
    }
  }
  const current = await fingerprints(root);
  if (JSON.stringify(current) !== JSON.stringify(run.fingerprints)) {
    integrityErrors.push("运行期间规则、Skill、清单或锁文件发生变化，不能当作同一基线");
  }
  const scenarios = summarizeScenarios(run.catalog, reports);
  const executionScope =
    env.GITHUB_ACTIONS === "true" ? "ci-workflow" : "local-reported-tests-only";
  for (const scenario of scenarios) {
    const mapping = run.catalog.find((item) => item.id === scenario.id);
    const confirmedScope =
      executionScope === "ci-workflow" &&
      (!mapping.vitest.length ||
        checks.find((check) => check.name === "unit").outcome === "success") &&
      (!mapping.playwright.length ||
        checks.find((check) => check.name === "e2e").outcome === "success");
    if (scenario.status === "passed" && (integrityErrors.length || !confirmedScope))
      scenario.status = "incomplete";
  }
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: "automated-regression-not-model-evaluation",
    executionScope,
    run,
    environment: await environment(root, env),
    checks,
    reports,
    scenarios,
    integrityErrors,
  };
  const text = markdown(summary);
  await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(join(directory, "summary.md"), text, { flag: "wx" });
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown(summary, false));
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      options: { output: { type: "string" } },
      allowPositionals: true,
    });
    if (
      !values.output ||
      positionals.length !== 1 ||
      !["prepare", "summarize"].includes(positionals[0])
    ) {
      throw new Error(
        "Usage: node scripts/regression/run.mjs <prepare|summarize> --output <fresh-run-directory>",
      );
    }
    const directory = resolve(values.output);
    if (positionals[0] === "prepare") await prepareRun(repositoryRoot, directory);
    else {
      const summary = await summarizeRun(repositoryRoot, directory, process.env);
      if (summary.integrityErrors.length) process.exitCode = 1;
    }
    console.log(`Regression evidence: ${directory}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Regression reporting failed");
    process.exitCode = 1;
  }
}
