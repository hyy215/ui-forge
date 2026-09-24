/** 在随机 loopback 端口检查 VSIX 生产页面及真实消息桥；只读宿主替身不连接后端或模型。 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  communicationCapabilities,
  communicationInboundMessageSchema,
  communicationTransportMethods,
  createSuccessfulCommunicationResponseMessage,
  currentCommunicationProtocolVersion,
  instructionDocumentSchema,
  instructionMethods,
  listSessionsSchema,
  negotiateCommunicationProtocolInputSchema,
  readInstructionSchema,
  sessionMethods,
  taskHistoryPageSchema,
} from "@ui-forge/shared-protocol";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const workspacePath = "/ui-forge-smoke/workspace";

/** 只接受一个暂存目录及可选截图目录，避免拼错选项时验证错误产物。 */
function parseArguments(args) {
  const [staging, ...options] = args;
  if (!staging || staging.startsWith("--")) {
    throw new Error("用法：node smoke-webview.mjs <staging> [--screenshots <目录>]");
  }
  if (
    options.length !== 0 &&
    (options.length !== 2 || options[0] !== "--screenshots" || !options[1])
  ) {
    throw new Error("仅支持 --screenshots <目录>。");
  }
  return { staging: resolve(staging), screenshots: options[1] ? resolve(options[1]) : null };
}

/** 以真实路径比较范围，拒绝经符号链接逃离包目录或把截图写回待验包。 */
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** 创建截图目录前解析已有祖先，避免链接指向待验包时先写目录再报错。 */
async function prepareScreenshots(staging, requested) {
  let ancestor = requested;
  let actualAncestor;
  for (;;) {
    try {
      actualAncestor = await realpath(ancestor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
      ancestor = dirname(ancestor);
    }
  }
  const destination = resolve(actualAncestor, relative(ancestor, requested));
  assert.ok(!isWithin(staging, destination), "截图必须保存在暂存目录之外");
  await mkdir(destination, { recursive: true });
  const actual = await realpath(destination);
  assert.ok(!isWithin(staging, actual), "截图目录不能经符号链接指向暂存目录");
  return actual;
}

/** 对 HTML 注入与 Extension 一致的 CSP 和工作区上下文，但不改变生产入口。 */
function hostHtml(html) {
  assert.ok(html.includes("<head>"), "生产 HTML 缺少 head");
  assert.ok(html.includes('<meta charset="UTF-8" />'), "生产 HTML 缺少宿主注入锚点");
  const nonce = randomBytes(16).toString("base64");
  const context = JSON.stringify({ projectPath: workspacePath }).replaceAll("<", "\\u003c");
  return html
    .replace("<head>", '<head><base href="/">')
    .replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; font-src 'self';"><script nonce="${nonce}">window.uiForgeHost=${context};</script>`,
    );
}

/** 启动仅提供真实生产文件的本机静态服务；没有 API 代理或 SPA 任意路径回退。 */
async function serveWebview(root, problems) {
  const index = await realpath(join(root, "index.html"));
  assert.ok(isWithin(root, index), "生产 HTML 不在包内");
  const html = hostHtml(await readFile(index, "utf8"));
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET") {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (pathname === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      const candidate = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!isWithin(root, candidate)) throw new Error(`资源路径越界：${pathname}`);
      const file = await realpath(candidate);
      if (!isWithin(root, file) || !(await stat(file)).isFile()) {
        throw new Error(`资源不在包内：${pathname}`);
      }
      const content = file === index ? html : await readFile(file);
      response.writeHead(200, {
        "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(content);
    })().catch((error) => {
      problems.push(`静态资源：${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(404);
      response.end();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "无法读取临时服务端口");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** 白名单宿主仅返回只读样本；任何任务执行、规则保存或额外通信都使冒烟失败。 */
function createHostStub() {
  const requests = [];
  let negotiated = false;
  return {
    requests,
    respond(input) {
      const message = communicationInboundMessageSchema.parse(input);
      assert.equal(message.kind, "request", "冒烟不允许流或通知");
      requests.push({ method: message.method, params: message.params });
      let data;
      if (message.method === communicationTransportMethods.negotiateProtocol) {
        const params = negotiateCommunicationProtocolInputSchema.parse(message.params);
        assert.equal(params.protocolVersion, currentCommunicationProtocolVersion);
        assert.deepEqual(
          [...params.requiredCapabilities].sort(),
          [...communicationCapabilities].sort(),
        );
        negotiated = true;
        data = {
          protocolVersion: currentCommunicationProtocolVersion,
          capabilities: [...communicationCapabilities],
        };
      } else {
        assert.ok(negotiated, "业务请求必须先完成协议协商");
        if (message.method === sessionMethods.list) {
          listSessionsSchema.parse(message.params);
          data = taskHistoryPageSchema.parse({ tasks: [], nextOffset: null });
        } else if (message.method === instructionMethods.read) {
          const { kind } = readInstructionSchema.parse(message.params);
          data = instructionDocumentSchema.parse({
            kind,
            path: `/ui-forge-smoke/instructions/${kind}.md`,
            content: `# ${kind} production smoke\n\nRead-only smoke content.\n`,
            revision: `smoke-${kind}`,
          });
        } else {
          throw new Error(`冒烟禁止宿主操作：${message.method}`);
        }
      }
      return createSuccessfulCommunicationResponseMessage(message.requestId, data);
    },
  };
}

/** 在一组视口下走真实生产路由与消息桥；截图仅包含合成的只读输入。 */
async function checkViewport(browser, origin, name, viewport, screenshots, problems) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const host = createHostStub();
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        problems.push(`阻止包外网络：${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    await context.routeWebSocket("**/*", async (socket) => {
      problems.push(`阻止 WebSocket：${socket.url()}`);
      await socket.close();
    });
    await context.exposeBinding("__uiForgeSmokeHost", (_source, message) => {
      try {
        return host.respond(message);
      } catch (error) {
        problems.push(`宿主协议：${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    });
    await context.addInitScript(() => {
      let acquired = false;
      window.acquireVsCodeApi = () => {
        if (acquired) throw new Error("VS Code API 被重复获取");
        acquired = true;
        return {
          postMessage: (message) => {
            void window
              .__uiForgeSmokeHost(message)
              .then((data) => window.dispatchEvent(new MessageEvent("message", { data })))
              .catch((error) => {
                setTimeout(() => {
                  throw error;
                }, 0);
              });
          },
        };
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`页面异常：${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`页面控制台：${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      problems.push(`资源请求失败：${request.url()} ${request.failure()?.errorText ?? ""}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        problems.push(`资源状态 ${response.status()}：${response.url()}`);
    });
    await page.goto(`${origin}/#/`, { waitUntil: "networkidle" });
    await expect(page.getByText("还没有任务，从一份设计开始", { exact: true })).toBeVisible();
    await expect(page.locator(".fixture-banner")).toHaveCount(0);
    await page.getByRole("link", { name: "新建任务", exact: true }).click();
    await expect(page.getByRole("heading", { name: "从这份设计开始。" })).toBeVisible();
    await expect(page.getByLabel("目标工作区", { exact: true })).toHaveValue(workspacePath);
    await expect(page.getByLabel("目标工作区", { exact: true })).toHaveAttribute("readonly", "");
    await page.getByLabel("需求说明").fill("Production smoke only; do not execute.");
    await expect(page.getByRole("button", { name: "开始执行任务" })).toBeEnabled();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `${name} 新建任务存在横向溢出`,
    );
    if (screenshots)
      await page.screenshot({ path: join(screenshots, `${name}-new-task.png`), fullPage: true });

    await page.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await expect(page.getByRole("heading", { name: "规则文件", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "design.md 内容" })).toHaveValue(
      "# design production smoke\n\nRead-only smoke content.\n",
    );
    await expect(page.getByRole("link", { name: "返回对话" })).toHaveAttribute(
      "href",
      "command:ui-forge.open",
    );
    await page.getByRole("button", { name: "project.md 工程规则" }).click();
    await expect(page.getByRole("textbox", { name: "project.md 内容" })).toHaveValue(
      "# project production smoke\n\nRead-only smoke content.\n",
    );
    await expect(page.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `${name} 规则页存在横向溢出`,
    );
    if (screenshots)
      await page.screenshot({ path: join(screenshots, `${name}-settings.png`), fullPage: true });
    assert.ok(
      host.requests.some(
        (request) => request.method === communicationTransportMethods.negotiateProtocol,
      ),
      "未经过协议协商",
    );
    assert.ok(
      host.requests.some((request) => request.method === sessionMethods.list),
      "未读取任务列表",
    );
    for (const kind of ["design", "project"]) {
      assert.ok(
        host.requests.some(
          (request) => request.method === instructionMethods.read && request.params.kind === kind,
        ),
        `未读取 ${kind} 规则`,
      );
    }
    return { viewport: name, requests: host.requests.map((request) => request.method) };
  } finally {
    await context.close();
  }
}

/** 无论验证成功或失败都关闭浏览器和 HTTP 服务，不留下后台监听。 */
async function main() {
  const args = parseArguments(process.argv.slice(2));
  const staging = await realpath(args.staging);
  const root = await realpath(join(staging, "webview"));
  assert.ok(isWithin(staging, root), "Webview 目录不在暂存目录内");
  const screenshots = args.screenshots ? await prepareScreenshots(staging, args.screenshots) : null;
  const problems = [];
  const { server, origin } = await serveWebview(root, problems);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["narrow", { width: 390, height: 844 }],
    ]) {
      results.push(await checkViewport(browser, origin, name, viewport, screenshots, problems));
    }
    assert.deepEqual(problems, [], "生产页面出现协议、资源、网络或运行错误");
    console.log(
      JSON.stringify(
        {
          status: "passed",
          results,
          screenshots,
          scope:
            "生产资源与消息桥冒烟；宿主使用只读替身，未验证 VS Code 实装、后端、模型或设计服务。",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (problems.length) console.error(JSON.stringify({ problems }, null, 2));
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
        server.closeAllConnections();
      });
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
