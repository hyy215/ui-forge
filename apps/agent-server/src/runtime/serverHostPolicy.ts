/** 限制 Agent Server 只监听本机回环地址，避免业务端点被远程访问。 */

import { isIP } from "node:net";

/**
 * 规范化并校验监听主机；当前产品只支持 localhost、IPv4 loopback 和 IPv6 loopback。
 */
export function normalizeLoopbackHost(hostInput: string | undefined): string {
  const host = unwrapIpv6Brackets(hostInput?.trim().toLowerCase() || "127.0.0.1");
  if (host === "localhost" || host === "localhost.") return "127.0.0.1";
  if (isIP(host) === 4 && host.split(".")[0] === "127") return host;
  if (isIpv6Loopback(host)) return "::1";
  throw new Error("Agent Server 当前只允许监听本机 loopback 地址。");
}

/** 判断 IPv6 字面量是否为压缩或完整形式的唯一 loopback 地址。 */
function isIpv6Loopback(host: string): boolean {
  if (host === "::1") return true;
  if (isIP(host) !== 6) return false;
  const parts = host.split(":");
  return parts.length === 8
    && parts.slice(0, 7).every((part) => /^0{1,4}$/.test(part))
    && /^0{0,3}1$/.test(parts[7] ?? "");
}

/** 移除 Fastify 配置中可能出现的 IPv6 方括号。 */
function unwrapIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
