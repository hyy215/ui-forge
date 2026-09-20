import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainCodexStartupError, resolveCodexExecutable } from "./executable.js";

const fixture = vi.hoisted(() => ({
  files: new Map<string, "file" | "directory" | "not-executable">(),
  system: "darwin" as NodeJS.Platform,
}));
vi.mock("node:os", () => ({ platform: () => fixture.system, homedir: () => "/Users/test" }));
vi.mock("node:fs", () => ({
  constants: { X_OK: 1 },
  statSync: (path: string) => {
    const kind = fixture.files.get(path);
    if (!kind) throw new Error("ENOENT");
    return { isFile: () => kind !== "directory", isDirectory: () => kind === "directory" };
  },
  accessSync: (path: string) => {
    if (fixture.files.get(path) !== "file") throw new Error("EACCES");
  },
}));
beforeEach(() => {
  fixture.files.clear();
  fixture.system = "darwin";
  vi.stubEnv("PATH", "/usr/bin:/bin");
});
afterEach(() => vi.unstubAllEnvs());

describe("Codex executable discovery", () => {
  it("uses PATH before a desktop installation and skips directories or non-executable files", () => {
    vi.stubEnv("PATH", "/bad:/scripts:/tools:/usr/bin");
    fixture.files.set("/bad/codex", "directory");
    fixture.files.set("/scripts/codex", "not-executable");
    fixture.files.set("/tools/codex", "file");
    fixture.files.set("/Applications/ChatGPT.app/Contents/Resources/codex", "file");
    expect(resolveCodexExecutable()).toBe("/tools/codex");
  });

  it.each([
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Users/test/Applications/Codex.app/Contents/Resources/codex",
    "/Users/test/Applications/ChatGPT.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Users/test/.local/bin/codex",
  ])("finds %s with a GUI PATH", (path) => {
    fixture.files.set(path, "file");
    expect(resolveCodexExecutable()).toBe(path);
  });

  it("preserves explicit configuration even when it is missing", () => {
    fixture.files.set("/Applications/ChatGPT.app/Contents/Resources/codex", "file");
    expect(resolveCodexExecutable("/missing/custom-codex")).toBe("/missing/custom-codex");
    expect(resolveCodexExecutable("custom-codex")).toBe("custom-codex");
  });

  it("resolves relative PATH entries against the child working directory", () => {
    vi.stubEnv("PATH", "tools");
    fixture.files.set("/target/tools/codex", "file");
    expect(resolveCodexExecutable("codex", "/target")).toBe("/target/tools/codex");
  });

  it("leaves an unavailable command to the operating system without searching the workspace", () => {
    vi.stubEnv("PATH", "");
    fixture.files.set("/target/codex", "file");
    expect(resolveCodexExecutable("codex", "/target")).toBe("codex");
  });

  it("does not search macOS apps on Linux", () => {
    fixture.system = "linux";
    fixture.files.set("/Applications/ChatGPT.app/Contents/Resources/codex", "file");
    expect(resolveCodexExecutable()).toBe("codex");
  });

  it("resolves a Windows native executable from PATH", () => {
    fixture.system = "win32";
    vi.stubEnv("PATH", "C:\\Tools;C:\\Windows");
    fixture.files.set("C:\\Tools\\codex.exe", "file");
    expect(resolveCodexExecutable("codex", "C:\\target")).toBe("C:\\Tools\\codex.exe");
  });
});

describe("Codex startup diagnostics", () => {
  it("preserves the error code and suggests an explicit path for a missing executable", () => {
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    fixture.files.set("/target", "directory");
    expect(explainCodexStartupError(error, "codex", "/target")).toBe(error);
    expect(error.code).toBe("ENOENT");
    expect(error.message).toContain("UI_FORGE_CODEX_PATH");
  });

  it("identifies a missing workspace rather than suggesting another executable", () => {
    const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    explainCodexStartupError(error, "codex", "/missing");
    expect(error.message).toContain("工作区不存在或不可访问：/missing");
    expect(error.message).not.toContain("UI_FORGE_CODEX_PATH");
  });
});
