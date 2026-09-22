import { expect, test, type Page } from "@playwright/test";

const url = "https://mastergo.com/file/file?layer_id=2:3&page_id=1:0";
const image = {
  name: "draft.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64",
  ),
};

async function setup(page: Page, query = "") {
  await page.goto(`/${query}#/tasks`);
  await page.evaluate(() => {
    const methods: string[] = [];
    Reflect.set(window, "fixtureMethods", methods);
    window.addEventListener("ui-forge:fixture-request", (event) =>
      methods.push(String((event as CustomEvent<unknown>).detail)),
    );
  });
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/design-source-fixture");
}

test("local task needs no platform check and stores local binding", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("radio", { name: "图片/文字", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Figma", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "检查连接", exact: true })).toHaveCount(0);
  await page.getByLabel("需求说明", { exact: false }).fill("本地文字任务");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByLabel("任务设计绑定")).toHaveText("来源：图片/文字 · 无平台接入");
  expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).not.toContain(
    "ui-forge.design.check",
  );
});

test("MasterGo preserves separate drafts, checks explicitly, and retains errors for retry", async ({
  page,
}) => {
  await setup(page, "?designCheckError=1&createError=1");
  await page.getByLabel("需求说明", { exact: false }).fill("本地草稿");
  await page.getByLabel("添加设计图片", { exact: true }).setInputFiles(image);
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("");
  await expect(page.getByRole("img", { name: "draft.png" })).toHaveCount(0);
  await page.getByLabel("设计链接", { exact: true }).fill(url);
  await expect(page.getByRole("radio", { name: "Magic", exact: true })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Vibe", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "开始执行任务 ↗", exact: true })).toBeDisabled();
  await page.getByRole("radio", { name: "Vibe", exact: true }).check();
  await expect(page.getByLabel("Vibe MCP 地址", { exact: true })).toHaveValue(
    "http://127.0.0.1:20678/mcp",
  );
  await page.getByText("高级设置", { exact: true }).click();
  await expect(page.getByLabel("画布状态地址", { exact: true })).toHaveValue(
    "http://127.0.0.1:30678/api/status",
  );
  await page.getByLabel("Vibe MCP 地址", { exact: true }).fill("http://localhost:20678/mcp");
  await page.getByLabel("需求说明", { exact: false }).fill("MasterGo 草稿");
  await page.getByLabel("添加设计图片", { exact: true }).setInputFiles(image);
  await page.getByRole("radio", { name: "图片/文字", exact: true }).check();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("本地草稿");
  await expect(page.getByRole("img", { name: "draft.png" })).toBeVisible();
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("MasterGo 草稿");
  await expect(page.getByLabel("设计链接", { exact: true })).toHaveValue(url);
  await expect(page.getByLabel("Vibe MCP 地址", { exact: true })).toHaveValue(
    "http://localhost:20678/mcp",
  );
  expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).toEqual([]);
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("连接检查失败");
  await expect(page.getByRole("img", { name: "draft.png" })).toBeVisible();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("连接检查成功");
  expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).toEqual([
    "ui-forge.design.check",
    "ui-forge.design.check",
  ]);
  await page.screenshot({
    path: `apps/agent-webview/test-results/design-source-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "任务创建失败" })).toBeVisible();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("MasterGo 草稿");
  await expect(page.getByRole("img", { name: "draft.png" })).toBeVisible();
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByLabel("任务设计绑定")).toContainText("接入：Vibe");
  await expect(page.getByLabel("任务设计绑定")).toContainText("文件 file · 页面 1:0 · 节点 2:3");
  await page.screenshot({
    path: `apps/agent-webview/test-results/design-binding-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("changing source, link, connection or endpoint invalidates pending and completed checks", async ({
  page,
}) => {
  await setup(page, "?designCheckDelay=250");
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await page.getByLabel("设计链接", { exact: true }).fill(url);
  await page.getByRole("radio", { name: "Vibe", exact: true }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await page.getByLabel("设计链接", { exact: true }).fill(url + "-changed");
  await page.waitForTimeout(350);
  await expect(page.getByText("连接检查成功", { exact: true })).toHaveCount(0);
  for (const change of ["endpoint", "status", "connection", "source"]) {
    await page.getByRole("button", { name: "检查连接", exact: true }).click();
    await expect(page.getByText("连接检查成功", { exact: true })).toBeVisible();
    if (change === "endpoint")
      await page.getByLabel("Vibe MCP 地址", { exact: true }).fill("http://localhost:20678/mcp");
    if (change === "status") {
      await page.getByText("高级设置", { exact: true }).click();
      await page
        .getByLabel("画布状态地址", { exact: true })
        .fill("http://localhost:30678/api/status");
    }
    if (change === "connection")
      await page.getByRole("radio", { name: "Magic", exact: true }).check();
    if (change === "source")
      await page.getByRole("radio", { name: "图片/文字", exact: true }).check();
    await expect(page.getByText("连接检查成功", { exact: true })).toHaveCount(0);
  }
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "fixtureMethods") as string[]).every(
        (method) => method === "ui-forge.design.check",
      ),
    ),
  ).toBe(true);
});

test("old unbound tasks display legacy Magic rather than local or Vibe", async ({ page }) => {
  await setup(page, "?legacyBinding=1");
  await page.getByLabel("需求说明", { exact: false }).fill("历史任务样本");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByLabel("任务设计绑定")).toHaveText("历史任务 · 接入：Magic（来源未记录）");
});
