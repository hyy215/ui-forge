/** 通过脱敏 Fixture 验证 Webview 核心任务交互在浏览器中保持可完成。 */

import { expect, test } from "@playwright/test";

test("completes the design review interaction without external services", async ({ page }, testInfo) => {
  const unexpectedExternalRequests = new Set<string>();
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    unexpectedExternalRequests.add(url.href);
    await route.abort("blockedbyclient");
  });

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /从设计稿到.*可审阅的代码 Patch/ })).toBeVisible();
    await page.getByRole("button", { name: "开始分析设计" }).click();
    const workflowHeading = page.getByRole("heading", { name: "生成前端视图" });
    await expect(workflowHeading).toBeVisible();
    if (testInfo.project.name === "narrow-chromium") {
      expect((await workflowHeading.boundingBox())?.width).toBeGreaterThan(180);
    }

    const composer = page.getByPlaceholder("粘贴 MasterGo 页面或节点链接");
    await composer.fill("https://mastergo.com/file/e2e?layer_id=1:2");
    await expect(page.getByRole("button", { name: "读取设计" })).toBeEnabled();
    await composer.press("Enter");

    const confirmationComposer = page.getByPlaceholder("输入“确认设计”开始分析");
    await expect(confirmationComposer).toBeVisible();
    await expect(page.getByText("等待确认设计", { exact: true })).toBeVisible();

    const isNarrow = testInfo.project.name === "narrow-chromium";
    const resultsPanel = page.getByRole("complementary", { name: "设计与分析结果" });
    if (isNarrow) {
      const resultsToggle = page.getByRole("button", { name: "查看设计与分析结果" });
      await resultsToggle.click();
      await expect(resultsPanel).toBeVisible();
      await expect(page.getByRole("img", { name: "客户列表 SVG 预览" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(resultsPanel).toBeHidden();
      await expect(resultsToggle).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(page.getByRole("img", { name: "客户列表 SVG 预览" })).toBeVisible();
    }

    await confirmationComposer.fill("确认");
    await page.getByRole("button", { name: "发送确认口令" }).click();
    await expect(page.getByText("请输入完整口令“确认设计”以开始分析。")).toBeVisible();

    await confirmationComposer.fill("确认设计");
    await confirmationComposer.press("Enter");
    await expect(page.getByText("方案已生成", { exact: true })).toBeVisible();

    if (isNarrow) {
      await page.getByRole("button", { name: "查看设计与分析结果" }).click();
      await expect(resultsPanel).toBeVisible();
    }
    await expect(page.getByText("根据当前设计证据生成客户列表审阅方案。")).toBeVisible();
    await expect(page.getByText("搭建客户列表页面结构")).toBeVisible();
    await expect(page.getByText("布局与交互理解")).toBeVisible();
    await page.getByRole("button", { name: "按此方案生成代码" }).click();
    await expect(page.getByText("候选 Patch 已生成但尚未应用")).toBeVisible();
    await expect(page.getByRole("button", { name: "展开整体修改方案" })).toBeVisible();
    await expect(page.getByText("布局与交互理解")).toBeHidden();
    await expect(page.getByText("验收条件状态")).toBeVisible();
    await expect(page.getByText("页面结构与设计区域一致")).toBeVisible();
    await expect(page.getByText("0 项已验证 · 1 项待验证")).toBeVisible();
    await expect(page.getByText("create src/CustomerList.tsx").last()).toBeVisible();
    await page.getByRole("button", { name: "展开整体修改方案" }).click();
    await expect(page.getByText("布局与交互理解")).toBeVisible();

    if (isNarrow) {
      await page.getByRole("button", { name: "关闭结果浮层" }).click();
      await expect(resultsPanel).toBeHidden();
    }
    await page.getByRole("button", { name: "重新选择设计" }).click();
    await expect(page.getByPlaceholder("粘贴 MasterGo 页面或节点链接")).toBeVisible();
    await expect(page.getByText("等待 Design URL", { exact: true })).toBeVisible();
  } finally {
    expect([...unexpectedExternalRequests], "Fixture E2E 不得访问模型、MasterGo 或其他外部服务").toEqual([]);
  }
});
