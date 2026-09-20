/** 启动隔离的真实 Agent Server，用于验证文件预览及其 HTTP 响应头。 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 只登记样本任务，文件请求不创建 Codex 连接；返回测试进程的清理方法。 */
export async function startFilePreviewServer(
  workspace: string,
): Promise<{ origin: string; close(): Promise<void> }> {
  const runtime = join(workspace, "runtime");
  await mkdir(runtime);
  await writeFile(
    join(runtime, "sessions.json"),
    JSON.stringify([
      {
        taskId: "demo-0",
        projectPath: workspace,
        title: "file preview",
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../../../agent-server/src/main.ts", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        UI_FORGE_HOST: "127.0.0.1",
        UI_FORGE_PORT: "0",
        UI_FORGE_RUNTIME_DIR: runtime,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("测试文件服务启动超时。")), 15_000);
      const onExit = () => {
        clearTimeout(timer);
        reject(new Error("测试文件服务在监听前退出。"));
      };
      child.once("exit", onExit);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const address = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
        if (address) {
          clearTimeout(timer);
          child.off("exit", onExit);
          resolve(address);
        }
      });
      child.stderr.resume();
    });
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
