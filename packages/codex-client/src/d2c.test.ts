import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { bundleDirectory, prepareD2C } from "./d2c.js";
import { prepareD2CRuntime } from "./d2cRuntime.js";
import * as instructionFiles from "./instructions.js";
import { instructionPath, readInstructions, saveInstructions } from "./instructions.js";
import type { NativeMethods } from "./generated/native.js";

type Layer = NonNullable<NativeMethods["config/read"]["result"]["layers"]>[number];
const directories: string[] = [];
async function setup() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "d2c project '")));
  const temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), "d2c artifacts '")));
  directories.push(cwd, temporaryDirectory);
  await writeFile(join(cwd, "custom.md"), "Use the target project components.");
  await writeFile(join(cwd, "design.png"), Buffer.from("unchanged image bytes"));
  const layer: Layer = {
    name: { type: "project", dotCodexFolder: await realpath(join(bundleDirectory, ".codex")) },
    version: "fixture",
    disabledReason: null,
    config: {
      mcp_servers: {
        mastergo: {
          url: "https://mastergo.com/mcp/xf/sse",
          http_headers_helper: "relative helper",
        },
        playwright: {
          command: "npx",
          args: [
            "@playwright/mcp@0.0.78",
            "--headless",
            "--output-dir=old",
            "--output-dir",
            "also-old",
          ],
          env: { CUSTOM: "retained" },
        },
      },
      agents: {
        enabled: true,
        d2c_reviewer: { config_file: "agents/d2c_reviewer.toml", description: "Review" },
      },
      sandbox_mode: "danger-full-access",
      approval_policy: "never",
    },
  };
  const readConfig = vi.fn(async () => ({ layers: [layer] }));
  return { cwd, temporaryDirectory, layer, readConfig };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("D2C native request preparation", () => {
  it("isolates the Vibe bridge from Magic credentials and disables remote access for local materials", async () => {
    const { cwd, temporaryDirectory, readConfig } = await setup();
    const vibe = await prepareD2C(
      cwd,
      {
        prompt: "Build",
        temporaryDirectory,
        designAccess: { kind: "vibe", bridgeUrl: "http://127.0.0.1:43210/mcp/bound" },
      },
      readConfig,
    );
    expect(vibe.thread.config).toMatchObject({
      mcp_servers: {
        mastergo: { enabled: false },
        ui_forge_vibe: { url: "http://127.0.0.1:43210/mcp/bound", enabled_tools: ["read_design"] },
      },
    });
    expect(JSON.stringify(vibe.thread.config)).not.toContain("mastergo-headers");
    expect(vibe.thread.config).toMatchObject({ mcp_servers: { mastergo: { enabled: false } } });
    expect(vibe.thread.developerInstructions).toContain("ui_forge_vibe.read_design");
    const local = await prepareD2CRuntime(
      cwd,
      { temporaryDirectory, designAccess: { kind: "local" } },
      readConfig,
    );
    expect(local.config).toMatchObject({
      mcp_servers: { mastergo: { enabled: false }, ui_forge_vibe: { enabled: false } },
    });
  });

  it("prepares the same runtime for recovery even when current instruction files cannot be read", async () => {
    const { cwd, temporaryDirectory, readConfig } = await setup();
    const created = await prepareD2C(cwd, { prompt: "Build", temporaryDirectory }, readConfig);
    expect(created.thread.model).toBe("gpt-6-astra");
    const readRules = vi
      .spyOn(instructionFiles, "readInstructions")
      .mockRejectedValue(new Error("Current rule file is missing"));
    const runtime = await prepareD2CRuntime(cwd, { temporaryDirectory }, readConfig);
    expect(runtime.config).toEqual(created.thread.config);
    expect(runtime.cwd).toBe(cwd);
    expect(runtime.temporaryDirectory).toBe(temporaryDirectory);
    expect(runtime).not.toHaveProperty("developerInstructions");
    expect(runtime).not.toHaveProperty("input");
    expect(runtime).not.toHaveProperty("model");
    expect(readRules).not.toHaveBeenCalled();
    await expect(
      prepareD2C(cwd, { prompt: "New task", temporaryDirectory }, readConfig),
    ).rejects.toThrow("Current rule file is missing");
  });

  it("still rejects unavailable package configuration when preparing a recovery runtime", async () => {
    const { cwd, temporaryDirectory, layer } = await setup();
    await expect(
      prepareD2CRuntime(cwd, { temporaryDirectory }, async () => ({
        layers: [{ ...layer, disabledReason: "Project is not trusted" }],
      })),
    ).rejects.toThrow("Project is not trusted");
  });

  it("loads package settings for an external target without adding permissions or copying global settings", async () => {
    const { cwd, temporaryDirectory, layer } = await setup();
    const result = await prepareD2C(
      cwd,
      {
        prompt: "Read https://example.com/design",
        images: ["design.png"],
        model: "test-model",
        search: false,
        temporaryDirectory,
      },
      async () => ({
        layers: [
          {
            name: { type: "user", file: "/home/config.toml", profile: null },
            config: { mcp_servers: { private: { token: "do-not-copy" } } },
            version: "user",
            disabledReason: null,
          },
          layer,
        ],
      }),
    );
    expect(result.thread).toMatchObject({
      cwd,
      model: "test-model",
      config: { web_search: "disabled" },
    });
    expect(result.thread).not.toHaveProperty("sandbox");
    expect(result.thread).not.toHaveProperty("runtimeWorkspaceRoots");
    expect(result.thread.config).not.toHaveProperty("approval_policy");
    expect(result.thread.config).not.toHaveProperty("sandbox_mode");
    expect(result.thread.config).not.toHaveProperty("sandbox_workspace_write");
    expect(result.thread.config).toMatchObject({
      shell_environment_policy: {
        set: { TMPDIR: temporaryDirectory, UI_FORGE_TEMP_DIR: temporaryDirectory },
      },
      mcp_servers: {
        playwright: {
          cwd: temporaryDirectory,
          args: ["@playwright/mcp@0.0.78", "--headless", "--output-dir", temporaryDirectory],
          env: { CUSTOM: "retained", TMPDIR: temporaryDirectory },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
    expect(result.thread.config).toMatchObject({
      agents: {
        d2c_reviewer: { config_file: join(bundleDirectory, ".codex/agents/d2c_reviewer.toml") },
      },
    });
    const serialized = JSON.stringify(result.thread.config);
    expect(serialized).toContain(join(bundleDirectory, "scripts/mastergo-headers.mjs"));
    expect(serialized).not.toContain("git rev-parse");
    expect(result.input[0]).toMatchObject({
      type: "skill",
      name: "ui-forge-d2c",
      path: join(bundleDirectory, ".agents/skills/ui-forge-d2c/SKILL.md"),
    });
    expect(result.input.at(-1)).toEqual({ type: "localImage", path: join(cwd, "design.png") });
    expect(await readFile(join(cwd, "design.png"), "utf8")).toBe("unchanged image bytes");
    expect(result.thread.developerInstructions).toContain(await readInstructions("design"));
    expect(result.thread.developerInstructions).toContain(await readInstructions("project"));
  });

  it("uses saved custom rules in later preparations and keeps a prepared request's snapshot", async () => {
    const { cwd, temporaryDirectory, readConfig } = await setup();
    const first = await prepareD2C(
      cwd,
      { images: ["design.png"], projectInstructions: "custom.md", temporaryDirectory },
      readConfig,
    );
    await saveInstructions(
      "project",
      "Updated rules for coding, review and repairs.",
      join(cwd, "custom.md"),
    );
    const second = await prepareD2C(
      cwd,
      { prompt: "Implement", projectInstructions: "custom.md", temporaryDirectory },
      readConfig,
    );
    expect(first.thread.developerInstructions).toContain("Use the target project components.");
    expect(first.ruleFingerprints?.project).toBe(
      createHash("sha256").update("Use the target project components.").digest("hex"),
    );
    expect(second.ruleFingerprints?.project).toBe(
      createHash("sha256").update("Updated rules for coding, review and repairs.").digest("hex"),
    );
    expect(first.ruleFingerprints?.design).toBe(second.ruleFingerprints?.design);
    expect(second.thread.developerInstructions).toContain(
      "Updated rules for coding, review and repairs.",
    );
    expect(first.input[1]).toMatchObject({
      type: "text",
      text: "根据所附设计图实现页面，并完成 Review 与验证。",
    });
    expect(instructionPath("design")).toBe(join(bundleDirectory, "instructions/design.md"));
  });

  it("rejects bad inputs before opening a Codex connection", async () => {
    const { cwd, readConfig } = await setup();
    for (const input of [
      { prompt: "  " },
      { images: ["missing.png"] },
      { images: ["."] },
      { prompt: "Implement", temporaryDirectory: "relative/tmp" },
      { prompt: "Implement", designInstructions: "missing.md" },
      { prompt: "Implement", projectInstructions: "design.png" },
    ]) {
      await expect(prepareD2C(cwd, input, readConfig)).rejects.toThrow();
    }
    await writeFile(join(cwd, "empty.md"), "  ");
    await expect(
      prepareD2C(cwd, { prompt: "Implement", designInstructions: "empty.md" }, readConfig),
    ).rejects.toThrow("Instructions must not be empty");
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("reports missing or disabled package configuration instead of substituting another layer", async () => {
    const { cwd, layer } = await setup();
    await expect(
      prepareD2C(cwd, { prompt: "Implement" }, async () => ({ layers: [] })),
    ).rejects.toThrow("package project layer is missing");
    await expect(
      prepareD2C(cwd, { prompt: "Implement" }, async () => ({
        layers: [{ ...layer, disabledReason: "Project is not trusted" }],
      })),
    ).rejects.toThrow("Project is not trusted");
  });

  it("reports failed reads and saves without silently writing default files", async () => {
    const { cwd } = await setup();
    await expect(readInstructions("design", join(cwd, "missing.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(saveInstructions("design", " ", join(cwd, "custom.md"))).rejects.toThrow(
      "Instructions must not be empty",
    );
    await expect(
      saveInstructions("project", "rules", join(cwd, "missing/custom.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readInstructions("design", "relative.md")).rejects.toThrow();
    expect(await readFile(join(cwd, "custom.md"), "utf8")).toBe(
      "Use the target project components.",
    );
  });
});
