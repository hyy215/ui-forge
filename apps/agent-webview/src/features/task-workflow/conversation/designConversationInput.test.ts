/** 验证设计输入与确认口令始终采用可预测的确定性判断。 */

import { describe, expect, it } from "vitest";
import {
  classifyDesignConversationSubmission,
  designConfirmationCommand,
} from "./designConversationInput";

describe("classifyDesignConversationSubmission", () => {
  it("treats non-empty input as a design reference before a preview is ready", () => {
    expect(classifyDesignConversationSubmission(false, "  table-filter  ")).toEqual({
      kind: "inspect-design",
      reference: "table-filter",
    });
  });

  it("accepts only the exact trimmed confirmation command after preview", () => {
    expect(classifyDesignConversationSubmission(true, `  ${designConfirmationCommand}  `)).toEqual({
      kind: "confirm-design",
    });
    expect(classifyDesignConversationSubmission(true, "继续")).toEqual({ kind: "invalid-confirmation" });
    expect(classifyDesignConversationSubmission(true, "确认设计。")).toEqual({ kind: "invalid-confirmation" });
  });

  it("does not submit whitespace", () => {
    expect(classifyDesignConversationSubmission(false, "   ")).toEqual({ kind: "empty" });
  });
});
