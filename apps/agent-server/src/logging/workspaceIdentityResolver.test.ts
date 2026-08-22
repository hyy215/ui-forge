/** 验证 Workspace 日志身份优先使用脱敏 Git remote，并安全回退到绝对路径。 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceIdentityResolver } from "./workspaceIdentityResolver.js";

describe("workspace identity resolver", () => {
  it("uses a credential-free Git remote as the workspace identity", async () => {
    const resolver = new WorkspaceIdentityResolver(async () => (
      "https://api-user:secret-token@github.com/acme/customer-console.git?token=hidden#fragment"
    ));

    const identity = await resolver.resolve("./customer-console");

    expect(identity).toMatchObject({
      type: "git",
      value: "https://github.com/acme/customer-console.git",
    });
    expect(identity.directoryName).toMatch(/^customer-console-[a-f0-9]{16}$/);
    expect(identity.directoryName).not.toContain("secret-token");
  });

  it("uses an absolute local path when the workspace has no Git remote", async () => {
    const resolver = new WorkspaceIdentityResolver(async () => undefined);

    const identity = await resolver.resolve("./fixtures/target-project");

    expect(identity).toMatchObject({
      type: "local",
      value: resolve("./fixtures/target-project"),
    });
    expect(identity.directoryName).toMatch(/^target-project-[a-f0-9]{16}$/);
  });
});
