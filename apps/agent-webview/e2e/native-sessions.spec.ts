/** 浏览器验证原生会话界面与文件编辑器，执行边界由服务集成测试覆盖。 */
import { expect, test } from "@playwright/test";

const imageBytes =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const imageFile = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(imageBytes, "base64"),
});

async function start(page: import("@playwright/test").Page, query = "") {
  await page.goto("/" + query + "#/tasks");
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/demo-project");
  await page.getByLabel("需求说明", { exact: false }).fill("实现客户列表，支持搜索和重置");
  const strictAcceptance = page.getByRole("checkbox", { name: "严格像素验收", exact: true });
  await expect(strictAcceptance).not.toBeChecked();
  await strictAcceptance.check();
  await strictAcceptance.uncheck();
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("region", { name: "Codex 请求" })).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "实现客户列表，支持搜索和重置" }),
  ).not.toContainText("启用严格像素验收");
}

test("opens the home page rule link in a separate settings tab", async ({ page }) => {
  await page.goto("/#/");
  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name: "调整设计与工程规则", exact: true }).click();
  const settings = await opened;
  await expect(settings.getByRole("heading", { name: "规则文件" })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await settings.close();
  await expect(page.getByRole("heading", { name: "把设计带进项目。" })).toBeVisible();
});

test("opens settings separately, preserves the conversation draft, and gives the editor room", async ({
  page,
}) => {
  await start(page);
  const originalUrl = page.url();
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer.getByLabel("补充需求", { exact: true }).fill("还没发出的补充需求");
  await composer.getByLabel("添加对话图片").setInputFiles(imageFile("draft.png"));
  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name: "规则配置", exact: true }).click();
  const settings = await opened;
  await expect(settings).toHaveURL(/#\/settings$/);
  await expect(settings.getByRole("heading", { name: "规则文件" })).toBeVisible();
  await expect(settings.getByRole("link", { name: "新建任务" })).toHaveCount(0);
  const editor = settings.getByRole("textbox", { name: "design.md 内容", exact: true });
  await expect(editor).toBeVisible();
  const bounds = await editor.boundingBox();
  const viewport = settings.viewportSize()!;
  expect(bounds!.width).toBeGreaterThan(viewport.width * 0.8);
  expect(bounds!.height).toBeGreaterThan(viewport.width > 700 ? viewport.height * 0.6 : 239);
  const save = settings.getByRole("button", { name: "保存文件", exact: true });
  await expect(save).toBeInViewport();
  await expect
    .poll(() => settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await settings.screenshot({
    path: `apps/agent-webview/test-results/settings-${test.info().project.name}.png`,
    fullPage: true,
  });
  await settings.close();
  await expect(page).toHaveURL(originalUrl);
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue("还没发出的补充需求");
  await expect(composer.getByRole("img", { name: "draft.png" })).toBeVisible();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.getByRole("region", { name: "Codex 提问" })).toBeVisible();
});

test("saves both rule files, supports keyboard save and retains independent drafts", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const files = page.getByRole("navigation", { name: "规则文件", exact: true });
  const design = page.getByRole("region", { name: "design.md 编辑器" });
  await expect(
    design.getByText("/ui-forge/packages/codex-client/instructions/design.md"),
  ).toBeVisible();
  await page.getByLabel("design.md 内容", { exact: true }).fill("# 设计规则\n保持间距和布局\n");
  await files.getByRole("button", { name: /project.md/ }).click();
  const project = page.getByRole("region", { name: "project.md 编辑器" });
  await page.getByLabel("project.md 内容", { exact: true }).fill("# 工程规则\n使用已有组件\n");
  await page.keyboard.press("Control+s");
  await expect(project.getByRole("status")).toHaveText("已保存到文件");
  await project.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByLabel("project.md 内容", { exact: true })).toHaveValue(
    "# 工程规则\n使用已有组件\n",
  );
  await files.getByRole("button", { name: /design.md/ }).click();
  await expect(page.getByLabel("design.md 内容", { exact: true })).toHaveValue(
    "# 设计规则\n保持间距和布局\n",
  );
  await expect(design.getByRole("status")).toHaveText("未保存");
  await page.keyboard.press("Meta+s");
  await expect(design.getByRole("status")).toHaveText("已保存到文件");
  await design.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByLabel("design.md 内容", { exact: true })).toHaveValue(
    "# 设计规则\n保持间距和布局\n",
  );
  await expect(design.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
});

test("keeps failed rule edits and confirms before discarding them", async ({ page }) => {
  await page.goto("/?saveError=1#/settings");
  const files = page.getByRole("navigation", { name: "规则文件", exact: true });
  await page.getByLabel("design.md 内容", { exact: true }).fill("未保存的修改");
  const design = page.getByRole("region", { name: "design.md 编辑器" });
  await design.getByRole("button", { name: "保存文件" }).click();
  await expect(page.getByText("EACCES：规则文件无法写入")).toBeVisible();
  await files.getByRole("button", { name: /project.md/ }).click();
  await files.getByRole("button", { name: /design.md/ }).click();
  await expect(page.getByLabel("design.md 内容", { exact: true })).toHaveValue("未保存的修改");
  await design.getByRole("button", { name: "重新加载" }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("design.md 内容", { exact: true })).toHaveValue("未保存的修改");
  await design.getByRole("button", { name: "重新加载" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByLabel("design.md 内容", { exact: true })).toHaveValue(
    "# 设计规则\n\n忠实还原设计与交互。\n",
  );
  await expect(design.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
});

test("shows native output, forwards refusal and answers, then streams supplemental input", async ({
  page,
}) => {
  await start(page);
  await expect(page.getByText("我会先检查项目和设计，再实现页面。")).toBeVisible();
  await expect(page.getByRole("button", { name: "批准方案并执行" })).toHaveCount(0);
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.getByRole("region", { name: "Codex 提问" })).toBeVisible();
  await page.getByRole("button", { name: "20 条", exact: true }).click();
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByText("本轮已结束", { exact: true })).toBeVisible();
  await expect(page.getByText("未执行工程验证", { exact: true })).toBeVisible();
  await page.getByLabel("补充需求", { exact: true }).fill("增加状态筛选");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("已收到补充需求。", { exact: true })).toBeVisible();
  await expect(page.getByText("将按最新要求继续修改。", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `apps/agent-webview/test-results/session-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("navigation detaches while reopening recovers the pending request; explicit stop ends only the turn", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("link", { name: "ui-forge", exact: true }).click();
  await page.getByRole("link", { name: /实现客户列表/ }).click();
  await expect(page.getByRole("region", { name: "Codex 请求" })).toBeVisible();
  await page.getByRole("button", { name: "停止本轮", exact: true }).click();
  await expect(page.getByText("本轮已停止", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Codex 请求" })).toHaveCount(0);
});

test("capacity failure keeps progress and continues only after an explicit request", async ({
  page,
}) => {
  await page.goto("/?scenario=capacity&sendError#/tasks");
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/demo-project");
  await page.getByLabel("需求说明", { exact: false }).fill("实现客户列表");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  const taskUrl = page.url();
  const resume = page.getByRole("button", { name: "继续当前任务", exact: true });
  await expect(resume).toBeVisible();
  await expect(page.getByText("本轮失败", { exact: true })).toBeVisible();
  await expect(page.getByText("模型暂时繁忙", { exact: true })).toBeVisible();
  await expect(page.getByText("Selected model is at capacity.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "ui-forge", exact: true }).click();
  await page.getByRole("link", { name: /实现客户列表/ }).click();
  await expect(page).toHaveURL(taskUrl);
  await expect(resume).toBeVisible();
  await page.locator("summary").filter({ hasText: "文件修改" }).click();
  await expect(page.locator("summary").filter({ hasText: "src/CustomerList.tsx" })).toBeVisible();
  const draft = page.getByLabel("补充需求", { exact: true });
  await draft.fill("保留这条尚未发送的补充要求");
  await page.getByLabel("添加对话图片").setInputFiles(imageFile("capacity-draft.png"));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await resume.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "apps/agent-webview/test-results/capacity-failure-" + test.info().project.name + ".png",
    fullPage: true,
  });
  await resume.click();
  await expect(page.getByText("发送暂时失败，请重试。", { exact: true })).toBeVisible();
  await expect(resume).toBeEnabled();
  await expect(draft).toHaveValue("保留这条尚未发送的补充要求");
  await expect(page.getByRole("img", { name: "capacity-draft.png" })).toBeVisible();
  await resume.click();
  await expect(page.locator("article").filter({ hasText: "先检查原会话记录" })).toHaveCount(1);
  await expect(resume).toHaveCount(0);
  await expect(page.getByText("将按最新要求继续修改。", { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("保留这条尚未发送的补充要求");
  await expect(page.getByRole("img", { name: "capacity-draft.png" })).toBeVisible();
  await expect(page).toHaveURL(taskUrl);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

for (const scenario of ["usage-limit", "context-limit"]) {
  test(`does not offer capacity continuation for ${scenario}`, async ({ page }) => {
    await page.goto(`/?scenario=${scenario}#/tasks`);
    await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/demo-project");
    await page.getByLabel("需求说明", { exact: false }).fill("实现客户列表");
    await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
    await expect(page.getByText("本轮失败", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toHaveCount(0);
    await expect(page.getByText("模型暂时繁忙", { exact: true })).toHaveCount(0);
  });
}

test("MasterGo URL and image submit together after explicit connection and URL validation", async ({
  page,
}) => {
  await page.goto("/#/tasks");
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/demo-project");
  await page.getByRole("radio", { name: "MasterGo", exact: true }).check();
  await page.getByRole("radio", { name: "Magic", exact: true }).check();
  const strictAcceptance = page.getByRole("checkbox", { name: "严格像素验收", exact: true });
  await strictAcceptance.check();
  await expect(page.getByRole("button", { name: "开始执行任务 ↗", exact: true })).toBeDisabled();
  await page.getByLabel("设计链接", { exact: true }).fill("not-a-url");
  await page.getByLabel("添加设计图片", { exact: true }).setInputFiles({
    name: "design.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("img", { name: "design.png" })).toBeVisible();
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("MasterGo HTTPS");
  await expect(strictAcceptance).toBeChecked();
  await expect(page.getByRole("img", { name: "design.png" })).toBeVisible();
  await page
    .getByLabel("设计链接", { exact: true })
    .fill("https://mastergo.com/file/file?layer_id=2:3");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: "apps/agent-webview/test-results/design-inputs-" + test.info().project.name + ".png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("region", { name: "Codex 请求" })).toBeVisible();
  await expect(page.getByLabel("任务设计绑定")).toContainText("接入：Magic");
  await expect(
    page.getByLabel("任务设计绑定").getByRole("link", { name: "设计链接" }),
  ).toHaveAttribute("href", "https://mastergo.com/file/file?layer_id=2:3");
  await expect(page.locator("article").filter({ hasText: "启用严格像素验收。" })).toContainText(
    "启用严格像素验收。",
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("MCP approval uses buttons, retains failed replies, and shows one readable latest diff", async ({
  page,
}) => {
  for (const [action, expected] of [
    ["允许本次", "已允许"],
    ["拒绝", "已拒绝"],
    ["取消操作", "已取消"],
  ]) {
    await start(page, "?scenario=mcp" + (action === "允许本次" ? "&replyError=1" : ""));
    const request = page.getByRole("region", { name: "Codex 请求" });
    await expect(request.getByText("在浏览器打开设计", { exact: true })).toBeVisible();
    await expect(request.getByLabel("响应内容（JSON）")).toHaveCount(0);
    await expect(page.getByText("思考摘要", { exact: true })).toHaveCount(0);
    const diff = page
      .locator("details")
      .filter({ has: page.locator(":scope > summary").filter({ hasText: "本轮代码差异" }) });
    await expect(diff).toHaveCount(1);
    if (action === "允许本次") {
      await diff.locator("summary").click();
      await expect(diff.getByLabel("代码差异")).toContainText("+const version = 3;");
      await expect(diff.getByLabel("代码差异")).not.toContainText('"diff":');
      await diff.locator("summary").click();
      await page.locator("summary").filter({ hasText: "文件修改" }).click();
      await page.locator("summary").filter({ hasText: "src/CustomerList.tsx" }).click();
      await expect(page.getByLabel("代码差异").first()).toContainText("+const pageSize = 20;");
      await page.screenshot({
        path: "apps/agent-webview/test-results/mcp-approval-" + test.info().project.name + ".png",
        fullPage: true,
      });
      await request.getByRole("button", { name: action!, exact: true }).click();
      await expect(request.getByRole("alert")).toContainText("回复暂时失败");
      await expect(request.getByRole("button", { name: action!, exact: true })).toBeEnabled();
    }
    await request.getByRole("button", { name: action!, exact: true }).click();
    await expect(page.getByText("工具请求已处理：" + expected, { exact: true })).toBeVisible();
    await expect(request).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
});

test("MCP form requires an explicit boolean answer and validates required text", async ({
  page,
}) => {
  await start(page, "?scenario=form");
  const request = page.getByRole("region", { name: "Codex 请求" });
  await request.getByRole("button", { name: "提交信息" }).click();
  await expect(request.getByRole("alert")).toContainText("请填写操作名称");
  await page.getByLabel("操作名称", { exact: false }).fill("预览设计");
  await request.getByRole("button", { name: "提交信息" }).click();
  await expect(request.getByRole("alert")).toContainText("请填写允许覆盖");
  await request.getByRole("radio", { name: "否", exact: true }).click();
  await request.getByRole("button", { name: "提交信息" }).click();
  await expect(page.getByText("工具请求已处理：已允许", { exact: true })).toBeVisible();
});

test("conversation images support selection, removal, failed-send retry and image-only messages", async ({
  page,
}) => {
  await start(page, "?sendError=1");
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer
    .getByLabel("添加对话图片")
    .setInputFiles([imageFile("layout.png"), imageFile("remove.png")]);
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(2);
  await composer.getByRole("button", { name: "移除 remove.png", exact: true }).click();
  await composer.getByLabel("补充需求", { exact: true }).fill("按这张图片调整布局");
  await composer.getByRole("button", { name: "发送补充", exact: true }).click();
  await expect(composer.getByRole("alert")).toContainText("发送暂时失败");
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue("按这张图片调整布局");
  await expect(composer.getByRole("img", { name: "layout.png" })).toBeVisible();
  await page.screenshot({
    path: `apps/agent-webview/test-results/conversation-images-${test.info().project.name}.png`,
    fullPage: true,
  });
  await composer.getByRole("button", { name: "发送补充", exact: true }).click();
  const message = page.locator("article").filter({ hasText: "按这张图片调整布局" });
  await expect(message).toContainText("设计图片");
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(0);
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue("");
  await expect(composer.getByRole("button", { name: /^发送(?:补充)?$/ })).toBeDisabled();
  await composer.getByLabel("添加对话图片").setInputFiles(imageFile("only-image.png"));
  await expect(composer.getByRole("img", { name: "only-image.png" })).toBeVisible();
  await composer.getByRole("button", { name: /^发送(?:补充)?$/ }).click();
  await expect(page.getByLabel("会话消息").getByText("▧ 设计图片", { exact: true })).toHaveCount(2);
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("conversation images support paste and drop while retaining valid attachments after invalid input", async ({
  page,
}) => {
  await start(page);
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer.getByLabel("补充需求", { exact: true }).evaluate((node, base64) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], "pasted.png", {
        type: "image/png",
      }),
    );
    node.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
  }, imageBytes);
  await expect(composer.getByRole("img", { name: "pasted.png" })).toBeVisible();
  await composer.evaluate((node, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([Uint8Array.from(atob(base64), (value) => value.charCodeAt(0))], "dropped.png", {
        type: "image/png",
      }),
    );
    node.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  }, imageBytes);
  await expect(composer.getByRole("img", { name: "dropped.png" })).toBeVisible();
  await composer
    .getByLabel("添加对话图片")
    .setInputFiles({ name: "invalid.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(composer.getByRole("alert")).toContainText("PNG、JPEG 或 WebP");
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(2);
  await composer.getByLabel("添加对话图片").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(composer.getByRole("alert")).toContainText("不超过 5 MiB");
  await composer
    .getByLabel("添加对话图片")
    .setInputFiles([imageFile("3.png"), imageFile("4.png"), imageFile("5.png")]);
  await expect(composer.getByRole("alert")).toContainText("最多添加 4 张图片");
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(2);
  await composer.getByLabel("添加对话图片").setInputFiles([imageFile("3.png"), imageFile("4.png")]);
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(4);
  await expect(composer.getByLabel("添加对话图片")).toBeDisabled();
  await expect(composer.getByRole("alert")).toHaveCount(0);
  await page.getByRole("link", { name: "ui-forge", exact: true }).click();
  await page.getByRole("link", { name: /实现客户列表/ }).click();
  await expect(composer.getByLabel("待发送图片", { exact: true }).locator("img")).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "发送补充", exact: true })).toBeDisabled();
});
