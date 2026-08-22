/** 验证 d2c-agent 包的公共 Facade 只暴露创建 Service 的单一工厂。 */

import { describe, expect, it } from "vitest";
import { D2CAgent } from "./d2cAgent.js";

describe("D2CAgent", () => {
  it("exposes only createService as a static public operation", () => {
    const operations = Object.getOwnPropertyNames(D2CAgent).filter(
      (name) => !["length", "name", "prototype"].includes(name),
    );

    expect(operations).toEqual(["createService"]);
  });
});
