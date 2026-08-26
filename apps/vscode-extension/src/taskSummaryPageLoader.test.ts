/** 验证侧边栏分页加载会在刷新或 Workspace 切换后丢弃过期结果。 */

import { describe, expect, it, vi } from "vitest";
import type { D2CTaskSummaryPage } from "@ui-forge/shared-protocol";
import { loadTaskSummaryPages } from "./taskSummaryPageLoader.js";

describe("loadTaskSummaryPages", () => {
  it("collects every page while the load generation remains current", async () => {
    const listTasks = vi.fn()
      .mockResolvedValueOnce(createPage("first", "next"))
      .mockResolvedValueOnce(createPage("second", null));

    await expect(loadTaskSummaryPages({ listTasks }, () => true)).resolves.toMatchObject([
      { displayName: "first" },
      { displayName: "second" },
    ]);
    expect(listTasks).toHaveBeenNthCalledWith(2, {
      includeArchived: true,
      cursor: "next",
    });
  });

  it("drops a response that became stale while its page request was pending", async () => {
    let current = true;
    const listTasks = vi.fn(async () => {
      current = false;
      return createPage("old workspace", "next");
    });

    await expect(loadTaskSummaryPages({ listTasks }, () => current)).resolves.toBeUndefined();
    expect(listTasks).toHaveBeenCalledTimes(1);
  });
});

/** 创建分页加载测试所需的最小合法响应。 */
function createPage(displayName: string, nextCursor: string | null): D2CTaskSummaryPage {
  return {
    items: [{
      taskId: "11111111-1111-4111-8111-111111111111",
      displayName,
      status: "draft",
      revision: 1,
      stage: "design",
      attention: "required",
      nextAction: "填写设计地址",
      updatedAt: "2026-08-28T00:00:00.000Z",
    }],
    nextCursor,
  };
}
