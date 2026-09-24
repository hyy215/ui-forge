/** 保持历史工具展开状态与流式正文、审批、停止展示，不以性能门槛代替功能断言。 */
import { expect, test } from "@playwright/test";

test("history tools stay expanded while new text streams and requests resolve", async ({
  page,
}) => {
  await page.goto("/fixtures/benchmark.html?historyItems=100#/tasks?taskId=benchmark-task");
  const timeline = page.getByLabel("会话消息", { exact: true });
  await expect(
    timeline.locator(":scope > section > article, :scope > section > details"),
  ).toHaveCount(101);
  const history = timeline.locator(":scope > section").nth(24);
  const command = history.locator(":scope > details").nth(0);
  const file = history.locator(":scope > details").nth(1);
  await command.locator(":scope > summary").click();
  await expect(command.getByText("Simulated check completed.", { exact: false })).toBeVisible();
  await file.locator(":scope > summary").click();
  const patch = file.locator("details");
  await patch.locator("summary").click();
  await expect(patch.getByText("+const sample = true;", { exact: false })).toBeVisible();
  const draft = page.getByLabel("补充需求", { exact: true });
  await draft.fill("保留草稿与展开的历史记录");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ui-forge:benchmark-control", {
        detail: { action: "stream", count: 100, intervalMs: 20 },
      }),
    ),
  );
  const active = timeline.locator("article").last();
  await expect(active).toContainText("stream-end-100");
  for (const details of [command, file, patch]) await expect(details).toHaveAttribute("open", "");
  await expect(draft).toHaveValue("保留草稿与展开的历史记录");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ui-forge:benchmark-control", {
        detail: { action: "approval" },
      }),
    ),
  );
  const request = page.getByRole("region", { name: "Codex 请求", exact: true });
  await request.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(request).toHaveCount(0);
  await page.getByRole("button", { name: "停止本轮", exact: true }).click();
  await expect(page.getByText("本轮已停止", { exact: true })).toBeVisible();
  await expect(active).toContainText("stream-end-100");
  await expect(draft).toHaveValue("保留草稿与展开的历史记录");
  for (const details of [command, file, patch]) await expect(details).toHaveAttribute("open", "");
});
