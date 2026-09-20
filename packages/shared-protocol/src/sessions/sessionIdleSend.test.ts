import { expect, it } from "vitest";
import { sendSessionInputSchema } from "./sessionProtocol.js";

it("accepts an idle-only continuation flag and rejects non-boolean values", () => {
  expect(
    sendSessionInputSchema.parse({
      taskId: "task",
      text: "continue",
      startOnlyIfIdle: true,
    }),
  ).toEqual({
    taskId: "task",
    text: "continue",
    images: [],
    startOnlyIfIdle: true,
  });
  expect(
    sendSessionInputSchema.safeParse({
      taskId: "task",
      text: "continue",
      startOnlyIfIdle: "yes",
    }).success,
  ).toBe(false);
});
