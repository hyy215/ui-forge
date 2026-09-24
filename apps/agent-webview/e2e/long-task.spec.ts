/** 长任务观测只更新页面；停止请求回执不冒充原生停止，也不自动补发请求。 */
import { expect, test, type Page } from "@playwright/test";
import { sessionMethods } from "@ui-forge/shared-protocol";

async function requests(page: Page) {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, "uiForgeRuntimeRequests");
    return Array.isArray(value)
      ? value.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];
  });
}

async function control(page: Page, action: string, kind = "runtime") {
  await page.evaluate(
    ({ action, kind }) => {
      window.dispatchEvent(new CustomEvent(`ui-forge:fixture-${kind}`, { detail: action }));
    },
    { action, kind },
  );
}

async function start(page: Page, scenario = "long-task") {
  await page.clock.install({ time: new Date("2026-09-23T00:00:00.000Z") });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Reflect.set(window, "uiForgeRuntimeRequests", calls);
    window.addEventListener("ui-forge:fixture-request", (event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string")
        calls.push(event.detail);
    });
  });
  await page.goto(`/?scenario=${scenario}#/tasks`);
  await page.getByLabel("目标工作区", { exact: true }).fill("/tmp/runtime-project");
  await page.getByLabel("需求说明", { exact: false }).fill("长任务运行信息测试");
  await page.getByRole("button", { name: "开始执行任务 ↗", exact: true }).click();
  await expect(page.getByRole("region", { name: "运行信息", exact: true })).toBeVisible();
}

test("long task clock and main-thread observations stay local and reconnect as unknown", async ({
  page,
}) => {
  await start(page);
  const elapsed = page.getByTestId("runtime-elapsed");
  const activity = page.getByTestId("runtime-activity");
  const tokens = page.getByTestId("runtime-tokens");
  await expect(elapsed).toHaveText(/^2分\d{2}秒$/);
  await expect(tokens).toHaveText("未知");
  await expect(activity).toHaveText("本次连接暂未收到新活动");
  const beforeCalls = await requests(page);
  const beforeElapsed = await elapsed.textContent();
  await page.clock.fastForward(10_000);
  await expect(elapsed).not.toHaveText(beforeElapsed ?? "");
  expect(await requests(page)).toEqual(beforeCalls);
  await control(page, "child-token");
  await control(page, "child-activity");
  await expect(tokens).toHaveText("未知");
  await expect(activity).toHaveText("本次连接暂未收到新活动");
  await control(page, "main-token");
  await expect(tokens).toContainText("1,200");
  await control(page, "main-token");
  await control(page, "child-token");
  await expect(tokens).toContainText("1,200");
  await expect(tokens).not.toContainText("2,400");
  await control(page, "main-activity");
  await expect(activity).toContainText("前收到活动");
  await control(page, "waiting-approval");
  await expect(activity).toHaveText("等待审批");
  await expect(page.getByText("等待确认", { exact: true })).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(activity).toHaveText("等待审批");
  await control(page, "waiting-input");
  await expect(activity).toHaveText("等待用户输入");
  await control(page, "disconnect");
  await expect(elapsed).toHaveText("未知（连接中断）");
  await expect(page.getByRole("button", { name: "停止本轮", exact: true })).toBeDisabled();
  await page.clock.fastForward(60_000);
  await expect(elapsed).toHaveText("未知（连接中断）");
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(tokens).toHaveText("未知");
  await expect(activity).toHaveText("等待用户输入");
  expect(await requests(page)).toEqual(beforeCalls);
  const timeline = page.getByLabel("会话消息", { exact: true });
  expect((await timeline.boundingBox())?.height).toBeGreaterThanOrEqual(95);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `apps/agent-webview/test-results/long-task-${test.info().project.name}.png`,
  });
});

test("missing native start remains unknown while explicit terminal observations use fixed timestamps", async ({
  page,
}) => {
  await start(page, "long-task-unknown");
  await expect(page.getByTestId("runtime-elapsed")).toHaveText("未知");
  await page.clock.fastForward(30_000);
  await expect(page.getByTestId("runtime-elapsed")).toHaveText("未知");
  await control(page, "main-activity");
  await control(page, "interrupt");
  const activity = page.getByTestId("runtime-activity");
  await expect(activity).toContainText("最后收到于");
  const recorded = await activity.textContent();
  await page.clock.fastForward(60_000);
  await expect(activity).toHaveText(recorded ?? "");
  await expect(page.getByTestId("runtime-elapsed")).toHaveText("未知");
  expect((await requests(page)).filter((method) => method === sessionMethods.stop)).toHaveLength(0);
});

test("pending requests distinguish ordinary responses, explicit approval and user input", async ({
  page,
}) => {
  await start(page);
  const activity = page.getByTestId("runtime-activity");
  const before = await requests(page);
  for (const action of ["pending-clock", "pending-tool"]) {
    await control(page, action);
    await expect(activity).toHaveText("等待响应");
    await expect(activity).not.toHaveText("等待审批");
  }
  for (const action of [
    "pending-command-approval",
    "pending-file-approval",
    "pending-permission-approval",
    "pending-legacy-command",
    "pending-legacy-patch",
  ]) {
    await control(page, action);
    await expect(activity).toHaveText("等待审批");
  }
  await control(page, "pending-user-input");
  await expect(activity).toHaveText("等待用户输入");
  await page.clock.fastForward(60_000);
  await expect(activity).toHaveText("等待用户输入");
  expect(await requests(page)).toEqual(before);
});

test("delayed stop is submitted once and only native completion confirms it", async ({ page }) => {
  await start(page);
  const draft = page.getByLabel("补充需求", { exact: true });
  await draft.fill("停止时仍保留这条草稿");
  const button = page.getByRole("button", { name: "停止本轮", exact: true });
  await button.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      element.click();
      element.click();
    }
  });
  await expect(
    page.getByText("正在发送停止请求，尚未确认本轮停止。", { exact: true }),
  ).toBeVisible();
  expect((await requests(page)).filter((method) => method === sessionMethods.stop)).toHaveLength(1);
  await expect(page.getByText("运行中", { exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  expect((await requests(page)).filter((method) => method === sessionMethods.stop)).toHaveLength(1);
  await control(page, "accept", "stop");
  await expect(
    page.getByText("停止请求已提交，等待 Codex 确认。本轮仍以原生状态为准。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("本轮已停止", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "停止请求已提交", exact: true }),
  ).toBeDisabled();
  await expect(draft).toHaveValue("停止时仍保留这条草稿");
  await control(page, "interrupt");
  await expect(page.getByText("本轮已停止", { exact: true })).toBeVisible();
  await expect(
    page.getByText("停止请求已提交，等待 Codex 确认。本轮仍以原生状态为准。", { exact: true }),
  ).toHaveCount(0);
  await expect(draft).toHaveValue("停止时仍保留这条草稿");
  await expect(page.getByText("本轮失败", { exact: true })).toHaveCount(0);
});

test("uncertain stop keeps the draft and late receipts cannot attach to a new turn", async ({
  page,
}) => {
  await start(page);
  const draft = page.getByLabel("补充需求", { exact: true });
  await draft.fill("核对状态后再决定是否继续");
  await page.getByRole("button", { name: "停止本轮", exact: true }).click();
  await control(page, "reject", "stop");
  await expect(
    page.getByText("停止请求未确认，请先核对当前状态，勿重复提交。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture stop response unavailable.", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("停止请求详情", { exact: true }).click();
  await expect(page.getByText("Fixture stop response unavailable.", { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("核对状态后再决定是否继续");
  await page.clock.fastForward(60_000);
  expect((await requests(page)).filter((method) => method === sessionMethods.stop)).toHaveLength(1);
  await page.getByRole("button", { name: "再次请求停止", exact: true }).click();
  await control(page, "next-turn");
  await expect(page.getByText("正在发送停止请求，尚未确认本轮停止。", { exact: true })).toHaveCount(
    0,
  );
  await control(page, "accept", "stop");
  await expect(page.getByRole("button", { name: "停止本轮", exact: true })).toBeEnabled();
  await expect(
    page.getByText("停止请求已提交，等待 Codex 确认。本轮仍以原生状态为准。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("运行中", { exact: true })).toBeVisible();
  await expect(draft).toHaveValue("核对状态后再决定是否继续");
  expect((await requests(page)).filter((method) => method === sessionMethods.stop)).toHaveLength(2);
  expect((await requests(page)).filter((method) => method === sessionMethods.send)).toHaveLength(0);
});
