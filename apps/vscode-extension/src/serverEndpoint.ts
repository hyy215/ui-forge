/** 解析扩展的本机后端地址，为侧边栏和 Webview 提供同一通信端点。 */

/** 用户设置优先于开发环境变量；拒绝远程地址、凭据和非根路径。 */
export function resolveServerEndpoint(setting?: unknown, environmentUrl?: string): string {
  const value = setting ?? environmentUrl ?? "http://127.0.0.1:4310";
  const message =
    "ui-forge.serverUrl 必须是本机 HTTP 服务地址，例如 http://127.0.0.1:4310，不含路径、查询参数或凭据。";
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(message);
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.port === "0"
  )
    throw new Error(message);
  return new URL("/api/communication", url).toString();
}
