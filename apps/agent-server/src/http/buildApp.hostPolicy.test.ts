import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentServer } from "../agentServer.js";
import { normalizeLoopbackHost } from "../runtime/serverHostPolicy.js";

const resources: { server: AgentServer; directory: string }[] = [];
afterEach(async () => {
  for (const { server, directory } of resources.splice(0)) {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "server-host-policy-"));
  const server = new AgentServer({ runtimeDirectory: directory, instanceLock: false });
  resources.push({ server, directory });
  return server.application;
}

it.each(["127.0.0.1", "127.42.3.9", "localhost", "localhost.", "[::1]", "[0:0:0:0:0:0:0:1]"])(
  "accepts the supported loopback host %s through both listening and HTTP checks",
  async (host) => {
    expect(() => normalizeLoopbackHost(host)).not.toThrow();
    const app = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: `${host}:4310`, origin: `http://${host}:5173` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "agent-server" });
  },
);

it.each([
  { host: "192.168.1.10:4310" },
  { host: "127.0.0.1.example.com:4310" },
  { host: "[::]:4310" },
  { host: "user@localhost:4310" },
  { origin: "https://external.example" },
  { origin: "http://127.0.0.1.example.com" },
  { origin: "file://localhost/" },
  { origin: "null" },
  { origin: "not a URL" },
])("rejects an invalid or external request boundary: %j", async (headers) => {
  const app = await setup();
  const response = await app.inject({ method: "GET", url: "/health", headers });
  expect(response.statusCode).toBe(403);
});
