/** 校验离线扩展暂存产物；不激活扩展、不连接后端，也不将暂存成功视为安装成功。 */
import assert from "node:assert/strict";
import { isBuiltin, createRequire } from "node:module";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Script } from "node:vm";
import { build } from "esbuild";

const requiredFiles = [
  "package.json",
  "README.md",
  "dist/extension.cjs",
  "media/ui-forge.svg",
  "webview/index.html",
];
const assetPath =
  /^webview\/assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|gif|ico)$/;

/** 只接受明确的发布文件和普通目录，阻止源码、凭据、运行数据和符号链接混入。 */
async function inventory(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const name = relative(root, path).split(sep).join("/");
    const info = await lstat(path);
    assert(!info.isSymbolicLink(), `安装包不能包含符号链接：${name}`);
    if (info.isDirectory()) {
      assert(["dist", "media", "webview", "webview/assets"].includes(name), `非发布目录：${name}`);
      files.push(...(await inventory(root, path)));
    } else {
      assert(info.isFile(), `安装包只能包含普通文件：${name}`);
      assert(requiredFiles.includes(name) || assetPath.test(name), `非发布文件：${name}`);
      assert(info.size > 0 && info.size <= 20 * 1024 * 1024, `文件为空或过大：${name}`);
      files.push(name);
    }
  }
  return files.sort();
}

/** 在仅允许 Node 内置模块和 VS Code 替身的环境中加载 CJS，拒绝仓库依赖。 */
function checkExtensionEntry(source) {
  const nativeRequire = createRequire(import.meta.url);
  const module = { exports: {} };
  new Script(source, { filename: "extension.cjs" }).runInNewContext(
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (id === "vscode") return {};
        assert(isBuiltin(id), `扩展入口含未打包依赖：${id}`);
        return nativeRequire(id);
      },
      URL,
      AbortController,
      TextEncoder,
      TextDecoder,
      Buffer,
      setTimeout,
      clearTimeout,
    },
    { timeout: 5_000 },
  );
  assert.equal(typeof module.exports.activate, "function", "缺少 activate 导出");
  assert.equal(typeof module.exports.deactivate, "function", "缺少 deactivate 导出");
}

/** 检查发布清单、隔离入口和全部 JS/CSS 静态及动态依赖，返回真实文件清单。 */
export async function verifyPackage(staging) {
  const root = await realpath(resolve(staging));
  const files = await inventory(root);
  for (const name of requiredFiles) assert(files.includes(name), `缺少发布文件：${name}`);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "ui-forge");
  assert.equal(manifest.publisher, "ui-forge");
  assert.equal(manifest.main, "./dist/extension.cjs");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  assert.equal(typeof manifest.engines?.vscode, "string");
  for (const field of ["scripts", "dependencies", "devDependencies", "private", "type"])
    assert(!(field in manifest), `发布清单不应包含 ${field}`);
  assert(manifest.contributes?.commands?.some((item) => item.command === "ui-forge.open"));
  assert(
    manifest.contributes?.viewsContainers?.activitybar?.some(
      (item) => item.id === "ui-forge" && item.icon === "media/ui-forge.svg",
    ),
  );
  checkExtensionEntry(await readFile(join(root, manifest.main), "utf8"));
  const assets = files.filter((name) => /\.(?:js|css)$/.test(name));
  assert(
    assets.some((name) => name.endsWith(".js")),
    "缺少生产页面脚本",
  );
  assert(
    assets.some((name) => name.endsWith(".css")),
    "缺少生产页面样式",
  );
  // 复用构建器的 JS/CSS 解析与路径解析，不用正则猜测压缩后的 import 或 url()。
  const graph = await build({
    absWorkingDir: root,
    entryPoints: assets,
    bundle: true,
    write: false,
    outdir: join(root, "validation-output"),
    platform: "browser",
    format: "esm",
    logLevel: "silent",
    metafile: true,
    plugins: [
      {
        name: "package-files-only",
        setup(builder) {
          builder.onLoad({ filter: /.*/, namespace: "file" }, ({ path }) => {
            const name = relative(root, path).split(sep).join("/");
            assert(files.includes(name), `页面依赖不在发布清单内：${name}`);
          });
        },
      },
    ],
    loader: Object.fromEntries(
      [".woff", ".woff2", ".ttf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico"].map(
        (extension) => [extension, "file"],
      ),
    ),
  });
  for (const [path, input] of Object.entries(graph.metafile.inputs)) {
    assert(files.includes(path.split(sep).join("/")), `页面依赖不在发布清单内：${path}`);
    for (const dependency of input.imports)
      assert(!dependency.external, `页面含外部依赖：${dependency.path}`);
  }
  return { version: manifest.version, files };
}
