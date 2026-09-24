/** Build and measure an isolated long-history fixture in Chromium; never connect to a real task. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, arch } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import {
  parseBenchmarkOptions,
  renderHistoryReport,
  summarizeNumbers,
  summarizeSamples,
} from "./history-metrics.mjs";

const webviewRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(webviewRoot, "../..");
const options = parseBenchmarkOptions(process.argv.slice(2));
const output = resolve(root, options.output);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Exclusive: old results must not accidentally become this run's evidence.
const startedAt = new Date().toISOString();
const samples = [];
let browser;
let server;

/** Fingerprint current relevant sources without copying code or user data into the report. */
async function fingerprintSources() {
  const files = ["package-lock.json"];
  async function walk(directory) {
    for (const entry of (await readdir(join(root, directory), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  for (const directory of [
    "apps/agent-webview/src",
    "apps/agent-webview/fixtures",
    "apps/agent-webview/scripts",
    "packages/client-core/src",
    "packages/shared-protocol/src",
    "packages/client-core/dist",
    "packages/shared-protocol/dist",
  ])
    await walk(directory);
  const hashes = {};
  for (const path of files)
    hashes[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  return hashes;
}

/** Hash the actual browser assets as well as the source and shared package builds. */
async function fingerprintSite(directory, prefix = "") {
  const hashes = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    const key = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await fingerprintSite(path, key));
    else if (entry.isFile())
      hashes[key] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
  return hashes;
}

/** Install browser-side observation only in the local fixture, outside production components. */
function instrumentBrowser() {
  const metrics = {
    progress: [],
    frames: [],
    keys: [],
    longTasks: [],
    streamPaint: null,
    approvalPaint: null,
    approvalClick: null,
  };
  window.__uiForgeHistoryMetrics = metrics;
  let streaming = false;
  let previousFrame;
  let frame;
  const afterFrames = (callback) => requestAnimationFrame(() => requestAnimationFrame(callback));
  function tick(time) {
    if (previousFrame !== undefined) metrics.frames.push(time - previousFrame);
    previousFrame = time;
    if (streaming) frame = requestAnimationFrame(tick);
  }
  window.addEventListener("ui-forge:benchmark-progress", (event) => {
    metrics.progress.push({ ...event.detail, time: performance.now() });
    if (event.detail.kind === "stream-start") {
      streaming = true;
      previousFrame = undefined;
      frame = requestAnimationFrame(tick);
    }
  });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      metrics.longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !streaming ||
        event.target?.getAttribute("aria-label") !== "补充需求" ||
        event.key.length !== 1
      )
        return;
      const start = performance.now();
      requestAnimationFrame(() => metrics.keys.push(performance.now() - start));
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target?.textContent.trim() === "拒绝" && target.closest('[aria-label="Codex 请求"]'))
        metrics.approvalClick = performance.now();
    },
    true,
  );
  window.addEventListener(
    "ui-forge:benchmark-observe",
    () => {
      const timeline = document.querySelector('[aria-label="会话消息"]');
      const streamMessage = timeline.querySelector("section:last-of-type > article:last-child");
      if (!streamMessage) throw new Error("Active message is missing");
      const observer = new MutationObserver(() => {
        if (metrics.streamPaint === null && streamMessage.textContent.includes("stream-end-100")) {
          observer.disconnect();
          afterFrames(() => {
            metrics.streamPaint = performance.now();
            streaming = false;
            cancelAnimationFrame(frame);
          });
        }
      });
      observer.observe(streamMessage, { childList: true, characterData: true, subtree: true });
      const approvalObserver = new MutationObserver(() => {
        if (
          metrics.approvalClick !== null &&
          !timeline.querySelector('[aria-label="Codex 请求"]')
        ) {
          approvalObserver.disconnect();
          afterFrames(() => {
            metrics.approvalPaint = performance.now();
          });
        }
      });
      approvalObserver.observe(timeline, { childList: true });
    },
    { once: true },
  );
}

/** Wait for two browser frames, not a guessed fixed sleep. */
async function settle(page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

/** Exercise the same interactions once in a fresh context, retaining errors and a screenshot. */
async function measure(origin, viewportName, viewport, historyItems, repeat, warmup = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const errors = [];
  const prefix = `${viewportName}-${historyItems}-${warmup ? "warmup" : repeat}`;
  try {
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      errors.push(`Blocked external request: ${route.request().url()}`);
      return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => {
      errors.push(`Blocked WebSocket: ${socket.url()}`);
      socket.close();
    });
    await context.addInitScript(instrumentBrowser);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    const start = performance.now();
    await page.goto(
      `${origin}/fixtures/benchmark.html?historyItems=${historyItems}#/tasks?taskId=benchmark-task`,
      { waitUntil: "load" },
    );
    const timeline = page.getByLabel("会话消息", { exact: true });
    const composer = page.getByLabel("补充需求", { exact: true });
    await expect(
      timeline.locator(":scope > section > article, :scope > section > details"),
    ).toHaveCount(historyItems + 1);
    await expect(composer).toBeEnabled();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await settle(page);
    const readyMs = performance.now() - start;
    await page.evaluate(() => window.dispatchEvent(new Event("ui-forge:benchmark-observe")));

    await timeline.hover();
    await page.mouse.wheel(0, -1500);
    const latest = page.getByRole("button", { name: "回到最新消息 ↓", exact: true });
    await expect(latest).toBeVisible();
    const scrollStart = performance.now();
    await latest.click();
    await expect
      .poll(() =>
        timeline.evaluate((element) =>
          Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight),
        ),
      )
      .toBeLessThan(2);
    await settle(page);
    const scrollReturnMs = performance.now() - scrollStart;

    await composer.focus();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ui-forge:benchmark-control", {
          detail: { action: "stream", count: 100, intervalMs: 20 },
        }),
      ),
    );
    const typedText = "benchmark input 12345";
    await composer.pressSequentially(typedText, { delay: 20 });
    await expect(composer).toHaveValue(typedText);
    await page.waitForFunction(() => window.__uiForgeHistoryMetrics.streamPaint !== null);
    await expect(timeline.locator("article").last()).toContainText("stream-end-100");

    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ui-forge:benchmark-control", { detail: { action: "approval" } }),
      ),
    );
    const approval = page.getByRole("region", { name: "Codex 请求", exact: true });
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "拒绝", exact: true }).click();
    await expect(approval).toHaveCount(0);
    await page.waitForFunction(() => window.__uiForgeHistoryMetrics.approvalPaint !== null);
    const observed = await page.evaluate(() => ({
      ...window.__uiForgeHistoryMetrics,
      domElements: document.querySelectorAll("*").length,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    }));
    const streamStart = observed.progress.find((entry) => entry.kind === "stream-start")?.time;
    const streamEnd = observed.progress.find((entry) => entry.kind === "stream-end");
    const approvalEnd = observed.progress.find((entry) => entry.kind === "approval-resolved");
    if (
      !Number.isFinite(streamStart) ||
      !Number.isFinite(streamEnd?.time) ||
      streamEnd.count !== 100 ||
      approvalEnd?.decision !== "decline" ||
      observed.keys.length !== typedText.length ||
      !observed.frames.length
    ) {
      throw new Error(`Incomplete browser observations: ${JSON.stringify(observed)}`);
    }
    const cdp = await context.newCDPSession(page);
    const heap = await cdp.send("Runtime.getHeapUsage");
    await cdp.detach();
    const longTasks = observed.longTasks.filter(
      (task) => task.start < observed.streamPaint && task.start + task.duration > streamStart,
    );
    if (!warmup && repeat === 1)
      await page.screenshot({ path: join(output, `${prefix}.png`), fullPage: true });
    if (errors.length) throw new Error(errors.join("\n"));
    if (observed.overflowPx > 1) throw new Error(`Viewport overflow: ${observed.overflowPx}px`);
    return {
      viewport: viewportName,
      historyItems,
      repeat,
      readyMs,
      scrollReturnMs,
      typingFrameMaxMs: summarizeNumbers(observed.keys).max,
      streamMs: streamEnd.time - streamStart,
      streamTailMs: observed.streamPaint - streamEnd.time,
      frameGapMaxMs: summarizeNumbers(observed.frames).max,
      longTaskCount: longTasks.length,
      longTaskMaxMs: longTasks.length
        ? summarizeNumbers(longTasks.map((task) => task.duration)).max
        : 0,
      approvalMs: observed.approvalPaint - observed.approvalClick,
      domElements: observed.domElements,
      heapMiB: heap.usedSize / 1024 / 1024,
      raw: observed,
      errors,
    };
  } catch (error) {
    const page = context.pages()[0];
    await page
      ?.screenshot({ path: join(output, `${prefix}-failure.png`), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-b",
      "packages/shared-protocol",
      "packages/client-core",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const sourceHashes = await fingerprintSources();
  const git = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
    ),
  };
  const config = {
    configFile: false,
    envDir: false,
    root: webviewRoot,
    base: "./",
    plugins: [react()],
    build: {
      outDir: join(output, "site"),
      emptyOutDir: false,
      rollupOptions: { input: join(webviewRoot, "fixtures/benchmark.html") },
    },
  };
  await build(config);
  const assetHashes = await fingerprintSite(join(output, "site"));
  server = await preview({
    ...config,
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview did not bind a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const environment = {
    node: process.version,
    browser: browser.version(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    git,
  };
  const viewports = { desktop: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } };
  await writeFile(
    join(output, "run.json"),
    JSON.stringify(
      { startedAt, ...options, environment, sourceHashes, assetHashes, viewports },
      null,
      2,
    ),
    { flag: "wx" },
  );
  for (const [name, viewport] of Object.entries(viewports)) {
    console.log(`Warmup: ${name}`);
    await measure(origin, name, viewport, 100, 0, true);
    // Rotate sample sizes between repeats to reduce a fixed size/order bias.
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      const sizes = [100, 500, 1000];
      const offset = (repeat - 1) % sizes.length;
      for (const historyItems of [...sizes.slice(offset), ...sizes.slice(0, offset)]) {
        const sample = await measure(origin, name, viewport, historyItems, repeat);
        samples.push(sample);
        await writeFile(
          join(output, `${name}-${historyItems}-${repeat}.json`),
          JSON.stringify(sample, null, 2),
          { flag: "wx" },
        );
        console.log(
          `${name} ${historyItems} #${repeat}: ready=${sample.readyMs.toFixed(0)}ms frameMax=${sample.frameGapMaxMs.toFixed(0)}ms DOM=${sample.domElements}`,
        );
      }
    }
  }
  const finalSourceHashes = await fingerprintSources();
  if (JSON.stringify(sourceHashes) !== JSON.stringify(finalSourceHashes))
    throw new Error("Relevant source files changed during measurement; rerun in a fresh directory");
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    repeats: options.repeats,
    environment,
    sourceHashes,
    assetHashes,
    viewports,
    samples,
    summary: summarizeSamples(samples, options.repeats),
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  await writeFile(join(output, "report.md"), renderHistoryReport(report), { flag: "wx" });
  console.log(`Report: ${relative(root, join(output, "report.md"))}`);
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      {
        startedAt,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.stack : String(error),
        completedSamples: samples.length,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  throw error;
} finally {
  await browser?.close();
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done())),
    );
  }
}
