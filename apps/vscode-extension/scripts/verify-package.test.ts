import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verifyPackage } from "./verify-package.mjs";

const temporary: string[] = [];
const manifest = {
  name: "ui-forge",
  publisher: "ui-forge",
  version: "0.1.0",
  main: "./dist/extension.cjs",
  engines: { vscode: "^1.105.0" },
  contributes: {
    commands: [{ command: "ui-forge.open" }],
    viewsContainers: { activitybar: [{ id: "ui-forge", icon: "media/ui-forge.svg" }] },
  },
};

async function put(root: string, name: string, content: string) {
  await mkdir(dirname(join(root, name)), { recursive: true });
  await writeFile(join(root, name), content);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ui-forge-package-test-"));
  temporary.push(root);
  const files = {
    "package.json": JSON.stringify(manifest),
    "README.md": "# Test package",
    "dist/extension.cjs":
      'require("node:path"); require("vscode"); exports.activate = () => {}; exports.deactivate = () => {};',
    "media/ui-forge.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "webview/index.html": '<script type="module" src="./assets/main.js"></script>',
    "webview/assets/main.js": 'export const load = () => import("./page.js");',
    "webview/assets/page.js": 'export const page = "settings";',
    "webview/assets/main.css": "body { color: black; }",
  };
  for (const [name, content] of Object.entries(files)) await put(root, name, content);
  return root;
}

afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

it("accepts a self-contained package with lazy chunks and Node builtins", async () => {
  const root = await fixture();
  const result = await verifyPackage(root);
  expect(result.version).toBe("0.1.0");
  expect(result.files).toHaveLength(8);
});

it.each([
  ".env",
  "webview/assets/main.js.map",
  "webview/.env.local",
  "webview/fixtures/dev.js",
  "node_modules/package/index.js",
  "references/private.md",
  "media/notes.txt",
  "dist/extension.ts",
])("rejects non-release content: %s", async (name) => {
  const root = await fixture();
  await put(root, name, "not for release");
  await expect(verifyPackage(root)).rejects.toThrow(/非发布/);
});

it.each(["webview/assets/link.js", "webview/linked-directory"])(
  "rejects symlinks even when their target is within the package: %s",
  async (name) => {
    const root = await fixture();
    await symlink(join(root, name.endsWith(".js") ? "README.md" : "media"), join(root, name));
    await expect(verifyPackage(root)).rejects.toThrow("符号链接");
  },
);

it.each(["README.md", "dist/extension.cjs", "media/ui-forge.svg", "webview/index.html"])(
  "rejects missing required files: %s",
  async (name) => {
    const root = await fixture();
    await rm(join(root, name));
    await expect(verifyPackage(root)).rejects.toThrow("缺少发布文件");
  },
);

it.each([
  { name: "@ui-forge/vscode-extension" },
  { main: "../outside.js" },
  { publisher: "other" },
  { dependencies: {} },
  { scripts: { postinstall: "command" } },
])("rejects invalid or workspace-dependent manifest: %j", async (change) => {
  const root = await fixture();
  await put(root, "package.json", JSON.stringify({ ...manifest, ...change }));
  await expect(verifyPackage(root)).rejects.toThrow();
});

it.each([
  ['require("@ui-forge/shared-protocol")', "未打包依赖"],
  ['require("../../package.json")', "未打包依赖"],
  ["exports.activate = () => {}", "deactivate"],
  ["throw new Error('broken entry')", "broken entry"],
])("rejects a broken extension entry: %s", async (source, reason) => {
  const root = await fixture();
  await put(root, "dist/extension.cjs", source);
  await expect(verifyPackage(root)).rejects.toThrow(reason);
});

it.each([
  ["webview/assets/page.js", 'export const load = () => import("./missing.js");'],
  ["webview/assets/main.css", 'body { background: url("./missing.png"); }'],
  ["webview/assets/page.js", 'import "https://example.com/module.js";'],
  ["webview/assets/main.css", '@import "https://example.com/style.css";'],
])("rejects missing or remote asset dependencies: %s %s", async (name, source) => {
  const root = await fixture();
  await put(root, name, source);
  await expect(verifyPackage(root)).rejects.toThrow();
});

it("rejects imports outside the package before loading their contents", async () => {
  const root = await fixture();
  const external = await mkdtemp(join(tmpdir(), "ui-forge-external-test-"));
  temporary.push(external);
  await put(external, "private.js", "export const secret = 1;");
  await put(
    root,
    "webview/assets/page.js",
    `import ${JSON.stringify(join(external, "private.js"))};`,
  );
  await expect(verifyPackage(root)).rejects.toThrow("页面依赖不在发布清单内");
});
