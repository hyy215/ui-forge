import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function runHelper(dotenv?: string, token?: string) {
  const directory = await mkdtemp(join(tmpdir(), "mastergo-headers-test-"));
  directories.push(directory);
  const packageDirectory = join(directory, "packages/codex-client");
  await mkdir(join(packageDirectory, "scripts"), { recursive: true });
  const script = join(packageDirectory, "scripts/mastergo-headers.mjs");
  await writeFile(
    script,
    await readFile(new URL("../scripts/mastergo-headers.mjs", import.meta.url)),
  );
  await writeFile(join(packageDirectory, ".env"), "MG_MCP_TOKEN=package-token-must-be-ignored\n");
  if (dotenv !== undefined) await writeFile(join(directory, ".env"), dotenv);
  const env = { ...process.env };
  delete env.MG_MCP_TOKEN;
  if (token !== undefined) env.MG_MCP_TOKEN = token;
  return spawnSync(process.execPath, [script], { cwd: tmpdir(), env, encoding: "utf8" });
}

it("loads only the MasterGo token from the root .env and ignores package .env regardless of working directory", async () => {
  const result = await runHelper('MG_MCP_TOKEN="test-token"\nUNRELATED_SECRET=private-value\n');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ "x-mg-useraccesstoken": "test-token" });
  expect(result.stderr).toBe("");
});

it.each([undefined, "MG_MCP_TOKEN=root-token\n"])(
  "prefers an explicit environment token and does not require an .env file",
  async (dotenv) => {
    const result = await runHelper(dotenv, "environment-token");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ "x-mg-useraccesstoken": "environment-token" });
  },
);

it.each([undefined, "MG_MCP_TOKEN=\n", 'MG_MCP_TOKEN="invalid\ntoken"\n'])(
  "fails without printing credentials for missing or invalid tokens",
  async (dotenv) => {
    const result = await runHelper(dotenv);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("MasterGo:");
    expect(result.stderr).not.toContain("invalid");
  },
);
