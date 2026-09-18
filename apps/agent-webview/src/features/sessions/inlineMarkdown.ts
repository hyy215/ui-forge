/** 解析消息内常用 Markdown 标记，链接只允许网页或本地文件目的地。 */

/** 保留文本与可呈现的简单标记，不接收 HTML 或任意 URI 协议。 */
export type InlineMarkdownToken =
  | { type: "text" | "code" | "strong"; text: string }
  | { type: "web" | "file"; text: string; href: string };

/** 支持空格、转义及括号文件名；不扫描代码片段内部的链接。 */
export function inlineMarkdown(text: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  const starts = /`[^`\n]+`|\*\*[^*]+\*\*|!?\[[^\]\n]+\]\(/g;
  let cursor = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const part = match[0];
    let token: InlineMarkdownToken | undefined;
    let end = starts.lastIndex;
    if (part.startsWith("`")) token = { type: "code", text: part.slice(1, -1) };
    else if (part.startsWith("**")) token = { type: "strong", text: part.slice(2, -2) };
    else {
      const destination = linkDestination(text, end);
      if (destination) {
        end = destination.end;
        const type = linkType(destination.href);
        if (type)
          token = {
            type,
            text: part.slice(part.startsWith("!") ? 2 : 1, -2),
            href: destination.href,
          };
      }
    }
    if (match.index > cursor) tokens.push({ type: "text", text: text.slice(cursor, match.index) });
    tokens.push(token ?? { type: "text", text: text.slice(match.index, end) });
    starts.lastIndex = cursor = end;
  }
  if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
  return tokens;
}

/** 读取完整链接目的地，避免文件名中的括号截断真实路径。 */
function linkDestination(text: string, start: number): { href: string; end: number } | undefined {
  if (text[start] === "<") {
    const end = text.indexOf(">)", start + 1);
    if (end !== -1 && !text.slice(start, end).includes("\n"))
      return { href: text.slice(start + 1, end), end: end + 2 };
    return undefined;
  }
  let depth = 1;
  let href = "";
  for (let index = start; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\n") return undefined;
    if (character === "\\" && /[()\\]/.test(text[index + 1] ?? "")) {
      href += text[++index];
      continue;
    }
    if (character === "(") depth++;
    if (character === ")" && --depth === 0) return { href, end: index + 1 };
    href += character;
  }
  return undefined;
}

/** 禁止 command、javascript、data、网络共享和页面锚点被当成本地文件。 */
function linkType(href: string): "web" | "file" | undefined {
  if (!href || href !== href.trim() || /[\u0000-\u001f]/.test(href)) return undefined;
  if (/^https?:\/\//i.test(href)) {
    try {
      return new URL(href).hostname ? "web" : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^file:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return !url.hostname && !url.search ? "file" : undefined;
    } catch {
      return undefined;
    }
  }
  if (href.startsWith("//") || href.startsWith("\\\\") || href.startsWith("#")) return undefined;
  const path = href.replace(/(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?)$/, "");
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined;
  return /[/\\]|\.[^/\\\s]+/.test(href) ? "file" : undefined;
}
