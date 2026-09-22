import { expect, it } from "vitest";
import type { NativeMethods } from "@ui-forge/codex-client";
import { thread, turn } from "../../../../packages/codex-client/src/testing/payloads.js";
import { projectTaskDiagnostics } from "./taskDiagnostics.js";

type Thread = NativeMethods["thread/read"]["result"]["thread"];
type Item = Thread["turns"][number]["items"][number];
const metadata = { ruleFingerprints: null, tokenUsage: null, warnings: [] };
const command = (id: string, durationMs: number | null): Item => ({
  type: "commandExecution",
  id,
  pluginId: null,
  scriptPath: "/private/script",
  command: "echo secret-command",
  cwd: "/private/project",
  processId: null,
  source: "agent",
  status: "completed",
  commandActions: [],
  aggregatedOutput: "secret-output",
  exitCode: 0,
  durationMs,
});

it("deduplicates tools by turn and item, preserves missing timings and exports no payload fields", () => {
  const source: Thread = {
    ...thread,
    cwd: "/private/project",
    name: "secret-title",
    preview: "secret-prompt",
    turns: [
      {
        ...turn,
        status: "failed",
        durationMs: 5,
        error: {
          message: "secret-error",
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } },
          additionalDetails: "secret-detail",
        },
        items: [
          command("same", 10),
          command("same", 20),
          command("unknown-duration", null),
          {
            type: "mcpToolCall",
            id: "mcp",
            server: "private-server",
            tool: "private-tool",
            status: "failed",
            arguments: { secret: "private-argument" },
            appContext: null,
            pluginId: null,
            readOnlyHint: null,
            result: null,
            error: { message: "private-result" },
            durationMs: null,
          },
        ],
      },
      { ...turn, id: "second", itemsView: "summary", items: [command("same", 30)] },
    ],
  };
  const result = projectTaskDiagnostics(source, metadata);
  expect(result.turns[0]).toMatchObject({
    durationMs: 5,
    errorCode: "httpConnectionFailed",
    tools: [
      { type: "commandExecution", count: 2, completed: 2, timedCount: 1, knownDurationMs: 20 },
      { type: "mcpToolCall", count: 1, failed: 1, timedCount: 0, knownDurationMs: null },
    ],
  });
  expect(result.turns[1]?.tools[0]).toMatchObject({ count: 1, knownDurationMs: 30 });
  expect(result.warnings).toEqual([
    "rulesUnavailable",
    "tokenUsageUnavailable",
    "runtimeUnavailable",
    "historyIncomplete",
  ]);
  const output = JSON.stringify(result);
  expect(output).not.toMatch(
    /secret-|private-|\/private|httpStatusCode|commandActions|arguments|aggregatedOutput/,
  );
  expect(result).not.toHaveProperty("acceptance");
});

it("omits unsafe model identifiers and never infers an error category from its message", () => {
  const result = projectTaskDiagnostics(
    {
      ...thread,
      model: "model\nAuthorization: secret",
      modelProvider: "https://private/provider",
      cliVersion: "bad\u001bversion",
      reasoningEffort: "custom-value",
      turns: [
        {
          ...turn,
          status: "failed",
          error: { message: "serverOverloaded", codexErrorInfo: null, additionalDetails: null },
        },
      ],
    },
    metadata,
  );
  expect(result).toMatchObject({
    model: null,
    modelProvider: null,
    codexVersion: null,
    reasoningEffort: null,
  });
  expect(result.turns[0]?.errorCode).toBe("other");
});
