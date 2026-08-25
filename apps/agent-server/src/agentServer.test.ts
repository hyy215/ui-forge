/** 验证公共 AgentServer Facade 无法绕过 loopback 监听限制。 */

import { afterEach, describe, expect, it } from "vitest";
import { AgentServer } from "./agentServer.js";

const servers: AgentServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("AgentServer", () => {
  it("rejects non-loopback listening through the public facade", async () => {
    const server = new AgentServer();
    servers.push(server);

    await expect(server.listen({ host: "0.0.0.0", port: 0 }))
      .rejects.toThrow("只允许监听本机 loopback");
  });
});
