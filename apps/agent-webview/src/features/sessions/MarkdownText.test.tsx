import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";
import { inlineMarkdown } from "./inlineMarkdown";
import { SessionFileContext } from "./sessionFileContext";
import { sessionFileRoute } from "@ui-forge/shared-protocol";

it("renders screenshot and report links as real task file URLs while retaining web links", () => {
  const html = renderToStaticMarkup(
    createElement(
      SessionFileContext,
      {
        value: {
          taskId: "t1",
          source: {
            href: (input) => `${sessionFileRoute}?${new URLSearchParams(input)}`,
          },
        },
      },
      createElement(MarkdownText, {
        text: "[打开页面](http://localhost:3000) · [实际截图](/ui-forge/runtime/tmp/project/main/delivered-preview.png)\n\n[完整验收记录](</ui-forge/My Project/验收 (1).md>)",
      }),
    ),
  );
  expect(html).toContain('href="http://localhost:3000"');
  expect(html).toContain(
    'href="/api/session-file?taskId=t1&amp;path=%2Fui-forge%2Fruntime%2Ftmp%2Fproject%2Fmain%2Fdelivered-preview.png"',
  );
  expect(html).toContain("path=%2Fui-forge%2FMy+Project%2F%E9%AA%8C%E6%94%B6+%281%29.md");
  expect(html).toContain(">实际截图</a>");
  expect(html).toContain(">完整验收记录</a>");
  expect(html).not.toContain("[实际截图]");
});

it("handles relative, encoded, file URI, Windows, escaped and balanced filenames with line references", () => {
  const links = [
    "src/App.tsx:12:3",
    "README.md:5",
    "/project/a%20b.png",
    "file:///project/a%20b.md#L5C2",
    "C:\\project\\App.tsx:3",
    "/project/a (b(c)).png",
    "/project/a\\(1\\).png",
  ];
  for (const href of links) {
    const result = inlineMarkdown(`[文件](${href}) 后文`);
    expect(result).toEqual([
      { type: "file", text: "文件", href: href.replace(/\\([()])/g, "$1") },
      { type: "text", text: " 后文" },
    ]);
  }
});

it("keeps unsafe URLs, raw HTML and code examples inert", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "command:workbench.action.closeWindow",
    "vscode://file/project/a",
    "//evil.test/a.png",
    "file://evil.test/a.png",
    "#section",
    "https://",
  ]) {
    expect(inlineMarkdown(`[link](${href})`).every((token) => token.type === "text")).toBe(true);
  }
  const html = renderToStaticMarkup(
    createElement(MarkdownText, {
      text: "`[code](/a.md)`\n\n```md\n[file](/b.md)\n```\n\n<script>alert(1)</script>",
    }),
  );
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

it("preserves partial streaming links until the closing delimiter arrives", () => {
  for (const partial of ["[实际截图](/runtime/file", "[实际截图](</runtime/a b.png>"]) {
    expect(
      inlineMarkdown(partial)
        .map((token) => token.text)
        .join(""),
    ).toBe(partial);
  }
});
