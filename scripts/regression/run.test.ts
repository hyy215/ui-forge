import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { prepareRun, summarizeRun } from "./run.mjs";

const temporary: string[] = [];
const env = { UI_FORGE_TEST_PYTHON: process.execPath };
const scenario = {
  id: "example",
  title: "Example",
  description: "Synthetic file mapping",
  vitest: ["packages/example.test.ts"],
  playwright: ["apps/example.spec.ts"],
};
const rules = [
  "package-lock.json",
  "packages/codex-client/instructions/design.md",
  "packages/codex-client/instructions/project.md",
  "packages/codex-client/.agents/skills/ui-forge-d2c/SKILL.md",
  "packages/codex-client/.agents/skills/ui-forge-d2c/scripts/compare_screenshots.py",
  "packages/codex-client/.agents/skills/ui-forge-d2c/scripts/slice_reference.py",
];

async function put(root: string, file: string, text: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ui-forge-regression-"));
  temporary.push(root);
  for (const file of [...rules, ...scenario.vitest, ...scenario.playwright])
    await put(root, file, "fixture");
  await put(root, "scripts/regression/catalog.json", JSON.stringify([scenario]));
  return { root, directory: join(root, ".ui-forge/result") };
}

function unit(root: string, startTime = Date.now()) {
  return {
    startTime,
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    testResults: [
      {
        name: join(root, scenario.vitest[0]!),
        status: "passed",
        startTime,
        endTime: startTime,
        assertionResults: [{ title: "works", fullName: "works", status: "passed" }],
      },
    ],
  };
}

function browser(root: string) {
  const startTime = new Date().toISOString();
  return {
    config: { rootDir: root, projects: [{ id: "desktop", name: "desktop" }] },
    stats: { startTime, duration: 1, expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    errors: [],
    suites: [
      {
        title: "file",
        file: scenario.playwright[0],
        specs: [
          {
            title: "works",
            file: scenario.playwright[0],
            line: 1,
            column: 1,
            tests: [
              {
                projectId: "desktop",
                projectName: "desktop",
                status: "expected",
                expectedStatus: "passed",
                results: [{ status: "passed", duration: 1, retry: 0, startTime, errors: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

it("records only explicit provenance and refuses to reuse a previous run directory", async () => {
  const { root, directory } = await fixture();
  await put(root, ".env", "SECRET=do-not-export");
  const manifest = await prepareRun(root, directory);
  expect(manifest).toMatchObject({
    version: 1,
    git: { commit: null, dirty: null },
    catalog: [scenario],
  });
  expect(manifest.fingerprints[rules[1]!]).toMatch(/^[a-f0-9]{64}$/);
  const before = await readFile(join(directory, "run.json"), "utf8");
  expect(before).not.toContain("do-not-export");
  await expect(prepareRun(root, directory)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(join(directory, "run.json"), "utf8")).toBe(before);
});

it.each([
  "../outside.test.ts",
  "/outside.test.ts",
  "packages/codexClient.live.test.ts",
  "missing.test.ts",
])("rejects invalid or missing catalog files: %s", async (file) => {
  const { root, directory } = await fixture();
  await put(
    root,
    "scripts/regression/catalog.json",
    JSON.stringify([{ ...scenario, vitest: [file] }]),
  );
  await expect(prepareRun(root, directory)).rejects.toThrow();
});

it("preserves absent reports as not-run and writes a readable summary without claiming passes", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  const report = await summarizeRun(root, directory, env);
  expect(report.reports.vitest.status).toBe("missing");
  expect(report.scenarios[0]).toMatchObject({ status: "not-run", counts: { passed: 0 } });
  expect(report.checks.every((check) => check.status === "not-run")).toBe(true);
  expect(await readFile(join(directory, "summary.md"), "utf8")).toContain(
    "不代表真实模型任务成功率",
  );
  await expect(summarizeRun(root, directory, env)).rejects.toMatchObject({ code: "EEXIST" });
});

it("links and hashes fresh raw output without converting missing browser tests to passes", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  await put(directory, "vitest.json", JSON.stringify(unit(root)));
  const report = await summarizeRun(root, directory, { ...env, UI_FORGE_CHECK_UNIT: "success" });
  expect(report.reports.vitest).toMatchObject({
    status: "available",
    artifact: "vitest.json",
    counts: { passed: 1 },
  });
  expect(report.reports.vitest.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.scenarios[0]).toMatchObject({
    status: "incomplete",
    missing: ["playwright:apps/example.spec.ts"],
  });
  expect(report.integrityErrors).toEqual([]);
});

it("summarizes both runners and points the Actions summary to downloadable artifacts", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  await put(directory, "vitest.json", JSON.stringify(unit(root)));
  await put(directory, "playwright.json", JSON.stringify(browser(root)));
  const actionsSummary = join(root, "actions-summary.md");
  const report = await summarizeRun(root, directory, {
    ...env,
    UI_FORGE_CHECK_UNIT: "success",
    UI_FORGE_CHECK_E2E: "success",
    GITHUB_ACTIONS: "true",
    GITHUB_STEP_SUMMARY: actionsSummary,
  });
  expect(report.scenarios[0]).toMatchObject({
    status: "passed",
    counts: { passed: 2 },
    missing: [],
  });
  expect(report.integrityErrors).toEqual([]);
  expect(await readFile(join(directory, "summary.md"), "utf8")).toContain("[vitest](vitest.json)");
  const actions = await readFile(actionsSummary, "utf8");
  expect(actions).toContain("Artifacts");
  expect(actions).not.toContain("](vitest.json)");
});

it.each(["invalid", "stale"])("marks %s reports as unusable", async (kind) => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  await put(directory, "vitest.json", kind === "invalid" ? "{" : JSON.stringify(unit(root, 1)));
  const report = await summarizeRun(root, directory, env);
  expect(report.reports.vitest.status).toBe(kind);
  expect(report.scenarios[0].status).not.toBe("passed");
  expect(report.integrityErrors).toContain(`vitest: ${kind}`);
});

it("rejects a successful CI step that has no report", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  const report = await summarizeRun(root, directory, { ...env, UI_FORGE_CHECK_UNIT: "success" });
  expect(report.integrityErrors).toEqual(["vitest: CI 步骤通过但缺少有效的成功报告"]);
});

it("records failed and cancelled steps independently of individual passing assertions", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  await put(directory, "vitest.json", JSON.stringify(unit(root)));
  const report = await summarizeRun(root, directory, {
    ...env,
    UI_FORGE_CHECK_UNIT: "failure",
    UI_FORGE_CHECK_E2E: "cancelled",
  });
  expect(report.checks).toContainEqual({ name: "unit", outcome: "failure", status: "failed" });
  expect(report.checks).toContainEqual({ name: "e2e", outcome: "cancelled", status: "not-run" });
  expect(report.scenarios[0].status).not.toBe("passed");
});

it("detects changed rules and keeps the original rule fingerprint", async () => {
  const { root, directory } = await fixture();
  const manifest = await prepareRun(root, directory);
  await put(root, rules[1]!, "changed rules");
  const report = await summarizeRun(root, directory, env);
  expect(report.run.fingerprints).toEqual(manifest.fingerprints);
  expect(report.integrityErrors).toContain(
    "运行期间规则、Skill、清单或锁文件发生变化，不能当作同一基线",
  );
});

it.each(["cancelled", "skipped"])(
  "does not promote already-written results when the CI step is %s",
  async (outcome) => {
    const { root, directory } = await fixture();
    await prepareRun(root, directory);
    await put(directory, "vitest.json", JSON.stringify(unit(root)));
    await put(directory, "playwright.json", JSON.stringify(browser(root)));
    const report = await summarizeRun(root, directory, {
      ...env,
      UI_FORGE_CHECK_UNIT: "success",
      UI_FORGE_CHECK_E2E: outcome,
      GITHUB_ACTIONS: "true",
    });
    expect(report.reports.playwright.counts.passed).toBe(1);
    expect(report.reports.playwright.issue).toContain("CI 测试步骤未完成");
    expect(report.scenarios[0].status).toBe("incomplete");
  },
);

it("keeps local file results partial when the report cannot prove an unfiltered command", async () => {
  const { root, directory } = await fixture();
  await prepareRun(root, directory);
  await put(directory, "vitest.json", JSON.stringify(unit(root)));
  await put(directory, "playwright.json", JSON.stringify(browser(root)));
  const report = await summarizeRun(root, directory, env);
  expect(report.executionScope).toBe("local-reported-tests-only");
  expect(report.reports.vitest.counts.passed).toBe(1);
  expect(report.scenarios[0]).toMatchObject({ status: "incomplete", counts: { passed: 2 } });
});
