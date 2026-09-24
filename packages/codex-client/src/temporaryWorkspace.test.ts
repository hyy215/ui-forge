import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  prepareTemporaryWorkspace,
  temporaryWorkspaceContext,
  temporaryWorkspaceEnvironment,
  temporaryWorkspacePath,
  temporaryWorkspacePathForCanonicalCwd,
} from "./temporaryWorkspace.js";
import { nativeSchemas, validateNative } from "./protocol.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-temp-test-")));
  directories.push(root);
  const target = join(root, "target");
  const other = join(root, "other");
  await mkdir(target);
  await mkdir(other);
  return { root, target, other, runtime: join(root, "ui-forge", ".ui-forge", "runtime") };
}

it("reuses one project directory across restarts and isolates different target projects", async () => {
  const { target, other, runtime } = await setup();
  const first = await prepareTemporaryWorkspace(target, runtime);
  expect(await prepareTemporaryWorkspace(join(target, "."), runtime)).toBe(first);
  expect(await prepareTemporaryWorkspace(other, runtime)).not.toBe(first);
  expect(dirname(first)).toBe(join(runtime, "tmp"));
  expect(await readdir(target)).toEqual([]);
});

it("locates historical artifacts from a saved canonical identity without requiring the workspace", async () => {
  const { root, target, runtime } = await setup();
  const alias = join(root, "alias");
  await symlink(target, alias);
  const expected = await temporaryWorkspacePath(alias, runtime);
  expect(temporaryWorkspacePathForCanonicalCwd(target, runtime)).toBe(expected);
  await rename(target, join(root, "renamed-target"));
  expect(temporaryWorkspacePathForCanonicalCwd(target, runtime)).toBe(expected);
  await expect(temporaryWorkspacePath(target, runtime)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(temporaryWorkspacePath(alias, runtime)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readdir(runtime)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects relative workspace identities instead of deriving an artifact directory", async () => {
  const { runtime } = await setup();
  expect(() => temporaryWorkspacePathForCanonicalCwd("relative-project", runtime)).toThrow(
    "规范绝对路径",
  );
});

it("routes actual child-process temporary output outside the target and validates native context envelopes", async () => {
  const { target, runtime } = await setup();
  const directory = await prepareTemporaryWorkspace(target, runtime);
  const environment = temporaryWorkspaceEnvironment(directory);
  expect(environment.PWTEST_SOCKETS_DIR).not.toContain(directory);
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const fs=require('fs'),p=require('path'),os=require('os');const out=p.join(os.tmpdir(),'report.json');fs.writeFileSync(out,'{}');console.log(out)",
    ],
    {
      cwd: target,
      env: { ...process.env, ...environment },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(join(directory, "report.json"));
  expect(await readFile(join(directory, "report.json"), "utf8")).toBe("{}");
  expect(await readdir(target)).toEqual([]);
  const additionalContext = temporaryWorkspaceContext(directory);
  for (const method of ["turn/start", "turn/steer"] as const) {
    expect(() =>
      validateNative(nativeSchemas.clientMethods[method].params, {
        threadId: "t",
        input: [],
        additionalContext,
        ...(method === "turn/steer" ? { expectedTurnId: "turn" } : {}),
      }),
    ).not.toThrow();
  }
});

it("reports directory creation failures instead of falling back to the target", async () => {
  const { root, target } = await setup();
  const blocked = join(root, "blocked");
  await writeFile(blocked, "file");
  await expect(prepareTemporaryWorkspace(target, blocked)).rejects.toThrow();
  expect(await readdir(target)).toEqual([]);
});
