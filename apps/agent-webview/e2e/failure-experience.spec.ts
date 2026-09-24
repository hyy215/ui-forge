/** 验证原生重试、终态失败、手动停止与连接异常互不混淆，不额外启动执行。 */
import { expect, test, type Page } from "@playwright/test";

async function start(page: Page, scenario: string) {
  await page.goto(`/?scenario=${scenario}#/tasks`);
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/failure-project");
  await page.getByLabel("需求说明", { exact: false }).fill("失败体验样本");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
}

test("native retry has no manual continuation and disappears after actual item progress", async ({
  page,
}) => {
  await start(page, "native-retry");
  await expect(page.getByText("Codex 正在重试", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toHaveCount(0);
  await expect(page.getByText("模型暂时繁忙", { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ui-forge:fixture-retry", { detail: "progress" })),
  );
  await expect(page.getByText("原生执行已恢复。", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex 正在重试", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本轮失败", { exact: true })).toHaveCount(0);
});

test("native completion removes an old retry notice without declaring acceptance", async ({
  page,
}) => {
  await start(page, "native-retry");
  await expect(page.getByText("Codex 正在重试", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ui-forge:fixture-retry", { detail: "complete" })),
  );
  await expect(page.getByText("本轮已结束", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex 正在重试", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toHaveCount(0);
  await expect(page.getByText("验收通过", { exact: true })).toHaveCount(0);
});

test("child-thread retry is not promoted to the main task", async ({ page }) => {
  await start(page, "child-retry");
  await expect(page.getByText("运行中", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex 正在重试", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toHaveCount(0);
});

test("connection loss does not declare the running task failed or stopped", async ({ page }) => {
  await start(page, "native-retry");
  await expect(page.getByText("Codex 正在重试", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ui-forge:fixture-retry", { detail: "disconnect" })),
  );
  await expect(page.getByText("连接异常，后台任务状态尚未确认", { exact: true })).toBeVisible();
  await expect(
    page.getByText("这仅表示客户端连接异常，不代表后台任务停止或失败。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("本轮失败", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本轮已停止", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Codex 正在重试", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续当前任务", exact: true })).toHaveCount(0);
});

test("explicit stop preserves records and is not displayed as failure", async ({ page }) => {
  await start(page, "native-retry");
  await expect(page.getByText("Codex 正在重试", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止本轮", exact: true }).click();
  await expect(page.getByText("本轮已停止，已有记录仍保留。", { exact: true })).toBeVisible();
  await expect(
    page.getByText("停止不代表验收失败；已有文件和验证记录需要按当前工作区核对。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Codex 正在重试", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本轮失败", { exact: true })).toHaveCount(0);
});
