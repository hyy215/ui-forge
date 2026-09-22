import { describe, expect, it } from "vitest";
import { formatDiagnosticDuration } from "./diagnosticsPresentation";

describe("diagnostic durations", () => {
  it("keeps unknown durations distinct from recorded zero", () => {
    expect(formatDiagnosticDuration(null)).toBe("未知");
    expect(formatDiagnosticDuration(0)).toBe("0 ms");
    expect(formatDiagnosticDuration(2000)).toBe("2 秒");
  });
});
