/** 验证消息链接打开实际文件内容、保留会话，以及宿主失败后的重试。 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startFilePreviewServer } from "./support/filePreviewServer";

async function start(page: Page, query: URLSearchParams) {
  await page.goto(`/?${query}#/tasks`);
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/demo-project");
  await page.getByLabel("需求说明", { exact: false }).fill("查看实际截图和验收记录");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("link", { name: "实际截图", exact: true })).toBeVisible();
}

test("file links open screenshot bytes and report text in separate pages without losing the draft", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "ui-forge-file-links-browser-"));
  const screenshot = join(directory, "delivered preview (1).png");
  const report = join(directory, "verification.md");
  await writeFile(
    screenshot,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(report, "# 实际验收记录\n\n读取磁盘文件内容。\n");
  const server = await startFilePreviewServer(directory);
  try {
    // 仅替代开发代理地址，保留真实服务的状态、文件字节和所有响应头。
    await context.route("**/api/session-file?**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: server.origin + url.pathname + url.search });
      return route.fulfill({ response });
    });
    await start(page, new URLSearchParams({ scenario: "files", artifactPath: directory }));
    const originalUrl = page.url();
    const draft = page.getByLabel("补充需求", { exact: true });
    await draft.fill("保留这条未发送的消息");
    await expect(page.getByRole("link", { name: "打开页面", exact: true })).toHaveAttribute(
      "href",
      "http://localhost:3000",
    );
    const imagePopup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "实际截图", exact: true }).click();
    const preview = await imagePopup;
    await expect
      .poll(() =>
        preview.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    expect(new URL(preview.url()).searchParams.get("path")).toBe(screenshot);
    await preview.close();
    // 文件修改后的内容应在下次点击时直接读取，不能使用聊天中缓存的文字。
    await writeFile(report, "# 实际验收记录\n\n更新后的磁盘内容。\n");
    const reportPopup = page.waitForEvent("popup");
    const reportLink = page.getByRole("link", { name: "完整验收记录", exact: true });
    await reportLink.focus();
    await reportLink.press("Enter");
    const reportPage = await reportPopup;
    await expect(reportPage.locator("body")).toContainText("更新后的磁盘内容。");
    await reportPage.close();
    const missingPopup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "缺失文件", exact: true }).click();
    const missing = await missingPopup;
    await expect(missing.locator("body")).toContainText("文件不存在");
    await missing.close();
    await expect(draft).toHaveValue("保留这条未发送的消息");
    expect(page.url()).toBe(originalUrl);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await reportLink.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("file-links.png"), fullPage: true });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("host file open failure stays in the conversation and can be retried", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, "acquireVsCodeApi", () => ({ postMessage: () => undefined }));
    const opened: string[] = [];
    Reflect.set(window, "hostOpenedLinks", opened);
    // VS Code 的 window 链接监听器不检查 defaultPrevented；页面必须停止冒泡。
    for (const type of ["click", "auxclick"])
      window.addEventListener(type, (event) => {
        for (const node of event.composedPath())
          if (node instanceof HTMLAnchorElement && node.href) {
            opened.push(node.href);
            event.preventDefault();
            break;
          }
      });
  });
  await start(page, new URLSearchParams({ scenario: "files", fileError: "1" }));
  const originalUrl = page.url();
  const link = page.getByRole("link", { name: "实际截图", exact: true });
  await link.click();
  const error = page.getByRole("alert").filter({ hasText: "文件预览失败" });
  await expect(error).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "hostOpenedLinks"))).toEqual([]);
  await link.click();
  await expect(error).toHaveCount(0);
  await expect(link).toHaveAttribute("aria-busy", "false");
  expect(context.pages()).toHaveLength(1);
  expect(page.url()).toBe(originalUrl);
  await link.focus();
  await link.press("Enter");
  await link.click({ button: "middle" });
  expect(await page.evaluate(() => Reflect.get(window, "hostOpenedLinks"))).toEqual([]);
});
