import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkVibeConnection,
  connectVibe,
  fixedLoopbackFetch,
  readVibeStatus,
} from "./connections.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { close, connect, listTools, transportOptions } = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  listTools: vi.fn(),
  transportOptions: vi.fn<(options: StreamableHTTPClientTransportOptions) => void>(),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options: StreamableHTTPClientTransportOptions) {
      transportOptions(options);
    }
    close = close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    close = close;
    connect = connect;
    listTools = listTools;
    getServerVersion() {
      return { name: "MasterGo-Vibe-MCP", version: "1.0.30" };
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
const connection = {
  endpoint: "http://127.0.0.1:20678/mcp",
  statusEndpoint: "http://127.0.0.1:30678/api/status",
};
const status = { documentId: "file1", documentPageId: "1:0", token: "never-return-this-token" };

describe("design connection checks", () => {
  it("uses a 120-second upstream read deadline while retaining 15-second checks", async () => {
    const deadline = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(status)),
    );
    await connectVibe(connection);
    expect(connect).toHaveBeenCalledWith(expect.anything(), { timeout: 15_000 });
    const upstreamFetch = transportOptions.mock.calls[0]?.[0].fetch;
    expect(upstreamFetch).toBeDefined();
    await upstreamFetch!(connection.endpoint, { method: "POST" });
    expect(deadline).toHaveBeenLastCalledWith(120_000);
    await readVibeStatus(connection);
    expect(deadline).toHaveBeenLastCalledWith(15_000);
  });
  it("performs only status, handshake and tool listing, stripping private status fields", async () => {
    const fetchMock = vi.fn(async () => Response.json(status));
    vi.stubGlobal("fetch", fetchMock);
    listTools.mockResolvedValue({
      tools: [
        {
          name: "get_frontend_code",
          inputSchema: {
            properties: {
              frontendFramework: {},
              writeToFile: {},
              targetNodeId: {},
              projectDir: {},
            },
          },
        },
      ],
    });
    const result = await checkVibeConnection(connection);
    expect(result).toEqual({
      documentId: "file1",
      pageId: "1:0",
      serverName: "MasterGo-Vibe-MCP",
      serverVersion: "1.0.30",
      tools: ["get_frontend_code"],
    });
    expect(JSON.stringify(result)).not.toContain("token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects changed canvas and unsupported tool schemas without raw data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(status))
        .mockResolvedValueOnce(Response.json({ ...status, documentPageId: "9:0" })),
    );
    listTools.mockResolvedValue({
      tools: [
        {
          name: "get_frontend_code",
          inputSchema: {
            properties: {
              frontendFramework: {},
              writeToFile: {},
              targetNodeId: {},
              projectDir: {},
            },
          },
        },
      ],
    });
    await expect(checkVibeConnection(connection)).rejects.toThrow("画布发生变化");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(status)),
    );
    listTools.mockResolvedValue({ tools: [] });
    await expect(checkVibeConnection(connection)).rejects.toThrow("未提供所需的 JSON 读取工具");
    listTools.mockRejectedValue(new Error("token=secret"));
    await expect(checkVibeConnection(connection)).rejects.toThrow(
      "无法获取 Vibe MCP 工具清单，请检查服务连接后重试。",
    );
    expect(close).toHaveBeenCalledTimes(3);
  });
  it("identifies MCP failures without exposing upstream data and closes the transport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(status)),
    );
    connect.mockRejectedValue(new Error("token=secret"));
    await expect(checkVibeConnection(connection)).rejects.toThrow(
      "无法连接 Vibe MCP，请确认 MCP 服务已启动，并检查 MCP 地址（不是画布状态地址）。",
    );
    expect(listTools).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("pins fetch destination and forbids credentials and redirect following", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const constrained = fixedLoopbackFetch(connection.endpoint);
    await constrained(connection.endpoint, { method: "POST" });
    expect(fetchMock).toHaveBeenCalledWith(
      connection.endpoint,
      expect.objectContaining({ redirect: "error", credentials: "omit" }),
    );
    await expect(constrained("http://127.0.0.1:1111/other")).rejects.toThrow("Unexpected");
    await expect(
      constrained(connection.endpoint, { headers: { authorization: "secret" } }),
    ).rejects.toThrow("credentials");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never exposes malformed or rejected status payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private token", { status: 403 })),
    );
    await expect(readVibeStatus(connection)).rejects.toThrow(
      "无法读取 Vibe 当前文件和页面，请在客户端打开目标画布，并检查画布状态地址（不是 MCP 地址）。",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ documentId: "file1", token: "secret" })),
    );
    await expect(readVibeStatus(connection)).rejects.toThrow(
      "无法读取 Vibe 当前文件和页面，请在客户端打开目标画布，并检查画布状态地址（不是 MCP 地址）。",
    );
  });
  it("fails at the status check before opening MCP when the status service is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private transport details");
      }),
    );
    await expect(checkVibeConnection(connection)).rejects.toThrow(
      "无法读取 Vibe 当前文件和页面，请在客户端打开目标画布，并检查画布状态地址（不是 MCP 地址）。",
    );
    expect(connect).not.toHaveBeenCalled();
    expect(listTools).not.toHaveBeenCalled();
  });
});
