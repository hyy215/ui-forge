import { describe, expect, it, vi } from "vitest";
import { VibeLeases, vibeInstanceKey } from "./vibeLeases.js";

describe("native Vibe resource guards", () => {
  it("treats loopback aliases and paths at one native status port as the same instance", () => {
    expect(vibeInstanceKey("http://localhost:20678/mcp")).toBe(
      vibeInstanceKey("http://127.0.0.1:20678/other"),
    );
    expect(vibeInstanceKey("http://[::1]:20678/mcp")).toBe("20678");
    expect(vibeInstanceKey("http://localhost/mcp")).toBe("80");
    expect(vibeInstanceKey("http://localhost:20679/mcp")).not.toBe("20678");
  });

  it("does not run or grant access when an existing native task cannot be read", async () => {
    const read = vi.fn().mockRejectedValue(new Error("History unavailable"));
    const action = vi.fn(async () => undefined);
    const leases = new VibeLeases(() => [{ taskId: "old", bindingId: "old-binding" }], read);
    await expect(leases.run("20678", "new-binding", action)).rejects.toThrow("无法确认");
    expect(action).not.toHaveBeenCalled();
    await expect(leases.assertOwner("20678", "new-binding", "new")).rejects.toThrow("未持有");
  });

  it.each([
    { status: { type: "active" }, turns: [] },
    { status: { type: "idle" }, turns: [{ status: "inProgress" }] },
  ])("retains occupancy when either native field is active: %j", async (snapshot) => {
    const read = vi.fn().mockResolvedValue(snapshot);
    const action = vi.fn(async () => undefined);
    const leases = new VibeLeases(() => [{ taskId: "old", bindingId: "old-binding" }], read);
    await expect(leases.run("20678", "new-binding", action)).rejects.toThrow("使用");
    expect(action).not.toHaveBeenCalled();
  });

  it("permits a later attempt after a rejected action without a second execution state", async () => {
    const leases = new VibeLeases(() => [], vi.fn());
    await expect(
      leases.run("20678", "failed", async () => {
        throw new Error("Unavailable");
      }),
    ).rejects.toThrow("Unavailable");
    await expect(leases.run("20678", "next", async () => "ready")).resolves.toBe("ready");
  });
});
