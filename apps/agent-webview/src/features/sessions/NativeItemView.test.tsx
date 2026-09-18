import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NativeItemView } from "./NativeItemView";
import { PendingRequestPanel } from "./PendingRequestPanel";

it("omits empty reasoning and empty assistant messages", () => {
  expect(
    renderToStaticMarkup(
      createElement(NativeItemView, {
        item: { id: "empty", type: "reasoning", summary: [], content: [] },
      }),
    ),
  ).toBe("");
  expect(
    renderToStaticMarkup(
      createElement(NativeItemView, { item: { id: "empty", type: "agentMessage", text: "" } }),
    ),
  ).toBe("");
});
it("renders command output as text and preserves failed status without a JSON envelope", () => {
  const html = renderToStaticMarkup(
    createElement(NativeItemView, {
      item: {
        id: "c",
        type: "commandExecution",
        command: "npm test",
        status: "failed",
        cwd: "/project",
        aggregatedOutput: "one\n<script>two</script>",
        exitCode: 1,
      },
    }),
  );
  expect(html).toContain("npm test");
  expect(html).toContain("退出码 1");
  expect(html).toContain("失败");
  expect(html).toContain("&lt;script&gt;two&lt;/script&gt;");
  expect(html).not.toContain("aggregatedOutput");
  expect(html).not.toContain("原始输出");
});
it("shows MCP approval buttons for the screenshot's empty schema without a JSON editor", () => {
  const html = renderToStaticMarkup(
    createElement(PendingRequestPanel, {
      pending: {
        token: "mcp",
        request: {
          id: 1,
          method: "mcpServer/elicitation/request",
          params: {
            threadId: "t",
            turnId: "turn",
            serverName: "playwright",
            mode: "form",
            message: 'Run tool "browser_click"',
            requestedSchema: { type: "object", properties: {} },
            _meta: { tool_params_display: [{ name: "element", value: "在浏览器打开设计" }] },
          },
        },
      },
      onRespond: async () => undefined,
    }),
  );
  expect(html).toContain("在浏览器打开设计");
  expect(html).toContain("允许本次");
  expect(html).toMatch(/拒\s*绝/);
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("响应内容（JSON）");
});
