import { expect, it } from "vitest";
import type { NativeTurn } from "@ui-forge/shared-protocol";
import { summarizeRecordedWork } from "./recordedWork.js";

const turn = (id: string, items: NativeTurn["items"]): NativeTurn => ({
  id,
  items,
  status: "failed",
  error: null,
});

it("counts recorded outcomes without inferring acceptance or the live filesystem", () => {
  const result = summarizeRecordedWork([
    turn("one", [
      { id: "a", type: "commandExecution", status: "completed", exitCode: 0 },
      { id: "b", type: "commandExecution", status: "completed", exitCode: 1 },
      { id: "c", type: "commandExecution", status: "completed", exitCode: null },
      { id: "d", type: "commandExecution", status: "inProgress", exitCode: 0 },
      { id: "e", type: "fileChange", status: "completed", changes: [{ path: "a" }, { path: "b" }] },
      { id: "f", type: "fileChange", status: "declined", changes: [{ path: "c" }] },
      { id: "g", type: "fileChange", status: "completed", changes: [] },
      { id: "h", type: "mcpToolCall", status: "completed" },
      { id: "i", type: "agentMessage", text: "All tests passed" },
    ]),
  ]);
  expect(result).toContain("1 条命令成功退出，1 条已完成文件变更");
  expect(result).toContain("不代表当前文件状态或验收通过");
});

it("deduplicates native identities while preserving equal item IDs in different turns", () => {
  const command = { id: "same", type: "commandExecution", status: "completed", exitCode: 0 };
  expect(
    summarizeRecordedWork([turn("one", [command, command]), turn("two", [command])]),
  ).toContain("2 条命令成功退出");
});

it("never equates incomplete or empty history to an unchanged workspace", () => {
  expect(summarizeRecordedWork([])).toContain("不代表工作区没有改动");
  expect(
    summarizeRecordedWork([turn("one", [{ id: "file", type: "fileChange", status: "completed" }])]),
  ).toContain("未记录");
});
