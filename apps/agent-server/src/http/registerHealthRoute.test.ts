/** 验证 Agent Server 健康检查路由的稳定响应。 */

import { afterEach, describe, expect, it } from "vitest";
import { AgentServer } from "../agentServer.js";

const servers: AgentServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("health route", () => {
  it("reports the Agent Server health", async () => {
    const server = new AgentServer();
    servers.push(server);
    const response = await server.application.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "agent-server" });
  });
});
