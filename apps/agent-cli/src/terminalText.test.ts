import { expect, it } from "vitest";
import { terminalText } from "./terminalText.js";

it("preserves ordinary Unicode text and line breaks", () => {
  expect(terminalText("任务失败\n检查已有结果\n")).toBe("任务失败\n检查已有结果\n");
});

it("removes ANSI styling, cursor operations, OSC clipboard and hyperlinks", () => {
  expect(terminalText("\u001b[31m错误\u001b[0m\u001b[2J\u001b]52;c;c2VjcmV0\u0007")).toBe("错误");
  expect(terminalText("\u001b]8;;https://example.test\u001b\\链接\u001b]8;;\u001b\\")).toBe("链接");
});

it("removes C0/C1 characters, backspace and carriage return instead of rewriting output", () => {
  expect(terminalText("前\u0000\u0008\t\r\u007f\u0085\u009b后\n")).toBe("前后\n");
});

it("does not leave an executable escape character when a stream splits control sequences", () => {
  const output = ["前\u001b", "[2J后"].map(terminalText).join("");
  expect(output).not.toContain("\u001b");
  expect(output).toContain("后");
});
