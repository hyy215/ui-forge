import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDeliveryFile, sourceDeliveryPath } from "./deliveryFiles.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

let directory: string;

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockReset().mockImplementation(actual.open);
  directory = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-delivery-race-")));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it.each(["../outside.txt", "../../secret.txt", "nested/../../outside.txt"])(
  "rejects a parent source path before attempting workspace reads: %s",
  (path) => {
    expect(() => sourceDeliveryPath(path, join(directory, "missing-workspace"))).toThrow(
      "outside-scope",
    );
    expect(open).not.toHaveBeenCalled();
  },
);

it("rejects a path replaced after reading the original handle and still closes that handle", async () => {
  const path = join(directory, "report.json");
  const replacement = join(directory, "replacement.json");
  await writeFile(path, "original");
  await writeFile(replacement, "replaced");
  const handle = await open(path, "r");
  const originalStat = handle.stat.bind(handle);
  const firstStat = await originalStat();
  const statSpy = vi.spyOn(handle, "stat");
  statSpy.mockResolvedValueOnce(firstStat);
  statSpy.mockImplementationOnce(async () => {
    // The second handle stat is reached only after its bytes have been read.
    await rename(replacement, path);
    return originalStat();
  });
  const closeSpy = vi.spyOn(handle, "close");
  vi.mocked(open).mockResolvedValueOnce(handle);

  await expect(
    readDeliveryFile(path, [directory], { remaining: 1024 }, 1024),
  ).rejects.toMatchObject({
    reason: "unreadable",
  });
  expect(statSpy).toHaveBeenCalledTimes(2);
  expect(closeSpy).toHaveBeenCalledOnce();
});
