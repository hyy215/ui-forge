import { expect, it } from "vitest";
import { resolveServerEndpoint } from "./serverEndpoint.js";

it("prefers the explicit user setting and normalizes the communication endpoint", () => {
  expect(resolveServerEndpoint()).toBe("http://127.0.0.1:4310/api/communication");
  expect(resolveServerEndpoint(undefined, "http://localhost:5321/")).toBe(
    "http://localhost:5321/api/communication",
  );
  expect(resolveServerEndpoint(" http://[::1]:6000/ ", "http://localhost:5321")).toBe(
    "http://[::1]:6000/api/communication",
  );
});

it.each([
  "",
  "invalid",
  4310,
  {},
  "https://localhost:4310",
  "http://example.com:4310",
  "http://127.0.0.1.example.com",
  "http://user:secret@localhost:4310",
  "http://localhost:0",
  "http://localhost:65536",
  "http://localhost:4310/api",
  "http://localhost:4310?token=secret",
  "http://localhost:4310#fragment",
])("rejects invalid configuration without falling back to another backend: %j", (value) => {
  expect(() => resolveServerEndpoint(value, "http://localhost:4310")).toThrow("ui-forge.serverUrl");
});
