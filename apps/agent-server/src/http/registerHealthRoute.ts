/** 注册不依赖领域运行时的 Agent Server 健康检查路由。 */

import type { FastifyInstance } from "fastify";

/** 在指定 Fastify 实例上注册稳定的健康检查响应。 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async () => ({
    status: "ok" as const,
    service: "agent-server" as const,
    version: "0.1.0",
  }));
}
