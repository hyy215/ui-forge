import { describe, expect, it } from "vitest";
import { parseBenchmarkOptions, summarizeNumbers, summarizeSamples } from "./history-metrics.mjs";

describe("history benchmark metadata", () => {
  it("requires fresh output arguments and bounds repeats", () => {
    expect(parseBenchmarkOptions(["--output", "new-run"])).toEqual({
      output: "new-run",
      repeats: 3,
    });
    for (const args of [
      [],
      ["--output", " "],
      ["--output", "a", "--repeats", "0"],
      ["--output", "a", "--repeats", "6"],
      ["--output", "a", "--repeats", "1.5"],
      ["--output", "a", "--unknown"],
    ]) {
      expect(() => parseBenchmarkOptions(args)).toThrow();
    }
  });
  it("uses median and max without sorting the input in place", () => {
    const values = [20, 1, 3];
    expect(summarizeNumbers(values)).toEqual({ median: 3, max: 20 });
    expect(values).toEqual([20, 1, 3]);
    expect(summarizeNumbers([2, 4])).toEqual({ median: 3, max: 4 });
    for (const invalid of [[], [NaN], [Infinity], [-1], [undefined]])
      expect(() => summarizeNumbers(invalid)).toThrow();
  });
  it("refuses partial or duplicate groups", () => {
    expect(() => summarizeSamples([], 3)).toThrow();
    expect(() =>
      summarizeSamples(
        Array.from({ length: 3 }, () => ({ viewport: "desktop", historyItems: 100, repeat: 1 })),
        3,
      ),
    ).toThrow();
  });

  const samples = ["desktop", "narrow"].flatMap((viewport) =>
    [100, 500, 1000].flatMap((historyItems) =>
      [1, 2, 3].map((repeat) => ({
        viewport,
        historyItems,
        repeat,
        readyMs: repeat * 10,
        scrollReturnMs: repeat * 10,
        typingFrameMaxMs: repeat * 10,
        streamMs: repeat * 10,
        streamTailMs: repeat * 10,
        frameGapMaxMs: repeat * 10,
        longTaskCount: repeat,
        longTaskMaxMs: repeat * 10,
        approvalMs: repeat * 10,
        domElements: repeat * 10,
        heapMiB: repeat * 10,
      })),
    ),
  );
  it("summarizes all 18 samples in stable viewport/size groups", () => {
    const result = summarizeSamples([...samples].reverse(), 3);
    expect(result).toHaveLength(6);
    expect(
      result.map(({ viewport, historyItems }: { viewport: string; historyItems: number }) => [
        viewport,
        historyItems,
      ]),
    ).toEqual([
      ["desktop", 100],
      ["desktop", 500],
      ["desktop", 1000],
      ["narrow", 100],
      ["narrow", 500],
      ["narrow", 1000],
    ]);
    for (const group of result) {
      expect(group.metrics.readyMs).toEqual({ median: 20, max: 30 });
      expect(group.metrics.longTaskCount).toEqual({ median: 2, max: 3 });
    }
  });
  it("rejects damaged complete runs and unknown extra samples", () => {
    const first = samples[0]!;
    for (const invalid of [
      samples.slice(1),
      [first, first, ...samples.slice(2)],
      [...samples, { ...first, viewport: "unknown" }],
      [{ ...first, readyMs: NaN }, ...samples.slice(1)],
      [{ ...first, repeat: 0 }, ...samples.slice(1)],
    ])
      expect(() => summarizeSamples(invalid, 3)).toThrow();
  });
});
