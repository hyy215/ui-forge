import { describe, expect, it } from "vitest";
import { sendSessionInputSchema } from "./sessionProtocol.js";

const image = { name: "design.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };

describe("supplemental image input", () => {
  it("accepts existing text clients, image-only messages, and mixed messages", () => {
    expect(sendSessionInputSchema.parse({ taskId: "t", text: " hello " })).toEqual({
      taskId: "t",
      text: "hello",
      images: [],
    });
    expect(sendSessionInputSchema.parse({ taskId: "t", images: [image] })).toEqual({
      taskId: "t",
      text: "",
      images: [image],
    });
    expect(
      sendSessionInputSchema.parse({ taskId: "t", text: "change", images: [image] }).images,
    ).toEqual([image]);
  });
  it.each([
    { taskId: "t", text: "  " },
    { taskId: "t", text: "hi", images: Array.from({ length: 5 }, () => image) },
    { taskId: "t", images: [{ name: "image.svg", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }] },
    { taskId: "t", images: [{ name: "image.png", dataUrl: "file:///etc/passwd" }] },
    { taskId: "t", images: [{ ...image, path: "/tmp/private.png" }] },
    { taskId: "t", images: [image], sandbox: "danger-full-access" },
  ])("rejects empty or invalid external input: %j", (input) => {
    expect(sendSessionInputSchema.safeParse(input).success).toBe(false);
  });
});
