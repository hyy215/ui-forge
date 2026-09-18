import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleDirectory } from "./d2c.js";

const python = process.env.UI_FORGE_TEST_PYTHON || "python3";
const available = spawnSync(python, ["-c", "import PIL"], { stdio: "ignore" }).status === 0;
const scripts = join(bundleDirectory, ".agents/skills/ui-forge-d2c/scripts");
const directories: string[] = [];
function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "d2c-pixels-"));
  directories.push(cwd);
  const result = spawnSync(
    python,
    [
      "-c",
      [
        "from PIL import Image",
        "image = Image.new('RGB', (10, 10), 'white')",
        "image.save('reference.png')",
        "image.putpixel((0, 0), (0, 0, 0))",
        "image.putpixel((1, 1), (0, 0, 0))",
        "image.save('actual.png')",
        "Image.new('RGB', (20, 10)).save('wide.png')",
      ].join("\n"),
    ],
    { cwd },
  );
  if (result.status !== 0) throw new Error("Cannot create image fixtures");
  return cwd;
}
function run(cwd: string, script: string, args: string[]) {
  const result = spawnSync(python, [join(scripts, script), ...args], { cwd, encoding: "utf8" });
  return { status: result.status, payload: JSON.parse(result.stdout) as unknown };
}
const compare = (actual: string) => [
  "--reference",
  "reference.png",
  "--actual",
  actual,
  "--diff",
  "diff.png",
  "--channel-tolerance",
  "8",
  "--max-different-pixel-ratio",
  "0.01",
  "--max-connected-region-ratio",
  "0.001",
];
afterEach(() => {
  for (const cwd of directories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe.skipIf(!available)("optional skill image scripts (Python + Pillow)", () => {
  it("accepts matching images and reports an eight-neighbor region for diagonal differences", () => {
    const cwd = setup();
    const reference = readFileSync(join(cwd, "reference.png"));
    expect(run(cwd, "compare_screenshots.py", compare("reference.png"))).toMatchObject({
      status: 0,
      payload: { pass: true, differentPixels: 0 },
    });
    expect(run(cwd, "compare_screenshots.py", compare("actual.png"))).toMatchObject({
      status: 1,
      payload: {
        pass: false,
        differentPixels: 2,
        connectedComponents: { count: 1, largestArea: 2 },
      },
    });
    expect(readFileSync(join(cwd, "reference.png"))).toEqual(reference);
    expect(readFileSync(join(cwd, "diff.png")).byteLength).toBeGreaterThan(0);
  });
  it("rejects mismatched dimensions and invalid thresholds instead of resizing the reference", () => {
    const cwd = setup();
    expect(run(cwd, "compare_screenshots.py", compare("wide.png"))).toMatchObject({
      status: 1,
      payload: { pass: false, dimensionsMatch: false },
    });
    expect(
      run(cwd, "compare_screenshots.py", [...compare("actual.png"), "--channel-tolerance", "256"]),
    ).toMatchObject({ status: 2, payload: { error: { kind: "invalid_argument" } } });
  });
  it("writes traceable slices and rejects crops outside the original image", () => {
    const cwd = setup();
    const args = [
      "--reference",
      "reference.png",
      "--manifest",
      "regions.json",
      "--output-dir",
      "slices",
      "--index",
      "index.json",
    ];
    writeFileSync(
      join(cwd, "regions.json"),
      JSON.stringify({ regions: [{ id: "header", x: 2, y: 1, width: 5, height: 3 }] }),
    );
    expect(run(cwd, "slice_reference.py", args)).toMatchObject({
      status: 0,
      payload: {
        ok: true,
        slices: [
          {
            id: "header",
            coordinateTransform: { sliceToReference: { translateX: 2, translateY: 1 } },
          },
        ],
      },
    });
    expect(readFileSync(join(cwd, "slices/header.png")).byteLength).toBeGreaterThan(0);
    writeFileSync(
      join(cwd, "regions.json"),
      JSON.stringify({ regions: [{ id: "bad", x: 9, y: 9, width: 3, height: 3 }] }),
    );
    expect(run(cwd, "slice_reference.py", args)).toMatchObject({
      status: 2,
      payload: { ok: false, error: expect.stringContaining("exceeds the canonical reference") },
    });
  });
});
