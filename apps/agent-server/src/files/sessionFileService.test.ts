import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { prepareTemporaryWorkspace } from "@ui-forge/codex-client";
import {
  createCommunicationRequestMessage,
  sessionFileMethods,
  sessionFileRoute,
} from "@ui-forge/shared-protocol";
import { buildApp } from "../http/buildApp.js";
import { SessionService } from "../sessions/sessionService.js";

let directory: string;
let workspace: string;
let temporary: string;
let app: ReturnType<typeof buildApp>;
const launch = vi.fn(() => {
  throw new Error("Opening a file must never start Codex");
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
const url = (path: string, taskId = "task-1") =>
  `${sessionFileRoute}?${new URLSearchParams({ taskId, path })}`;

beforeEach(async () => {
  launch.mockClear();
  directory = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-file-links-")));
  workspace = join(directory, "target");
  await mkdir(workspace);
  const runtime = join(directory, "runtime");
  temporary = await prepareTemporaryWorkspace(workspace, runtime);
  await mkdir(join(temporary, "main"));
  await writeFile(join(temporary, "main", "实际截图 (1).png"), png);
  await writeFile(join(temporary, "main", "verification.md"), "# 真实验收记录\n\n完成\n");
  await writeFile(join(workspace, "App.tsx"), "line 1\nline 2\n");
  const sessions = new SessionService({ directory: runtime, connectionFactory: launch });
  app = buildApp({ sessionService: sessions, runtimeDirectory: runtime, instanceLock: false });
  await app.ready();
  await sessions.index.put({
    taskId: "task-1",
    projectPath: workspace,
    title: "files",
    updatedAt: new Date().toISOString(),
  });
});
afterEach(async () => {
  await app.close();
  expect(launch).not.toHaveBeenCalled();
  await rm(directory, { recursive: true, force: true });
});

it("opens the actual screenshot bytes and report from ui-forge temporary storage", async () => {
  const response = await app.inject({ url: url(join(temporary, "main", "实际截图 (1).png")) });
  expect(response.statusCode).toBe(200);
  expect(response.rawPayload).toEqual(png);
  expect(response.headers["content-type"]).toBe("image/png");
  expect(response.headers["cache-control"]).toBe("no-store");
  const report = await app.inject({ url: url(join(temporary, "main", "verification.md")) });
  expect(report.statusCode).toBe(200);
  expect(report.body).toBe("# 真实验收记录\n\n完成\n");
  expect(report.headers["content-type"]).toContain("text/plain");
});

it("resolves relative files, encoded paths and file URIs with editor positions", async () => {
  for (const path of ["App.tsx:2:3", pathToFileURL(join(workspace, "App.tsx")).href + "#L2C3"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("open-1", sessionFileMethods.open, {
        taskId: "task-1",
        path,
      }),
    });
    expect(response.json()).toMatchObject({
      requestId: "open-1",
      success: true,
      data: { path: join(workspace, "App.tsx"), line: 2, column: 3 },
    });
  }
  expect(
    (
      await app.inject({
        url: url(join(temporary, "main", encodeURIComponent("实际截图 (1).png"))),
      })
    ).rawPayload,
  ).toEqual(png);
});

it("rejects directories, unknown tasks, missing files, traversal, sibling projects and symlink escapes", async () => {
  const outside = join(directory, "secret.txt");
  await writeFile(outside, "not exposed");
  const sibling = join(directory, "target-other");
  await mkdir(sibling);
  await writeFile(join(sibling, "file.txt"), "not exposed");
  await symlink(outside, join(workspace, "escape.txt"));
  const anotherTemporary = await prepareTemporaryWorkspace(sibling, join(directory, "runtime"));
  await writeFile(join(anotherTemporary, "file.txt"), "not exposed");
  for (const path of [
    ".",
    "missing.md",
    "../secret.txt",
    join(sibling, "file.txt"),
    "escape.txt",
    join(anotherTemporary, "file.txt"),
    "file://remote/file.md",
    "command:execute",
    "%00",
    "App.tsx:0",
  ]) {
    const response = await app.inject({ url: url(path) });
    expect(response.statusCode, path).toBe(404);
    expect(response.body).not.toContain("not exposed");
  }
  expect((await app.inject({ url: url("App.tsx", "unknown") })).statusCode).toBe(404);
  expect((await app.inject({ url: sessionFileRoute })).statusCode).toBe(400);
});

it("does not execute HTML or accept cross-site file requests", async () => {
  await writeFile(join(workspace, "preview.html"), "<script>alert('file')</script>");
  const response = await app.inject({ url: url("preview.html") });
  expect(response.headers["content-type"]).toContain("text/plain");
  expect(response.headers["content-security-policy"]).toContain("sandbox");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(
    (await app.inject({ url: url("App.tsx"), headers: { "sec-fetch-site": "cross-site" } }))
      .statusCode,
  ).toBe(403);
});
