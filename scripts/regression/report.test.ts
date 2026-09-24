import { describe, expect, it } from "vitest";
import { parsePlaywrightReport, parseVitestReport, summarizeScenarios } from "./report.mjs";

const startedAt = "2026-09-23T00:00:00.000Z";
const time = Date.parse(startedAt);
const options = { root: "/repo", startedAt };
const zero = { passed: 0, failed: 0, skipped: 0, notRun: 0 };
type Assertion = "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled";

function vitest(statuses: Assertion[] = ["passed"]) {
  const failed = statuses.filter((status) => status === "failed").length;
  return {
    startTime: time + 10,
    success: failed === 0,
    numTotalTestSuites: 1,
    numPassedTestSuites: failed ? 0 : 1,
    numFailedTestSuites: failed ? 1 : 0,
    numPendingTestSuites: 0,
    numTotalTests: statuses.length,
    numPassedTests: statuses.filter((status) => status === "passed").length,
    numFailedTests: failed,
    numPendingTests: statuses.filter((status) => ["skipped", "pending"].includes(status)).length,
    numTodoTests: statuses.filter((status) => status === "todo").length,
    testResults: [
      {
        name: "/repo/packages/example.test.ts",
        status: failed ? "failed" : "passed",
        startTime: time + 20,
        endTime: time + 30,
        message: "",
        assertionResults: statuses.map((status) => ({
          status,
          title: "test",
          fullName: "test",
          ancestorTitles: [],
          failureMessages: [],
        })),
      },
    ],
  };
}

type PwStatus = "passed" | "failed" | "skipped" | "timedOut" | "interrupted";
function pwTest(
  status: "expected" | "unexpected" | "flaky" | "skipped" = "expected",
  attempts: PwStatus[] = ["passed"],
  expectedStatus: PwStatus = "passed",
  project = "desktop",
) {
  return {
    projectName: project,
    projectId: project,
    expectedStatus,
    status,
    results: attempts.map((status, retry) => ({
      retry,
      status,
      duration: 10,
      startTime: new Date(time + 20 + retry * 10).toISOString(),
      errors: [],
    })),
  };
}
function playwright(tests = [pwTest()]) {
  return {
    config: {
      rootDir: "/repo/apps/web/e2e",
      projects: [...new Set(tests.map((test) => test.projectName))].map((name) => ({
        id: name,
        name,
      })),
    },
    errors: [] as { message: string }[],
    stats: {
      startTime: new Date(time + 10).toISOString(),
      duration: 100,
      expected: tests.filter((test) => test.status === "expected").length,
      unexpected: tests.filter((test) => test.status === "unexpected").length,
      flaky: tests.filter((test) => test.status === "flaky").length,
      skipped: tests.filter((test) => test.status === "skipped").length,
    },
    suites: [
      {
        title: "example.spec.ts",
        file: "example.spec.ts",
        specs: [{ file: "example.spec.ts", title: "test", line: 1, column: 1, tests }],
      },
    ],
  };
}

describe("Vitest JSON reports", () => {
  it("uses validated assertion results and repository-relative paths", () => {
    expect(parseVitestReport(vitest(), options)).toMatchObject({
      status: "available",
      files: [
        { file: "packages/example.test.ts", status: "passed", counts: { ...zero, passed: 1 } },
      ],
      counts: { ...zero, passed: 1 },
      runnerFailed: false,
      issue: null,
    });
  });

  it("retains failed assertions and file loading failures with zero tests", () => {
    expect(parseVitestReport(vitest(["passed", "failed"]), options)).toMatchObject({
      files: [{ status: "failed" }],
      counts: { ...zero, passed: 1, failed: 1 },
      runnerFailed: true,
    });
    const report = vitest([]);
    report.success = false;
    report.testResults[0]!.status = "failed";
    expect(parseVitestReport(report, options)).toMatchObject({
      status: "available",
      files: [{ status: "failed", counts: zero }],
      runnerFailed: true,
    });
  });

  it("counts pending and todo as skipped, but an empty file is not-run", () => {
    expect(
      parseVitestReport(vitest(["skipped", "pending", "todo", "disabled"]), options),
    ).toMatchObject({
      files: [{ status: "skipped" }],
      counts: { ...zero, skipped: 4 },
    });
    expect(parseVitestReport(vitest(["passed", "skipped"]), options).files[0]?.status).toBe(
      "incomplete",
    );
    expect(parseVitestReport(vitest([]), options).files[0]?.status).toBe("not-run");
    const report = vitest([]);
    report.testResults = [];
    expect(parseVitestReport(report, options)).toMatchObject({
      status: "available",
      files: [],
      counts: zero,
    });
  });

  it("does not hide runner failures behind passing assertions", () => {
    const report = vitest();
    report.success = false;
    expect(parseVitestReport(report, options)).toMatchObject({
      runnerFailed: true,
      files: [{ status: "incomplete" }],
    });
  });

  it("validates statuses and timestamps without mutating reporter input", () => {
    const report = vitest();
    const before = structuredClone(report);
    parseVitestReport(report, options);
    expect(report).toEqual(before);
    expect(parseVitestReport(report, { ...options, startedAt: "yesterday" }).status).toBe(
      "invalid",
    );
    expect(parseVitestReport(report, { ...options, root: "repo" }).status).toBe("invalid");
    const unknown = {
      ...report,
      testResults: [{ ...report.testResults[0], assertionResults: [{ status: "queued" }] }],
    };
    expect(parseVitestReport(unknown, options).status).toBe("invalid");
  });

  it.each([null, [], {}, { ...vitest(), testResults: null }, { ...vitest(), numTotalTests: 100 }])(
    "rejects malformed or inconsistent report data",
    (raw) => {
      expect(parseVitestReport(raw, options)).toMatchObject({
        status: "invalid",
        files: [],
        counts: zero,
      });
    },
  );

  it("discards stale report and file data rather than trusting prior passes", () => {
    expect(parseVitestReport({ ...vitest(), startTime: time - 1 }, options).status).toBe("stale");
    const report = vitest();
    report.testResults[0]!.startTime = time - 1;
    expect(parseVitestReport(report, options)).toMatchObject({
      status: "stale",
      files: [],
      counts: zero,
    });
  });

  it.each(["/elsewhere/test.ts", "../../outside.test.ts", "", "C:\\outside\\test.ts"])(
    "rejects invalid or out-of-repository paths: %s",
    (name) => {
      const report = vitest();
      report.testResults[0]!.name = name;
      expect(parseVitestReport(report, options).status).toBe("invalid");
    },
  );
});

describe("Playwright JSON reports", () => {
  it("resolves rootDir paths and counts each project test once", () => {
    const report = playwright([pwTest(), pwTest("expected", ["passed"], "passed", "narrow")]);
    expect(parsePlaywrightReport(report, options)).toMatchObject({
      status: "available",
      files: [{ file: "apps/web/e2e/example.spec.ts", status: "passed" }],
      counts: { ...zero, passed: 2 },
      runnerFailed: false,
      projects: ["desktop", "narrow"],
    });
  });

  it("counts a flaky retry as one failure and explains the conservative outcome", () => {
    const result = parsePlaywrightReport(
      playwright([pwTest("flaky", ["failed", "passed"])]),
      options,
    );
    expect(result).toMatchObject({
      files: [{ status: "failed" }],
      counts: { ...zero, failed: 1 },
      runnerFailed: true,
    });
    expect(result.issue).toContain("flaky");
  });

  it("retains failure and distinguishes explicit skip from tests that never ran", () => {
    const tests = [
      pwTest("unexpected", ["failed", "failed"]),
      pwTest("skipped", ["skipped"], "skipped"),
      pwTest("skipped", ["skipped"]),
      pwTest("skipped", []),
    ];
    expect(parsePlaywrightReport(playwright(tests), options)).toMatchObject({
      files: [{ status: "failed" }],
      counts: { ...zero, failed: 1, skipped: 1, notRun: 2 },
    });
    expect(
      parsePlaywrightReport(playwright([pwTest("skipped", ["skipped"], "skipped")]), options)
        .files[0]?.status,
    ).toBe("skipped");
    expect(
      parsePlaywrightReport(playwright([pwTest("skipped", [])]), options).files[0]?.status,
    ).toBe("not-run");
  });

  it("handles nested suites without counting containers or retry attempts", () => {
    const report = playwright();
    const original = report.suites[0]!;
    const raw = { ...report, suites: [{ ...original, specs: [], suites: [original] }] };
    expect(parsePlaywrightReport(raw, options).counts).toEqual({ ...zero, passed: 1 });
  });

  it("marks missing configured projects incomplete without inventing test counts", () => {
    const report = playwright();
    report.config.projects.push({ id: "narrow", name: "narrow" });
    expect(parsePlaywrightReport(report, options)).toMatchObject({
      status: "available",
      files: [{ status: "incomplete" }],
      counts: { ...zero, passed: 1 },
      projects: ["desktop"],
    });
  });

  it("never promotes errors or interruption into successful completion", () => {
    const report = playwright();
    report.errors.push({ message: "global teardown failed" });
    expect(parsePlaywrightReport(report, options)).toMatchObject({
      runnerFailed: true,
      files: [{ status: "incomplete" }],
    });
    expect(
      parsePlaywrightReport(playwright([pwTest("skipped", ["interrupted"])]), options),
    ).toMatchObject({
      runnerFailed: true,
      counts: { ...zero, notRun: 1 },
    });
  });

  it("keeps empty reports empty and discards stale runs", () => {
    const report = playwright([]);
    report.suites = [];
    expect(parsePlaywrightReport(report, options)).toMatchObject({
      status: "available",
      files: [],
      counts: zero,
    });
    report.stats.startTime = new Date(time - 1).toISOString();
    expect(parsePlaywrightReport(report, options)).toMatchObject({
      status: "stale",
      files: [],
      counts: zero,
    });
    const attempt = pwTest();
    attempt.results[0]!.startTime = new Date(time - 1).toISOString();
    expect(parsePlaywrightReport(playwright([attempt]), options)).toMatchObject({
      status: "stale",
      files: [],
      counts: zero,
    });
  });

  it.each([
    null,
    {},
    { ...playwright(), errors: null },
    { ...playwright(), config: { rootDir: "/outside" } },
  ])("rejects malformed report data", (raw) => {
    expect(parsePlaywrightReport(raw, options).status).toBe("invalid");
  });

  it("rejects inconsistent totals, duplicate retries and escaping paths", () => {
    const totals = playwright();
    totals.stats.expected = 5;
    expect(parsePlaywrightReport(totals, options).status).toBe("invalid");
    const test = pwTest("flaky", ["failed", "passed"]);
    test.results[1]!.retry = 0;
    expect(parsePlaywrightReport(playwright([test]), options).status).toBe("invalid");
    const path = playwright();
    path.suites[0]!.specs[0]!.file = "../../../../outside.ts";
    expect(parsePlaywrightReport(path, options).status).toBe("invalid");
  });

  it("rejects passing outcomes that conceal attempt errors or failed retries", () => {
    const report = playwright();
    const attempt = report.suites[0]!.specs[0]!.tests[0]!.results[0]!;
    const corrupted = {
      ...report,
      suites: [
        {
          ...report.suites[0],
          specs: [
            {
              ...report.suites[0]!.specs[0],
              tests: [{ ...pwTest(), results: [{ ...attempt, errors: [{ message: "error" }] }] }],
            },
          ],
        },
      ],
    };
    expect(parsePlaywrightReport(corrupted, options).status).toBe("invalid");
    expect(
      parsePlaywrightReport(playwright([pwTest("expected", ["failed", "passed"])]), options).status,
    ).toBe("invalid");
  });
});

describe("scenario summaries", () => {
  const scenario = {
    id: "example",
    title: "Example",
    description: "Deterministic regression checks",
    vitest: ["packages/example.test.ts"],
    playwright: ["apps/web/e2e/example.spec.ts"],
  };
  const reports = () => ({
    vitest: parseVitestReport(vitest(), options),
    playwright: parsePlaywrightReport(playwright(), options),
  });

  it("summarizes files across runners without claiming coverage outside the catalog", () => {
    expect(summarizeScenarios([scenario], reports())).toEqual([
      {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        status: "passed",
        counts: { ...zero, passed: 2 },
        missing: [],
      },
    ]);
  });

  it("marks missing and stale files without inventing unrun test counts", () => {
    const source = reports();
    source.playwright = parsePlaywrightReport(null, options);
    expect(summarizeScenarios([scenario], source)[0]).toMatchObject({
      status: "incomplete",
      counts: { ...zero, passed: 1 },
      missing: ["playwright:apps/web/e2e/example.spec.ts"],
    });
    source.vitest = parseVitestReport({ ...vitest(), startTime: time - 1 }, options);
    expect(summarizeScenarios([scenario], source)[0]).toMatchObject({
      status: "not-run",
      counts: zero,
    });
  });

  it("prioritizes failure, preserves all-skipped and rejects partial-skip passes", () => {
    const source = reports();
    source.vitest = parseVitestReport(vitest(["failed"]), options);
    expect(summarizeScenarios([scenario], source)[0]?.status).toBe("failed");
    source.vitest = parseVitestReport(vitest(["skipped"]), options);
    expect(summarizeScenarios([scenario], source)[0]?.status).toBe("incomplete");
    source.playwright = parsePlaywrightReport(
      playwright([pwTest("skipped", ["skipped"], "skipped")]),
      options,
    );
    expect(summarizeScenarios([scenario], source)[0]?.status).toBe("skipped");
    source.vitest = parseVitestReport(vitest([]), options);
    expect(summarizeScenarios([scenario], source)[0]?.status).toBe("incomplete");
  });

  it("preserves zero-assertion file failures in scenario outcomes", () => {
    const report = vitest([]);
    report.testResults[0]!.status = "failed";
    report.success = false;
    const source = reports();
    source.vitest = parseVitestReport(report, options);
    expect(summarizeScenarios([scenario], source)[0]).toMatchObject({
      status: "failed",
      counts: { ...zero, passed: 1 },
    });
  });

  it("allows shared files across scenarios but ignores duplicates within one scenario", () => {
    const first = { ...scenario, vitest: [...scenario.vitest, ...scenario.vitest] };
    const results = summarizeScenarios([first, { ...scenario, id: "second" }], reports());
    expect(results.map((result) => result.counts)).toEqual([
      { ...zero, passed: 2 },
      { ...zero, passed: 2 },
    ]);
  });
});
