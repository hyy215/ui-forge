import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const vitest = join(root, "node_modules/vitest/vitest.mjs");
const directories: string[] = [];
const testCounts = z.object({
  numTotalTests: z.number(),
  numPassedTests: z.number(),
  numPendingTests: z.number(),
  numFailedTests: z.number(),
});

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

it.each([
  { required: true, missingExecutable: true },
  { required: true, missingExecutable: false },
  { required: false, missingExecutable: true },
  { required: false, missingExecutable: false },
])(
  "enforces image dependencies: required=$required, missingExecutable=$missingExecutable",
  ({ required, missingExecutable }) => {
    const directory = mkdtempSync(join(tmpdir(), "image-test-environment-"));
    directories.push(directory);
    const env = { ...process.env };
    // Node exists but rejects the Python import probe, exercising a nonzero exit as well as ENOENT.
    env.UI_FORGE_TEST_PYTHON = missingExecutable
      ? join(directory, "missing-python")
      : process.execPath;
    if (required) env.UI_FORGE_REQUIRE_IMAGE_TESTS = "1";
    else delete env.UI_FORGE_REQUIRE_IMAGE_TESTS;

    const result = spawnSync(
      process.execPath,
      [vitest, "run", "packages/codex-client/src/imageScripts.test.ts", "--reporter=json"],
      { cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    expect(result.error).toBeUndefined();
    if (required) {
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(
        "UI_FORGE_REQUIRE_IMAGE_TESTS=1: image script tests must not skip",
      );
    } else {
      expect(result.status).toBe(0);
      const counts = testCounts.parse(JSON.parse(result.stdout));
      expect(counts.numTotalTests).toBeGreaterThan(0);
      expect(counts.numPendingTests).toBe(counts.numTotalTests);
      expect(counts.numPassedTests).toBe(0);
      expect(counts.numFailedTests).toBe(0);
    }
  },
  45_000,
);
