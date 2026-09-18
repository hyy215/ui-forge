/** 将包创建的 Codex 连接绑定到宿主进程生命周期；多个连接共用一组监听器。 */
const connections = new Set<() => Promise<void>>();
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function closeConnections(): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([...connections].map((close) => close()));
}
function onExit(): void {
  void closeConnections();
}
function onSignal(signal: NodeJS.Signals): void {
  const restoreDefault = process.listenerCount(signal) === 1;
  void closeConnections().then(() => {
    // Preserve a host's own shutdown handler; restore default signal exit when we were the sole handler.
    if (restoreDefault && process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}
const handlers = signals.map((signal) => ({ signal, handler: () => onSignal(signal) }));

/** 注册连接清理并返回注销函数；必须在子进程实际退出后注销。 */
export function bindHostLifecycle(close: () => Promise<void>): () => void {
  connections.add(close);
  if (connections.size === 1) {
    process.on("exit", onExit);
    process.on("disconnect", onExit);
    for (const { signal, handler } of handlers) process.on(signal, handler);
  }
  return () => {
    connections.delete(close);
    if (connections.size === 0) {
      process.off("exit", onExit);
      process.off("disconnect", onExit);
      for (const { signal, handler } of handlers) process.off(signal, handler);
    }
  };
}
