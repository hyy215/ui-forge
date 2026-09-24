/** 验证交付声明、证据与源码状态独立展示，读取和失败重试不启动任务。 */
import { expect, test, type Page } from "@playwright/test";
import { deliveryMethods, sessionMethods } from "@ui-forge/shared-protocol";

async function requests(page: Page) {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, "uiForgeDeliveryRequests");
    return Array.isArray(value)
      ? value.filter((item: unknown): item is string => typeof item === "string")
      : [];
  });
}

async function start(page: Page, scenario = "delivery", query = "") {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Reflect.set(window, "uiForgeDeliveryRequests", calls);
    window.addEventListener("ui-forge:fixture-request", (event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string")
        calls.push(event.detail);
    });
  });
  await page.goto(`/?scenario=${scenario}${query}#/tasks`);
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/delivery-project");
  await page.getByLabel("需求说明", { exact: false }).fill("交付记录测试");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByText("本轮已结束", { exact: true })).toBeVisible();
}

test("completed execution keeps declarations separate from evidence and source checks", async ({
  page,
}) => {
  await start(page);
  const before = await requests(page);
  expect(before).not.toContain(deliveryMethods.read);
  const entry = page.getByRole("button", { name: "查看交付结果", exact: true });
  await expect(entry).toContainText("交付结果");
  await expect(entry.getByText("交付结果", { exact: true })).toBeVisible();
  const header = page.locator("header").filter({ has: entry });
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await entry.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await entry.evaluate((element) => {
      const buttonBounds = element.getBoundingClientRect();
      const headerBounds = element.closest("header")?.getBoundingClientRect();
      if (!headerBounds) return false;
      return (
        headerBounds.left >= 0 &&
        headerBounds.right <= innerWidth &&
        buttonBounds.left >= headerBounds.left &&
        buttonBounds.right <= headerBounds.right &&
        buttonBounds.top >= headerBounds.top &&
        buttonBounds.bottom <= headerBounds.bottom
      );
    }),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await header.screenshot({
    path: `apps/agent-webview/test-results/delivery-entry-${test.info().project.name}.png`,
  });
  const composer = page.getByRole("form", { name: "发送消息" });
  await composer.getByLabel("补充需求", { exact: true }).fill("交付核对期间保留草稿");
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "交付结果" });
  const conclusions = dialog.getByRole("region", { name: "报告结论", exact: true });
  await expect(conclusions.getByText("声明通过", { exact: true })).toBeVisible();
  await expect(conclusions.getByText("声明失败", { exact: true })).toBeVisible();
  await expect(conclusions.getByText("声明受阻", { exact: true })).toBeVisible();
  await expect(conclusions.getByText("声明未验证", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "证据缺口", exact: true })).toHaveCount(0);
  await expect(dialog.getByText("所列文件一致", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("仅核对报告列出的文件，不代表整个项目一致。", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("内容指纹", { exact: true }).click();
  await expect(dialog.getByText("源码清单指纹（非全项目版本）", { exact: false })).toBeVisible();
  await expect(dialog.getByText("d".repeat(64), { exact: true })).toBeVisible();
  await expect(dialog.getByText("a".repeat(64), { exact: true })).toBeVisible();
  const evidence = dialog.getByRole("region", { name: "证据核对", exact: true });
  await expect(evidence.getByText("工具执行成功", { exact: true })).toBeVisible();
  await expect(evidence.getByText("文件指纹一致", { exact: true })).toBeVisible();
  await expect(evidence.getByRole("link")).toHaveCount(1);
  await expect(evidence.getByRole("link")).toHaveAttribute(
    "href",
    /taskId=demo-0&path=%2Fui-forge%2Fruntime/,
  );
  await expect(dialog.getByText("验收通过", { exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({
    path: `apps/agent-webview/test-results/delivery-${test.info().project.name}.png`,
  });
  await dialog.getByRole("button", { name: "刷新证据核对", exact: true }).click();
  await expect
    .poll(
      async () => (await requests(page)).filter((method) => method === deliveryMethods.read).length,
    )
    .toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(composer.getByLabel("补充需求", { exact: true })).toHaveValue(
    "交付核对期间保留草稿",
  );
  expect((await requests(page)).filter((method) => method !== deliveryMethods.read)).toEqual(
    before,
  );
});

for (const [scenario, title] of [
  ["delivery-missing", "暂无交付报告，验收未验证。"],
  ["delivery-invalid", "交付报告无效，无法确认验收。"],
] as const) {
  test(`${scenario} never treats an ended task as accepted`, async ({ page }) => {
    await start(page, scenario);
    await page.getByRole("button", { name: "查看交付结果", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "交付结果" });
    await expect(dialog.getByText(title, { exact: true })).toBeVisible();
    await expect(dialog.getByText("声明通过", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: "证据缺口", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("link")).toHaveCount(0);
    expect(await requests(page)).not.toContain(sessionMethods.send);
  });
}

test("stale source preserves the historical declaration and requires verification again", async ({
  page,
}) => {
  await start(page, "delivery-stale");
  await page.getByRole("button", { name: "查看交付结果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "交付结果" });
  await expect(dialog.getByText("源码已变化，需要重新验证", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("保留报告原结论；该结论不能用于当前源码。", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("声明通过", { exact: true })).toBeVisible();
  await expect(dialog.getByText("所列文件一致", { exact: true })).toHaveCount(0);
});

test("missing evidence cannot expose a file link or imply its contents passed", async ({
  page,
}) => {
  await start(page, "delivery-missing-evidence");
  await page.getByRole("button", { name: "查看交付结果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "交付结果" });
  await expect(dialog.getByText("证据缺失", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(0);
});

test("reports evidence gaps without rewriting declarations, adding actions or overflowing", async ({
  page,
}) => {
  await start(page, "delivery-gaps");
  const before = await requests(page);
  await page.getByRole("button", { name: "查看交付结果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "交付结果" });
  const gaps = dialog.getByRole("region", { name: "证据缺口", exact: true });
  await expect(gaps).toBeVisible();
  await expect(gaps.getByRole("listitem")).toHaveCount(2);
  await expect(gaps).toContainText("未记录审查检查");
  await expect(gaps).toContainText("未提供证据");
  await expect(gaps.getByRole("button")).toHaveCount(0);
  await expect(gaps.getByRole("link")).toHaveCount(0);
  const conclusions = dialog.getByRole("region", { name: "报告结论", exact: true });
  await expect(conclusions.getByText("声明通过", { exact: true })).toBeVisible();
  await expect(conclusions.getByText("声明失败", { exact: true })).toBeVisible();
  await expect(conclusions.getByText("声明受阻", { exact: true })).toBeVisible();
  const evidence = dialog.getByRole("region", { name: "证据核对", exact: true });
  await expect(
    evidence.getByText("未提供证据，无法独立核对。", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByText("验收通过", { exact: true })).toHaveCount(0);
  expect(await gaps.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await gaps.screenshot({
    path: `apps/agent-webview/test-results/delivery-gaps-${test.info().project.name}.png`,
  });
  expect(await requests(page)).toEqual([...before, deliveryMethods.read]);
});

test("failed refresh retains a labelled previous result and closes during an in-flight read", async ({
  page,
}) => {
  await start(page, "delivery", "&deliveryFailAt=1,3&deliveryDelay=300");
  await page.getByRole("button", { name: "查看交付结果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "交付结果" });
  await expect(dialog.getByText("交付结果读取失败，请重试。", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("private delivery transport details");
  await expect(dialog.getByText("声明通过", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(dialog.getByText("声明通过", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "刷新证据核对", exact: true }).click();
  await expect(
    dialog.getByText("仍显示上次核对结果，当前证据与源码状态尚未确认。", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await requests(page)).not.toContain(sessionMethods.send);
});
