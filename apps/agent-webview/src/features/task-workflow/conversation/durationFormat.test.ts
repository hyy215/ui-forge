import { describe, expect, it } from "vitest";
import { formatDurationInSeconds } from "./durationFormat";

describe("formatDurationInSeconds", () => {
  it("uses seconds as the smallest visible unit", () => {
    expect(formatDurationInSeconds(0)).toBe("0s");
    expect(formatDurationInSeconds(1)).toBe("<1s");
    expect(formatDurationInSeconds(999)).toBe("<1s");
    expect(formatDurationInSeconds(1_000)).toBe("1s");
    expect(formatDurationInSeconds(1_499)).toBe("1s");
    expect(formatDurationInSeconds(1_500)).toBe("2s");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDurationInSeconds(-1)).toBe("0s");
  });
});
