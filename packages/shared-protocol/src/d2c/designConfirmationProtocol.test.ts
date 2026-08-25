/** 验证设计确认协议只接受精确口令。 */
import { describe, expect, it } from "vitest";
import { confirmD2CDesignInputSchema } from "./designConfirmationProtocol.js";

describe("design confirmation protocol", () => {
  it("accepts the exact persisted confirmation command", () => {
    expect(confirmD2CDesignInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      confirmation: "确认设计",
    })).toMatchObject({ confirmation: "确认设计" });
  });

  it("rejects approximate confirmation text", () => {
    expect(() => confirmD2CDesignInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      confirmation: "确认",
    })).toThrow();
  });
});
