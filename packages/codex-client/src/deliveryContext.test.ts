import { expect, it } from "vitest";
import { join } from "node:path";
import { deliveryContext, deliveryReportPath } from "./deliveryContext.js";

it("isolates same-project task reports without trusting path-like IDs", () => {
  const first = deliveryReportPath("/runtime/tmp/project", "../task");
  const second = deliveryReportPath("/runtime/tmp/project", "other");
  expect(first).toMatch(/^\/runtime\/tmp\/project\/delivery\/[a-f0-9]{64}\/report.json$/);
  expect(first).not.toBe(second);
  expect(first).toBe(deliveryReportPath("/runtime/tmp/project", "../task"));
});
it("provides a task-specific unverified template without granting permissions", () => {
  const context = deliveryContext("/tmp/project", "task-1");
  const value = context.ui_forge_delivery?.value;
  expect(value).toContain(deliveryReportPath("/tmp/project", "task-1"));
  expect(value).toContain("不要写入 delivery/report.json");
  expect(value).toContain("沙箱和审批");
  expect(value).toContain("不知道ID就不填");
  const example = JSON.parse(value?.split("\n").at(-1) ?? "null");
  expect(example.taskId).toBe("task-1");
  expect(example.sourceFiles).toEqual([]);
  expect(example.checks).toHaveLength(5);
  expect(
    example.checks.every(
      (check: { declaredStatus: string }) => check.declaredStatus === "not-verified",
    ),
  ).toBe(true);
  expect(deliveryReportPath("/tmp/project", "task-1")).toContain(join("delivery", ""));
});
