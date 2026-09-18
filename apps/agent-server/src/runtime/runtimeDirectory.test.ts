import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolveRuntimeDirectory } from "./runtimeDirectory.js";

it("uses the same absolute directory for default and relative configuration", () => {
  const expected = fileURLToPath(new URL("../../../../.ui-forge/runtime", import.meta.url));
  expect(resolveRuntimeDirectory()).toBe(expected);
  expect(resolveRuntimeDirectory(".ui-forge/runtime")).toBe(expected);
  expect(resolveRuntimeDirectory("/tmp/ui-forge-test-runtime")).toBe("/tmp/ui-forge-test-runtime");
});
