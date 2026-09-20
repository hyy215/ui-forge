/** 构建独立的 VSIX 暂存目录，再调用已安装的官方 vsce；不安装工具或发布扩展。 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const prepareOnly = process.argv.includes("--prepare");

/** 串行执行本地构建，失败时保留真实退出码。 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!prepareOnly) {
  const available = spawnSync("vsce", ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  if (available.error || available.status !== 0)
    throw new Error(
      "缺少 VSIX 打包工具，请先安装 @vscode/vsce，并确保 vsce 在 PATH 中；本脚本不会自动安装。",
    );
}
run("npm", ["run", "build", "-w", "@ui-forge/shared-protocol"], repositoryRoot);
run("npm", ["run", "build", "-w", "@ui-forge/client-core"], repositoryRoot);
run("npm", ["run", "build", "-w", "@ui-forge/agent-webview"], repositoryRoot);
run("npm", ["run", "typecheck", "-w", "@ui-forge/vscode-extension"], repositoryRoot);

const temporaryRoot = join(repositoryRoot, ".ui-forge", "packaging");
await mkdir(temporaryRoot, { recursive: true });
const staging = await mkdtemp(join(temporaryRoot, "vscode-extension-"));
await build({
  entryPoints: [join(extensionRoot, "src", "extension.ts")],
  outfile: join(staging, "dist", "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
});
await cp(join(repositoryRoot, "apps", "agent-webview", "dist"), join(staging, "webview"), {
  recursive: true,
});
await cp(join(extensionRoot, "media"), join(staging, "media"), { recursive: true });
await cp(join(extensionRoot, "README.md"), join(staging, "README.md"));
const manifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
// npm 工作区名与离线 VSIX 标识分别维护；暂存包不引用仓库或 node_modules。
const {
  scripts,
  dependencies,
  devDependencies,
  private: privatePackage,
  type,
  ...contribution
} = manifest;
await writeFile(
  join(staging, "package.json"),
  JSON.stringify(
    {
      ...contribution,
      name: "ui-forge",
      publisher: "ui-forge",
      main: "./dist/extension.cjs",
    },
    null,
    2,
  ) + "\n",
);
console.log(`VSIX 暂存目录：${staging}`);
if (!prepareOnly) {
  const outputDirectory = join(repositoryRoot, "dist");
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `ui-forge-${manifest.version}.vsix`);
  run(
    "vsce",
    [
      "package",
      "--no-dependencies",
      "--allow-missing-repository",
      "--skip-license",
      "--out",
      output,
    ],
    staging,
  );
  console.log(`安装包：${output}`);
}
