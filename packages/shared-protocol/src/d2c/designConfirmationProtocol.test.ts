/** 验证设计确认协议只约束数据形状，精确口令由领域层校验。 */
import { describe, expect, it } from "vitest";
import { confirmD2CDesignInputSchema } from "./designConfirmationProtocol.js";

describe("design confirmation protocol", () => {
  it("accepts a non-empty confirmation value for domain validation", () => {
    expect(confirmD2CDesignInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      confirmation: "确认",
    })).toMatchObject({ confirmation: "确认" });
  });

  it("rejects an empty confirmation value", () => {
    expect(() => confirmD2CDesignInputSchema.parse({
      taskId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      confirmation: "",
    })).toThrow();
  });
});
