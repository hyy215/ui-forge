/** Parse current-run test reports and summarize catalog scenarios without filesystem or runner access. */
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

/** @typedef {{passed: number, failed: number, skipped: number, notRun: number}} Counts */
/** @typedef {'passed'|'failed'|'skipped'|'not-run'|'incomplete'} ResultStatus */
/** @typedef {{file: string, status: ResultStatus, counts: Counts}} FileResult */
/** @typedef {{status: 'available'|'invalid'|'stale', files: FileResult[], counts: Counts, issue: string|null, runnerFailed: boolean}} ParsedReport */

const emptyCounts = () => ({ passed: 0, failed: 0, skipped: 0, notRun: 0 });
const record = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a report object.");
  return value;
};
const array = (value) => {
  if (!Array.isArray(value)) throw new Error("Expected a report array.");
  return value;
};
const number = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid report number.");
  return value;
};
const count = (value) => {
  if (!Number.isSafeInteger(number(value))) throw new Error("Invalid report count.");
  return value;
};
const timestamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid report timestamp.");
  return Date.parse(value);
};
const add = (target, source) => {
  for (const key of ["passed", "failed", "skipped", "notRun"]) target[key] += source[key];
};
const total = (counts) => counts.passed + counts.failed + counts.skipped + counts.notRun;

function outcome(counts) {
  if (counts.failed) return "failed";
  if (counts.passed) return counts.skipped || counts.notRun ? "incomplete" : "passed";
  if (counts.skipped) return counts.notRun ? "incomplete" : "skipped";
  return "not-run";
}

function filePath(value, root, base = root) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    (win32.isAbsolute(value) && !isAbsolute(value))
  )
    throw new Error("Invalid report file path.");
  const result = relative(root, resolve(base, value));
  if (!result || isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`))
    throw new Error("Report file is outside the repository.");
  return result.split(sep).join("/");
}

function optionsContext(options) {
  const value = record(options);
  if (typeof value.root !== "string" || !isAbsolute(value.root))
    throw new Error("Repository root must be absolute.");
  return { root: resolve(value.root), startedAt: timestamp(value.startedAt) };
}

function unavailable(status, issue) {
  return { status, files: [], counts: emptyCounts(), issue, runnerFailed: false };
}

function finish(files, runnerFailed, issue = null, globalError = false) {
  const values = [...files.values()].sort((left, right) => left.file.localeCompare(right.file));
  const counts = emptyCounts();
  for (const file of values) {
    add(counts, file.counts);
    if (!["failed", "incomplete"].includes(file.status)) file.status = outcome(file.counts);
    if (globalError && file.status !== "failed") file.status = "incomplete";
  }
  return { status: "available", files: values, counts, issue, runnerFailed };
}

function getFile(files, file) {
  let result = files.get(file);
  if (!result) {
    result = { file, status: "not-run", counts: emptyCounts() };
    files.set(file, result);
  }
  return result;
}

/** Parse Vitest's JSON reporter; rejected or older reports never contribute successful results. */
export function parseVitestReport(raw, options) {
  try {
    const { root, startedAt } = optionsContext(options);
    const report = record(raw);
    if (typeof report.success !== "boolean") throw new Error("Missing Vitest run status.");
    if (number(report.startTime) < startedAt)
      return unavailable("stale", "Vitest report predates this run.");
    for (const key of [
      "numTotalTests",
      "numPassedTests",
      "numFailedTests",
      "numPendingTests",
      "numTodoTests",
      "numTotalTestSuites",
      "numPassedTestSuites",
      "numFailedTestSuites",
      "numPendingTestSuites",
    ])
      count(report[key]);
    const files = new Map();
    for (const value of array(report.testResults)) {
      const entry = record(value);
      if (!["passed", "failed"].includes(entry.status))
        throw new Error("Invalid Vitest file status.");
      const start = number(entry.startTime);
      if (number(entry.endTime) < start) throw new Error("Invalid Vitest file duration.");
      if (start < startedAt) return unavailable("stale", "Vitest file predates this run.");
      const file = getFile(files, filePath(entry.name, root));
      if (entry.status === "failed") file.status = "failed";
      for (const value of array(entry.assertionResults)) {
        const assertion = record(value);
        if (assertion.status === "passed") file.counts.passed += 1;
        else if (assertion.status === "failed") file.counts.failed += 1;
        else if (["skipped", "pending", "todo", "disabled"].includes(assertion.status))
          file.counts.skipped += 1;
        else throw new Error("Invalid Vitest assertion status.");
      }
    }
    const failedFile = [...files.values()].some(
      (file) => file.status === "failed" || file.counts.failed > 0,
    );
    const runnerFailed = !report.success || failedFile || report.numFailedTestSuites > 0;
    const globalError = runnerFailed && !failedFile;
    const result = finish(
      files,
      runnerFailed,
      globalError ? "Vitest did not complete successfully; file results are incomplete." : null,
      globalError,
    );
    if (
      report.numTotalTests !== total(result.counts) ||
      report.numPassedTests !== result.counts.passed ||
      report.numFailedTests !== result.counts.failed
    )
      throw new Error("Vitest test totals do not match file results.");
    return result;
  } catch (error) {
    return unavailable(
      "invalid",
      error instanceof Error ? error.message : "Invalid Vitest report.",
    );
  }
}

/** Parse Playwright project outcomes once per test, counting flaky results as failures, not retry passes. */
export function parsePlaywrightReport(raw, options) {
  try {
    const { root, startedAt } = optionsContext(options);
    const report = record(raw);
    const stats = record(report.stats);
    if (timestamp(stats.startTime) < startedAt)
      return unavailable("stale", "Playwright report predates this run.");
    number(stats.duration);
    for (const key of ["expected", "unexpected", "skipped", "flaky"]) count(stats[key]);
    const config = record(report.config);
    if (typeof config.rootDir !== "string" || !isAbsolute(config.rootDir))
      throw new Error("Invalid Playwright root directory.");
    const base = resolve(config.rootDir);
    if (base !== root) filePath(base, root);
    const configuredProjects = new Map();
    for (const value of array(config.projects)) {
      const project = record(value);
      if (
        typeof project.id !== "string" ||
        typeof project.name !== "string" ||
        configuredProjects.has(project.id)
      )
        throw new Error("Invalid Playwright project configuration.");
      configuredProjects.set(project.id, project.name);
    }
    const files = new Map();
    const specs = new Map();
    const projects = new Set();
    const outcomes = { expected: 0, unexpected: 0, skipped: 0, flaky: 0 };
    const statuses = ["passed", "failed", "timedOut", "skipped", "interrupted"];
    let interrupted = false;
    let staleAttempt = false;
    const visit = (values, ancestors = []) => {
      for (const value of array(values)) {
        const suite = record(value);
        if (typeof suite.title !== "string") throw new Error("Invalid Playwright suite title.");
        getFile(files, filePath(suite.file, root, base));
        for (const value of array(suite.specs)) {
          const spec = record(value);
          const file = getFile(files, filePath(spec.file, root, base));
          if (typeof spec.title !== "string") throw new Error("Invalid Playwright spec title.");
          count(spec.line);
          count(spec.column);
          const key = JSON.stringify([
            file.file,
            ...ancestors,
            suite.title,
            spec.title,
            spec.line,
            spec.column,
          ]);
          let coverage = specs.get(key);
          if (!coverage) {
            coverage = { file, projects: new Set() };
            specs.set(key, coverage);
          }
          for (const value of array(spec.tests)) {
            const test = record(value);
            if (
              typeof test.projectName !== "string" ||
              typeof test.projectId !== "string" ||
              configuredProjects.get(test.projectId) !== test.projectName ||
              !statuses.includes(test.expectedStatus) ||
              !Object.hasOwn(outcomes, test.status)
            )
              throw new Error("Invalid Playwright test identity or outcome.");
            coverage.projects.add(test.projectId);
            projects.add(test.projectName);
            outcomes[test.status] += 1;
            const results = array(test.results);
            const retries = new Set();
            let unexpectedAttempt = false;
            for (const value of results) {
              const result = record(value);
              if (!statuses.includes(result.status))
                throw new Error("Invalid Playwright attempt status.");
              const retry = count(result.retry);
              if (retries.has(retry)) throw new Error("Duplicate Playwright retry.");
              retries.add(retry);
              number(result.duration);
              const errors = array(result.errors);
              if (result.status === "passed" && errors.length > 0)
                throw new Error("Playwright passing attempt contains errors.");
              unexpectedAttempt ||= !["skipped", "interrupted", test.expectedStatus].includes(
                result.status,
              );
              staleAttempt ||= timestamp(result.startTime) < startedAt;
              interrupted ||= result.status === "interrupted";
            }
            if (test.status === "expected" && unexpectedAttempt)
              throw new Error("Playwright expected outcome contradicts retry results.");
            const last = results.at(-1);
            if (!last) file.counts.notRun += 1;
            else if (test.status === "flaky" || test.status === "unexpected")
              file.counts.failed += 1;
            else if (last.status === "interrupted") file.counts.notRun += 1;
            else if (test.status === "skipped") {
              if (test.expectedStatus === "skipped" && last.status === "skipped")
                file.counts.skipped += 1;
              else file.counts.notRun += 1;
            } else if (last.status === test.expectedStatus) file.counts.passed += 1;
            else throw new Error("Playwright expected outcome has no matching final result.");
          }
        }
        if (suite.suites !== undefined) visit(suite.suites, [...ancestors, suite.title]);
      }
    };
    visit(report.suites);
    if (staleAttempt) return unavailable("stale", "Playwright attempt predates this run.");
    for (const key of Object.keys(outcomes))
      if (stats[key] !== outcomes[key])
        throw new Error("Playwright totals do not match project results.");
    const globalError = array(report.errors).length > 0;
    const issues = [];
    let missingProjects = false;
    for (const spec of specs.values()) {
      if ([...configuredProjects.keys()].some((project) => !spec.projects.has(project))) {
        missingProjects = true;
        if (spec.file.counts.failed === 0) spec.file.status = "incomplete";
      }
    }
    if (missingProjects) issues.push("Playwright specs are missing configured project results.");
    if (outcomes.flaky) issues.push("Playwright flaky tests are counted as failed.");
    if (globalError) issues.push("Playwright reported global errors; file results are incomplete.");
    if (interrupted) issues.push("Playwright has interrupted attempts.");
    return {
      ...finish(
        files,
        globalError || interrupted || outcomes.flaky > 0 || outcomes.unexpected > 0,
        issues.join(" ") || null,
        globalError,
      ),
      projects: [...projects].sort(),
    };
  } catch (error) {
    return unavailable(
      "invalid",
      error instanceof Error ? error.message : "Invalid Playwright report.",
    );
  }
}

/** Combine declared files only; missing files stay explicit and never create invented test counts. */
export function summarizeScenarios(catalog, reports) {
  return catalog.map(({ id, title, description, vitest, playwright }) => {
    const counts = emptyCounts();
    const missing = [];
    const states = [];
    for (const [runner, paths] of [
      ["vitest", vitest],
      ["playwright", playwright],
    ]) {
      const report = reports[runner];
      for (const path of new Set(paths)) {
        const file =
          report?.status === "available" ? report.files.find((entry) => entry.file === path) : null;
        if (!file) missing.push(`${runner}:${path}`);
        else {
          add(counts, file.counts);
          states.push(file.status);
        }
      }
    }
    let status = outcome(counts);
    if (states.includes("failed")) status = "failed";
    else if (
      states.includes("incomplete") ||
      (missing.length > 0 && states.some((state) => state !== "not-run")) ||
      (states.includes("not-run") && states.some((state) => state !== "not-run"))
    )
      status = "incomplete";
    return { id, title, description, status, counts, missing };
  });
}
