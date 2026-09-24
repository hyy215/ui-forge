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

test("MasterGo shares requirements, preserves attachment drafts, and retains errors for retry", async ({
  page,
}) => {
  await setup(page, "?designCheckError=1&createError=1");
  await page.getByLabel("需求说明", { exact: false }).fill("本地草稿");
  await page.getByLabel("添加设计图片", { exact: true }).setInputFiles(image);
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("本地草稿");
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
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("MasterGo 草稿");
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
  await expect(page.getByRole("alert")).toContainText(
    "已核对文件、页面和 JSON 读取工具；尚未读取目标节点。",
  );
  await expect(page.getByRole("alert")).toContainText("连接检查不代表任务或验收通过。");
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

for (const finalSource of ["local", "magic", "vibe"] as const) {
  test(`source and connection switches preserve the latest requirements through ${finalSource} submission`, async ({
    page,
  }) => {
    await setup(page);
    const prompt = page.getByLabel("需求说明", { exact: false });
    const local = page.getByRole("radio", { name: "图片/文字", exact: true });
    const mastergo = page.getByRole("radio", { name: "MasterGo", exact: true });
    const magic = page.getByRole("radio", { name: "Magic", exact: true });
    const vibe = page.getByRole("radio", { name: "Vibe", exact: true });
    const latest = "最新需求：保留搜索和重置，再补充取消编辑。";
    await prompt.fill("初始需求：搜索和重置。");
    await mastergo.check();
    await expect(prompt).toHaveValue("初始需求：搜索和重置。");
    await page.getByLabel("设计链接", { exact: true }).fill(url);
    await magic.check();
    await expect(prompt).toHaveValue("初始需求：搜索和重置。");
    await prompt.fill("接入模式调整后的需求：支持取消编辑。");
    await vibe.check();
    await expect(prompt).toHaveValue("接入模式调整后的需求：支持取消编辑。");
    await local.check();
    await expect(prompt).toHaveValue("接入模式调整后的需求：支持取消编辑。");
    await prompt.clear();
    await mastergo.check();
    await expect(prompt).toHaveValue("");
    await magic.check();
    await expect(prompt).toHaveValue("");
    await local.check();
    await expect(prompt).toHaveValue("");
    await prompt.fill(latest);
    await mastergo.check();
    await expect(prompt).toHaveValue(latest);
    await magic.check();
    await expect(prompt).toHaveValue(latest);
    await vibe.check();
    await expect(prompt).toHaveValue(latest);
    if (finalSource === "local") await local.check();
    if (finalSource === "magic") await magic.check();
    await expect(prompt).toHaveValue(latest);
    expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).toEqual([]);
    await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
    await expect(page.getByLabel("任务设计绑定")).toContainText(
      finalSource === "local"
        ? "来源：图片/文字"
        : `接入：${finalSource === "magic" ? "Magic" : "Vibe"}`,
    );
    await expect(page.locator("article").filter({ hasText: latest })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "初始需求：搜索和重置。" })).toHaveCount(
      0,
    );
  });
}

test("Magic check reports connection scope without claiming canvas or design access", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await page.getByLabel("设计链接", { exact: true }).fill("https://mastergo.com/file/file");
  await page.getByRole("radio", { name: "Magic", exact: true }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  const result = page.getByRole("alert");
  await expect(result).toContainText("连接检查成功");
  await expect(result).toContainText("已完成 MCP 握手和工具清单检查；尚未验证目标设计读取权限。");
  await expect(result).toContainText("连接检查不代表任务或验收通过。");
  await expect(result).not.toContainText("已核对文件");
  await expect(result).not.toContainText("文件 file");
  expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).toEqual([
    "ui-forge.design.check",
  ]);
});

test("strict pixel reference warning follows draft attachments without blocking task creation", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("需求说明", { exact: false }).fill("本地严格验收草稿");
  const strictAcceptance = page.getByRole("checkbox", { name: "严格像素验收", exact: true });
  const warning = page.getByRole("alert").filter({ hasText: "尚未附加原始参考图" });
  const submit = page.getByRole("button", { name: "开始执行任务 ↗", exact: true });
  await expect(warning).toHaveCount(0);
  await strictAcceptance.check();
  await expect(warning).toContainText("严格像素验收可能受阻；可以继续功能实现并稍后补图。");
  await expect(submit).toBeEnabled();
  await page.getByLabel("添加设计图片", { exact: true }).setInputFiles(image);
  await expect(page.getByRole("img", { name: "draft.png" })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "移除 draft.png", exact: true }).click();
  await expect(warning).toBeVisible();
  await strictAcceptance.uncheck();
  await expect(warning).toHaveCount(0);
  await strictAcceptance.check();
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await expect(strictAcceptance).toBeChecked();
  await expect(warning).toBeVisible();
  await page.getByLabel("设计链接", { exact: true }).fill(url);
  await page.getByRole("radio", { name: "Vibe", exact: true }).check();
  await expect(strictAcceptance).toBeChecked();
  await expect(warning).toBeVisible();
  await expect(submit).toBeEnabled();
  await page.getByRole("radio", { name: "图片/文字", exact: true }).check();
  await expect(strictAcceptance).toBeChecked();
  await expect(warning).toBeVisible();
  await expect(page.getByLabel("需求说明", { exact: false })).toHaveValue("本地严格验收草稿");
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await expect(warning).toBeVisible();
  await page.screenshot({
    path: `apps/agent-webview/test-results/strict-reference-warning-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await submit.click();
  await expect(page.getByLabel("任务设计绑定")).toContainText("接入：Vibe");
  await expect(page.locator("article").filter({ hasText: "启用严格像素验收。" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).not.toContain(
    "ui-forge.design.check",
  );
});

for (const enabled of [true, false]) {
  test(`strict pixel selection remains independent of source and connection when ${enabled ? "enabled" : "disabled"}`, async ({
    page,
  }) => {
    await setup(page, "?createError=1");
    await page.getByLabel("需求说明", { exact: false }).fill("保留用户选择的验收方式。");
    const strictAcceptance = page.getByRole("checkbox", { name: "严格像素验收", exact: true });
    const local = page.getByRole("radio", { name: "图片/文字", exact: true });
    const mastergo = page.getByRole("radio", { name: "MasterGo", exact: true });
    const magic = page.getByRole("radio", { name: "Magic", exact: true });
    const vibe = page.getByRole("radio", { name: "Vibe", exact: true });
    await expect(strictAcceptance).not.toBeChecked();
    await strictAcceptance.check();
    await mastergo.check();
    await expect(strictAcceptance).toBeChecked();
    await page.getByLabel("设计链接", { exact: true }).fill(url);
    await vibe.check();
    await expect(strictAcceptance).toBeChecked();
    await strictAcceptance.uncheck();
    await magic.check();
    await expect(strictAcceptance).not.toBeChecked();
    await local.check();
    await expect(strictAcceptance).not.toBeChecked();
    await strictAcceptance.setChecked(enabled);
    await mastergo.check();
    await expect(strictAcceptance).toBeChecked({ checked: enabled });
    await vibe.check();
    await expect(strictAcceptance).toBeChecked({ checked: enabled });
    expect(await page.evaluate(() => Reflect.get(window, "fixtureMethods"))).toEqual([]);
    const submit = page.getByRole("button", { name: "开始执行任务 ↗", exact: true });
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "任务创建失败" })).toBeVisible();
    await expect(strictAcceptance).toBeChecked({ checked: enabled });
    await submit.click();
    const request = page.locator("article").filter({ hasText: "保留用户选择的验收方式。" });
    await expect(request).toBeVisible();
    if (enabled) await expect(request).toContainText("启用严格像素验收。");
    else await expect(request).not.toContainText("启用严格像素验收。");
  });
}

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
