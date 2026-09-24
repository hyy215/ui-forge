import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultVibeEndpoint,
  defaultVibeStatusEndpoint,
  designMethods,
  type DesignConnectionCheck,
} from "@ui-forge/shared-protocol";
import { registerDesignCheckCommand } from "./designCheck.js";

const runtime = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  request: vi.fn<(method: string, params: unknown, schema: unknown) => Promise<unknown>>(),
}));
vi.mock("../client.js", () => ({
  LocalClient: class {
    connect = runtime.connect;
    request = runtime.request;
  },
}));

const url = "https://mastergo.com/file/file?layer_id=2:3&page_id=1:0";
const magic: DesignConnectionCheck = {
  source: { kind: "mastergo", url, connection: { kind: "magic" } },
  tools: ["get_design_context"],
  serverVersion: "1.0.0",
};
const vibe: DesignConnectionCheck = {
  source: {
    kind: "mastergo",
    url,
    connection: {
      kind: "vibe",
      endpoint: defaultVibeEndpoint,
      statusEndpoint: defaultVibeStatusEndpoint,
    },
  },
  tools: ["read_design"],
  target: { documentId: "file", pageId: "1:0", nodeId: "2:3" },
};
const local: DesignConnectionCheck = { source: { kind: "local" }, tools: [] };
let stdout: string[];

async function runDesignCheck(options: string[] = []): Promise<void> {
  const program = new Command().option("--json").exitOverride();
  registerDesignCheckCommand(program);
  await program.parseAsync(["design-check", ...options], { from: "user" });
}

function sourceOptions(report: DesignConnectionCheck): string[] {
  return report.source.kind === "local"
    ? []
    : [
        "--design-source",
        "mastergo",
        "--mastergo-connection",
        report.source.connection.kind,
        "--design-url",
        report.source.url,
      ];
}

beforeEach(() => {
  vi.resetAllMocks();
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  runtime.connect.mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe("design-check result scope", () => {
  it("describes only the handshake and tool list for Magic", async () => {
    runtime.request.mockResolvedValue(magic);
    await runDesignCheck(sourceOptions(magic));
    expect(stdout.join("")).toContain("接入：Magic；只读预检通过。");
    expect(stdout.join("")).toContain("已检查：MCP 握手与工具清单。");
    expect(stdout.join("")).toContain("目标节点尚未读取，设计读取权限未证实；未执行交付验收。");
    expect(stdout.join("")).not.toContain("当前文件/页面");
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      designMethods.check,
      { source: magic.source },
      expect.anything(),
    );
  });

  it("adds Vibe canvas identity and JSON tool checks without claiming node access", async () => {
    runtime.request.mockResolvedValue(vibe);
    await runDesignCheck(sourceOptions(vibe));
    expect(stdout.join("")).toContain("接入：Vibe；只读预检通过。");
    expect(stdout.join("")).toContain(
      "已检查：MCP 握手、工具清单、当前文件/页面及 JSON 读取工具。",
    );
    expect(stdout.join("")).toContain("目标标识：文件 file；页面 1:0；节点 2:3");
    expect(stdout.join("")).toContain("目标节点尚未读取，设计读取权限未证实；未执行交付验收。");
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      designMethods.check,
      { source: vibe.source },
      expect.anything(),
    );
  });

  it("does not imply an MCP connection was checked for local input", async () => {
    runtime.request.mockResolvedValue(local);
    await runDesignCheck();
    expect(stdout).toEqual(["来源：图片/文字；无需平台接入。\n未执行 MCP 连接检查或交付验收。\n"]);
    expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
      designMethods.check,
      { source: local.source },
      expect.anything(),
    );
  });

  it.each([magic, vibe, local])("preserves the JSON report for $source.kind", async (report) => {
    runtime.request.mockResolvedValue(report);
    await runDesignCheck([...sourceOptions(report), "--json"]);
    expect(stdout).toEqual([`${JSON.stringify(report)}\n`]);
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid CLI input before connecting to a service", async () => {
    await expect(runDesignCheck(["--design-source", "figma"])).rejects.toThrow(
      "--design-source 只能为 local 或 mastergo。",
    );
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.request).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
  });

  it("does not print success after a failed preflight", async () => {
    runtime.request.mockRejectedValue(new Error("当前画布与目标文件不一致。"));
    await expect(runDesignCheck(sourceOptions(vibe))).rejects.toThrow("当前画布与目标文件不一致。");
    expect(stdout).toEqual([]);
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });
});
