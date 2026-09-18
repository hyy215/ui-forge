// Live-test host: keep an active native turn alive until the driver ends this host's lifetime.
const { pathToFileURL } = require("node:url");
(async () => {
  const [entry, executable, cwd] = process.argv.slice(2);
  const { CodexClient } = await import(pathToFileURL(entry).href);
  const controller = new AbortController();
  const client = new CodexClient({
    cwd,
    executable,
    signal: controller.signal,
    requestTimeoutMs: 120000,
  });
  process.on("message", (action) => {
    if (action === "exit") process.exit(0);
    if (action === "abort") controller.abort();
  });
  const config = await client.request("config/read", {});
  const disabledMcp = Object.fromEntries(
    Object.keys(config.config.mcp_servers || {}).map((name) => [name, { enabled: false }]),
  );
  const { thread } = await client.request("thread/start", {
    cwd,
    ephemeral: true,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    config: { mcp_servers: disabledMcp, agents: { enabled: false } },
  });
  await client.request("turn/start", {
    threadId: thread.id,
    input: [
      {
        type: "text",
        text: "执行 sleep 30，完成前不要回复。只执行这一条命令，不修改文件，不调用网络或其他工具。",
        text_elements: [],
      },
    ],
  });
  process.send("ready");
  setInterval(() => {}, 1000);
})().catch(() => {
  if (process.connected) process.send("failed");
  process.exit(1);
});
