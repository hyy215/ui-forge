/** 验证诊断按需读取、真实 JSON 导出、失败重试和窄屏中的草稿保留。 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  diagnosticMethods,
  sessionMethods,
  taskDiagnosticsSchema,
} from "@ui-forge/shared-protocol";

const imageBytes =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

async function recordRequests(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Reflect.set(window, "uiForgeFixtureRequests", calls);
    window.addEventListener("ui-forge:fixture-request", (event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string")
        calls.push(event.detail);
    });
  });
}

async function requests(page: Page) {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, "uiForgeFixtureRequests");
    return Array.isArray(value)
      ? value.filter((item: unknown): item is string => typeof item === "string")
      : [];
  });
}

async function start(page: Page, query = "") {
  await recordRequests(page);
  await page.goto(`/?scenario=capacity${query}#/tasks`);
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/diagnostics-project");
  await page.getByLabel("需求说明", { exact: false }).fill("诊断测试任务");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toBeVisible();
}

test("diagnostics reads only on request, downloads validated JSON and preserves draft images", async ({
  page,
}) => {
  await start(page);
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer.getByLabel("补充需求", { exact: true }).fill("尚未发送的诊断草稿");
  await composer.getByLabel("添加对话图片").setInputFiles({
    name: "diagnostic-draft.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageBytes, "base64"),
  });
  const historyBefore = await page.getByLabel("会话消息", { exact: true }).innerText();
  const requestsBefore = await requests(page);
  expect(requestsBefore).not.toContain(diagnosticMethods.read);
  const entry = page.getByRole("button", { name: "查看任务诊断", exact: true });
  await expect(entry).toContainText("任务诊断");
  await expect(entry.getByText("任务诊断", { exact: true })).toBeVisible();
  const header = page.locator("header").filter({ has: entry });
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await header.evaluate((element) => {
      const headerBounds = element.getBoundingClientRect();
      const buttons = Array.from(element.querySelectorAll("button")).filter((button) =>
        ["查看交付结果", "查看任务诊断"].includes(button.getAttribute("aria-label") ?? ""),
      );
      const [delivery, diagnostics] = buttons.map((button) => button.getBoundingClientRect());
      if (buttons.length !== 2 || !delivery || !diagnostics) return false;
      return (
        headerBounds.left >= 0 &&
        headerBounds.right <= innerWidth &&
        buttons.every((button) => {
          const bounds = button.getBoundingClientRect();
          return (
            button.scrollWidth <= button.clientWidth &&
            bounds.left >= headerBounds.left &&
            bounds.right <= headerBounds.right &&
            bounds.top >= headerBounds.top &&
            bounds.bottom <= headerBounds.bottom
          );
        }) &&
        (delivery.right <= diagnostics.left ||
          diagnostics.right <= delivery.left ||
          delivery.bottom <= diagnostics.top ||
          diagnostics.bottom <= delivery.top)
      );
    }),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await header.screenshot({
    path: `apps/agent-webview/test-results/diagnostics-entry-${test.info().project.name}.png`,
  });
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "任务诊断" });
  await expect(
    dialog.getByLabel("Agent 摘要").getByText("gpt-6-astra", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("服务繁忙，暂无可用容量", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "第 1 轮诊断" })).toContainText("轮次耗时2 秒");
  await expect(dialog.getByRole("region", { name: "第 1 轮诊断" })).toContainText(
    "已知工具耗时合计：3 秒",
  );
  expect((await requests(page)).filter((method) => method === diagnosticMethods.read)).toHaveLength(
    1,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({
    path: `apps/agent-webview/test-results/diagnostics-${test.info().project.name}.png`,
  });

  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出诊断 JSON", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("ui-forge-demo-0-diagnostics.json");
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = taskDiagnosticsSchema.parse(
    JSON.parse(await readFile(path!, "utf8")) as unknown,
  );
  expect(exported).toMatchObject({
    taskId: "demo-0",
    scope: "thread-tree",
    source: "codex-thread-read",
    model: "gpt-6-astra",
    tokenUsage: { total: { totalTokens: 1200, cacheWriteInputTokens: 0 } },
  });
  expect(exported.turns[1]).toMatchObject({
    status: "failed",
    durationMs: null,
    errorCode: "serverOverloaded",
  });
  expect(JSON.stringify(exported)).not.toMatch(/sensitive-body|aggregatedOutput|userMessage/);
  await dialog.getByRole("button", { name: "刷新诊断", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await requests(page)).filter((method) => method === diagnosticMethods.read).length,
    )
    .toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue("尚未发送的诊断草稿");
  await expect(composer.getByRole("img", { name: "diagnostic-draft.png" })).toBeVisible();
  await expect(page.getByLabel("会话消息", { exact: true })).toHaveText(historyBefore, {
    useInnerText: true,
  });
  const sessionRequestsAfter = (await requests(page)).filter(
    (method) => method !== diagnosticMethods.read,
  );
  expect(sessionRequestsAfter).toEqual(requestsBefore);
  expect(sessionRequestsAfter).not.toContain(sessionMethods.send);
});

test("diagnostics preserves unknown history without showing missing measurements as zero", async ({
  page,
}) => {
  await start(page, "&diagnostics=unknown");
  await page.getByRole("button", { name: "查看任务诊断", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务诊断" });
  await expect(dialog.getByText("未采集", { exact: true })).toBeVisible();
  await expect(dialog.getByText("未记录此任务的规则指纹。", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("原生会话历史不完整，轮次和工具统计可能缺失。", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("未知", { exact: true })).toHaveCount(12);
  await expect(dialog.getByText("暂无轮次记录。", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出诊断 JSON", exact: true }).click();
  const path = await (await downloaded).path();
  const exported = taskDiagnosticsSchema.parse(
    JSON.parse(await readFile(path!, "utf8")) as unknown,
  );
  expect(exported.tokenUsage).toBeNull();
  expect(exported.ruleFingerprints).toBeNull();
  expect(exported.model).toBeNull();
  expect(exported.turns).toEqual([]);
});

test("diagnostics closes with Escape while a refresh is pending", async ({ page }) => {
  await start(page, "&diagnosticsDelay=300");
  await page.getByRole("button", { name: "查看任务诊断", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务诊断" });
  await expect(
    dialog.getByLabel("Agent 摘要").getByText("gpt-6-astra", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "刷新诊断", exact: true }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("diagnostics retries a failed read and retains an existing report when refreshing fails", async ({
  page,
}) => {
  await start(page, "&diagnosticsFailAt=1,3");
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer.getByLabel("补充需求", { exact: true }).fill("读取失败仍保留");
  await page.getByRole("button", { name: "查看任务诊断", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务诊断" });
  await expect(dialog.getByText("诊断读取失败，请重试。", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("sensitive-body");
  await expect(dialog.getByRole("button", { name: "导出诊断 JSON", exact: true })).toBeDisabled();
  expect((await requests(page)).filter((method) => method === diagnosticMethods.read)).toHaveLength(
    1,
  );
  await dialog.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(
    dialog.getByLabel("Agent 摘要").getByText("gpt-6-astra", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "刷新诊断", exact: true }).click();
  await expect(dialog.getByText("仍显示上次读取的报告。", { exact: true })).toBeVisible();
  await expect(
    dialog.getByLabel("Agent 摘要").getByText("gpt-6-astra", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "导出诊断 JSON", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(dialog.getByText("诊断读取失败，请重试。", { exact: true })).toHaveCount(0);
  expect((await requests(page)).filter((method) => method === diagnosticMethods.read)).toHaveLength(
    4,
  );
  await page.keyboard.press("Escape");
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue("读取失败仍保留");
  expect(await requests(page)).not.toContain(sessionMethods.send);
});

test("diagnostics offers selectable JSON when the injected VS Code clipboard fails", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, "acquireVsCodeApi", () => ({ postMessage: () => undefined }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("fixture clipboard failure");
        },
      },
    });
  });
  await start(page);
  await page.getByRole("button", { name: "查看任务诊断", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务诊断" });
  await expect(dialog.getByRole("button", { name: "导出诊断 JSON", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "复制诊断 JSON", exact: true }).click();
  await expect(
    dialog.getByText("未能复制，请选中下方 JSON 手动复制。", { exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toContainText("已复制 JSON");
  const raw = dialog.getByRole("textbox", { name: "诊断 JSON", exact: true });
  const exported = taskDiagnosticsSchema.parse(JSON.parse(await raw.inputValue()) as unknown);
  expect(exported).toMatchObject({ taskId: "demo-0", model: "gpt-6-astra", scope: "thread-tree" });
  await raw.focus();
  expect(
    await raw.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return input.selectionEnd - input.selectionStart === input.value.length;
    }),
  ).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
