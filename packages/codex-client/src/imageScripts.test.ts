import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleDirectory } from "./d2c.js";

const python = process.env.UI_FORGE_TEST_PYTHON || "python3";
const dependencyCheck = spawnSync(python, ["-c", "from PIL import Image"], {
  encoding: "utf8",
  timeout: 10_000,
});
const available = dependencyCheck.status === 0;
if (!available) {
  const reason =
    dependencyCheck.error?.message || dependencyCheck.stderr?.trim() || "dependency probe failed";
  const details = `Python/Pillow unavailable for ${JSON.stringify(python)}: ${reason}`;
  if (process.env.UI_FORGE_REQUIRE_IMAGE_TESTS === "1") {
    throw new Error(`UI_FORGE_REQUIRE_IMAGE_TESTS=1: image script tests must not skip. ${details}`);
  }
  console.warn(`Skipping image script tests. ${details}`);
}
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
        "boundary = Image.new('RGB', (10, 10), 'white')",
        "boundary.putpixel((0, 0), (247, 255, 255))",
        "boundary.save('at-tolerance.png')",
        "boundary.putpixel((0, 0), (246, 255, 255))",
        "boundary.save('over-tolerance.png')",
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
const slice = [
  "--reference",
  "reference.png",
  "--manifest",
  "regions.json",
  "--output-dir",
  "slices",
  "--index",
  "index.json",
];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const saveRegions = (cwd: string, ids = ["header"]) =>
  writeFileSync(
    join(cwd, "regions.json"),
    JSON.stringify({
      regions: ids.map((id) => ({ id, x: 2, y: 1, width: 5, height: 3 })),
    }),
  );
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
    const firstDiff = readFileSync(join(cwd, "diff.png"));
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
    expect(readFileSync(join(cwd, "diff.png"))).not.toEqual(firstDiff);
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
  it("uses inclusive ratio thresholds and a strict per-channel tolerance boundary", () => {
    const cwd = setup();
    expect(run(cwd, "compare_screenshots.py", compare("at-tolerance.png"))).toMatchObject({
      status: 0,
      payload: { pass: true, differentPixels: 0 },
    });
    const args = [...compare("over-tolerance.png"), "--max-connected-region-ratio", "0.01"];
    expect(run(cwd, "compare_screenshots.py", args)).toMatchObject({
      status: 0,
      payload: {
        pass: true,
        differentPixels: 1,
        differentPixelRatio: 0.01,
        connectedComponents: { largestRatio: 0.01 },
      },
    });
    expect(
      run(cwd, "compare_screenshots.py", [...args, "--max-different-pixel-ratio", "0.009"]),
    ).toMatchObject({
      status: 1,
      payload: { pass: false, failureReasons: ["different_pixel_ratio_exceeded"] },
    });
    expect(
      run(cwd, "compare_screenshots.py", [...args, "--max-connected-region-ratio", "0.009"]),
    ).toMatchObject({
      status: 1,
      payload: { pass: false, failureReasons: ["connected_region_ratio_exceeded"] },
    });
  });

  it.each([
    ["--channel-tolerance", "not-a-number"],
    ["--channel-tolerance", "-1"],
    ["--max-different-pixel-ratio", "nan"],
    ["--max-different-pixel-ratio", "1.1"],
    ["--max-connected-region-ratio", "-0.1"],
    ["--max-reported-regions", "-1"],
  ])("rejects invalid %s=%s without changing an existing diff", (flag, value) => {
    const cwd = setup();
    writeFileSync(join(cwd, "diff.png"), "existing diff");
    expect(
      run(cwd, "compare_screenshots.py", [...compare("actual.png"), flag, value]),
    ).toMatchObject({
      status: 2,
      payload: { pass: false, error: { kind: "invalid_argument" } },
    });
    expect(readFileSync(join(cwd, "diff.png"), "utf8")).toBe("existing diff");
  });

  it.each(["reference.png", "actual.png"])(
    "rejects direct, symbolic and hard-link diff aliases of %s",
    (target) => {
      const cwd = setup();
      const reference = readFileSync(join(cwd, "reference.png"));
      const actual = readFileSync(join(cwd, "actual.png"));
      symlinkSync(join(cwd, target), join(cwd, "symbolic.png"));
      linkSync(join(cwd, target), join(cwd, "hard.png"));
      for (const output of [target, "symbolic.png", "hard.png"]) {
        expect(
          run(cwd, "compare_screenshots.py", [...compare("actual.png"), "--diff", output]),
        ).toMatchObject({
          status: 2,
          payload: { pass: false, error: { kind: "output_collision" } },
        });
        expect(readFileSync(join(cwd, "reference.png"))).toEqual(reference);
        expect(readFileSync(join(cwd, "actual.png"))).toEqual(actual);
      }
    },
  );

  it("returns structured missing-image, corrupt-image and output-write failures", () => {
    const cwd = setup();
    writeFileSync(join(cwd, "corrupt.png"), "not an image");
    for (const actual of ["missing.png", "corrupt.png"]) {
      expect(run(cwd, "compare_screenshots.py", compare(actual))).toMatchObject({
        status: 2,
        payload: { pass: false, error: { kind: "image_read_failed" } },
      });
      expect(existsSync(join(cwd, "diff.png"))).toBe(false);
    }
    writeFileSync(join(cwd, "not-a-directory"), "keep this file");
    expect(
      run(cwd, "compare_screenshots.py", [
        ...compare("actual.png"),
        "--diff",
        "not-a-directory/diff.png",
      ]),
    ).toMatchObject({
      status: 2,
      payload: {
        pass: false,
        error: { kind: expect.stringMatching(/^(diff_write_failed|path_check_failed)$/) },
      },
    });
    expect(readFileSync(join(cwd, "not-a-directory"), "utf8")).toBe("keep this file");
  });

  it("records hashes of the compared bytes and the actual diff artifact", () => {
    const cwd = setup();
    const result = run(cwd, "compare_screenshots.py", compare("actual.png"));
    expect(result).toMatchObject({
      status: 1,
      payload: {
        artifacts: {
          reference: { sha256: hash(readFileSync(join(cwd, "reference.png"))) },
          actual: { sha256: hash(readFileSync(join(cwd, "actual.png"))) },
          diff: { sha256: hash(readFileSync(join(cwd, "diff.png"))) },
        },
      },
    });
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
    const sliceBytes = readFileSync(join(cwd, "slices/header.png"));
    expect(run(cwd, "slice_reference.py", args)).toMatchObject({
      status: 0,
      payload: { ok: true },
    });
    expect(readFileSync(join(cwd, "slices/header.png"))).toEqual(sliceBytes);
    writeFileSync(
      join(cwd, "regions.json"),
      JSON.stringify({ regions: [{ id: "bad", x: 9, y: 9, width: 3, height: 3 }] }),
    );
    expect(run(cwd, "slice_reference.py", args)).toMatchObject({
      status: 2,
      payload: { ok: false, error: expect.stringContaining("exceeds the canonical reference") },
    });
    expect(readFileSync(join(cwd, "slices/header.png"))).toEqual(sliceBytes);
  });

  it.each(["reference.png", "regions.json"])(
    "rejects index aliases of %s before modifying any slice",
    (target) => {
      const cwd = setup();
      saveRegions(cwd);
      mkdirSync(join(cwd, "slices"));
      writeFileSync(join(cwd, "slices/header.png"), "existing slice");
      const reference = readFileSync(join(cwd, "reference.png"));
      const manifest = readFileSync(join(cwd, "regions.json"));
      symlinkSync(join(cwd, target), join(cwd, "symbolic-index.json"));
      linkSync(join(cwd, target), join(cwd, "hard-index.json"));
      for (const output of [target, "symbolic-index.json", "hard-index.json"]) {
        expect(run(cwd, "slice_reference.py", [...slice, "--index", output])).toMatchObject({
          status: 2,
          payload: { ok: false, error: expect.stringContaining("collide") },
        });
        expect(readFileSync(join(cwd, "reference.png"))).toEqual(reference);
        expect(readFileSync(join(cwd, "regions.json"))).toEqual(manifest);
        expect(readFileSync(join(cwd, "slices/header.png"), "utf8")).toBe("existing slice");
      }
    },
  );

  it("rejects slices that alias either input before writing earlier slices", () => {
    const cwd = setup();
    saveRegions(cwd, ["first", "protected"]);
    mkdirSync(join(cwd, "slices"));
    writeFileSync(join(cwd, "slices/first.png"), "earlier slice");
    const reference = readFileSync(join(cwd, "reference.png"));
    const manifest = readFileSync(join(cwd, "regions.json"));
    for (const target of ["reference.png", "regions.json"]) {
      for (const link of [symlinkSync, linkSync]) {
        link(join(cwd, target), join(cwd, "slices/protected.png"));
        expect(run(cwd, "slice_reference.py", slice)).toMatchObject({
          status: 2,
          payload: { ok: false, error: expect.stringContaining("collide") },
        });
        expect(readFileSync(join(cwd, "reference.png"))).toEqual(reference);
        expect(readFileSync(join(cwd, "regions.json"))).toEqual(manifest);
        expect(readFileSync(join(cwd, "slices/first.png"), "utf8")).toBe("earlier slice");
        expect(existsSync(join(cwd, "index.json"))).toBe(false);
        rmSync(join(cwd, "slices/protected.png"));
      }
    }
  });

  it.each(["same-path", "symbolic", "hard", "case-variant"])(
    "rejects index/crop collisions via %s",
    (kind) => {
      const cwd = setup();
      saveRegions(cwd);
      mkdirSync(join(cwd, "slices"));
      const crop = join(cwd, "slices/header.png");
      writeFileSync(crop, "existing slice");
      let index = "slices/header.png";
      if (kind === "case-variant") index = "slices/HEADER.PNG";
      if (kind === "symbolic" || kind === "hard") {
        index = "index.json";
        (kind === "symbolic" ? symlinkSync : linkSync)(crop, join(cwd, index));
      }
      expect(run(cwd, "slice_reference.py", [...slice, "--index", index])).toMatchObject({
        status: 2,
        payload: { ok: false, error: expect.stringContaining("collide") },
      });
      expect(readFileSync(crop, "utf8")).toBe("existing slice");
    },
  );

  it.each(["symbolic", "hard"])("rejects %s aliases between two distinct slice outputs", (kind) => {
    const cwd = setup();
    saveRegions(cwd, ["first", "second"]);
    mkdirSync(join(cwd, "slices"));
    writeFileSync(join(cwd, "slices/first.png"), "existing slice");
    (kind === "symbolic" ? symlinkSync : linkSync)(
      join(cwd, "slices/first.png"),
      join(cwd, "slices/second.png"),
    );
    expect(run(cwd, "slice_reference.py", slice)).toMatchObject({
      status: 2,
      payload: { ok: false },
    });
    expect(readFileSync(join(cwd, "slices/first.png"), "utf8")).toBe("existing slice");
    expect(existsSync(join(cwd, "index.json"))).toBe(false);
  });

  it("rejects direct crop/input collisions and portable case-insensitive region duplicates", () => {
    const cwd = setup();
    saveRegions(cwd, ["reference"]);
    const original = readFileSync(join(cwd, "reference.png"));
    expect(run(cwd, "slice_reference.py", [...slice, "--output-dir", "."])).toMatchObject({
      status: 2,
      payload: { ok: false, error: expect.stringContaining("collide") },
    });
    expect(readFileSync(join(cwd, "reference.png"))).toEqual(original);
    saveRegions(cwd, ["header", "HEADER"]);
    expect(run(cwd, "slice_reference.py", slice)).toMatchObject({
      status: 2,
      payload: { ok: false, error: expect.stringContaining("duplicate region id") },
    });
    expect(existsSync(join(cwd, "slices"))).toBe(false);
  });

  it("returns structured slicer failures without touching outputs for bad input or parents", () => {
    const cwd = setup();
    saveRegions(cwd);
    expect(run(cwd, "slice_reference.py", [...slice, "--reference", "missing.png"])).toMatchObject({
      status: 2,
      payload: { ok: false },
    });
    expect(run(cwd, "slice_reference.py", [...slice, "--unknown"])).toMatchObject({
      status: 2,
      payload: { ok: false },
    });
    writeFileSync(join(cwd, "blocked"), "existing file");
    expect(
      run(cwd, "slice_reference.py", [...slice, "--index", "blocked/index.json"]),
    ).toMatchObject({ status: 2, payload: { ok: false } });
    expect(readFileSync(join(cwd, "blocked"), "utf8")).toBe("existing file");
    expect(existsSync(join(cwd, "slices"))).toBe(false);
  });

  it("records the exact source, manifest and generated slice hashes", () => {
    const cwd = setup();
    saveRegions(cwd);
    const result = run(cwd, "slice_reference.py", slice);
    expect(result).toMatchObject({
      status: 0,
      payload: {
        reference: { sha256: hash(readFileSync(join(cwd, "reference.png"))) },
        manifest: { sha256: hash(readFileSync(join(cwd, "regions.json"))) },
        slices: [{ sha256: hash(readFileSync(join(cwd, "slices/header.png"))) }],
      },
    });
    expect(JSON.parse(readFileSync(join(cwd, "index.json"), "utf8")) as unknown).toEqual(
      result.payload,
    );
  });

  it.each(["compare_screenshots.py", "slice_reference.py"])(
    "%s hashes the same input bytes it decoded rather than reopening the files",
    (script) => {
      const cwd = setup();
      saveRegions(cwd);
      const referenceHash = hash(readFileSync(join(cwd, "reference.png")));
      const manifestHash = hash(readFileSync(join(cwd, "regions.json")));
      const comparison = script === "compare_screenshots.py";
      const result = spawnSync(
        python,
        [
          "-c",
          [
            "from pathlib import Path",
            "import runpy, sys",
            "read_bytes = Path.read_bytes",
            "def replace_after_read(path):",
            "    data = read_bytes(path)",
            "    if path.name in ('reference.png', 'regions.json'):",
            "        path.write_bytes(b'changed after the input read')",
            "    return data",
            "Path.read_bytes = replace_after_read",
            "sys.argv = sys.argv[1:]",
            "runpy.run_path(sys.argv[0], run_name='__main__')",
          ].join("\n"),
          join(scripts, script),
          ...(comparison ? compare("actual.png") : slice),
        ],
        { cwd, encoding: "utf8" },
      );
      expect(result.status).toBe(comparison ? 1 : 0);
      expect(JSON.parse(result.stdout) as unknown).toMatchObject(
        comparison
          ? { differentPixels: 2, artifacts: { reference: { sha256: referenceHash } } }
          : { ok: true, reference: { sha256: referenceHash }, manifest: { sha256: manifestHash } },
      );
      expect(readFileSync(join(cwd, "reference.png"), "utf8")).toBe("changed after the input read");
    },
  );
});
