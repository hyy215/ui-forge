import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { deliveryReportPath, prepareTemporaryWorkspace } from "@ui-forge/codex-client";
import type { DeliveryManifest, NativeThread } from "@ui-forge/shared-protocol";
import { SessionIndex } from "../sessions/sessionIndex.js";
import { DeliveryService } from "./deliveryService.js";

let directory: string;
let workspace: string;
let runtime: string;
let index: SessionIndex;
let temporary: string;
let reportPath: string;
let service: DeliveryService;
let history: NativeThread;
const readNative = vi.fn<(taskId: string) => Promise<NativeThread>>();
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function manifest(overrides: Partial<DeliveryManifest> = {}): DeliveryManifest {
  return {
    version: 1,
    taskId: "task-1",
    generatedAt: "2026-09-23T00:00:00.000Z",
    summary: "交付声明，不代表独立验收",
    sourceFiles: [],
    checks: [
      {
        id: "build",
        category: "build",
        title: "构建",
        declaredStatus: "passed",
        details: "",
        evidence: [],
      },
    ],
    ...overrides,
  };
}

async function save(value: DeliveryManifest = manifest()): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(value));
}

async function saveRaw(value: unknown): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(value));
}

async function sparseFile(path: string, size: number): Promise<void> {
  const file = await open(path, "w");
  try {
    await file.truncate(size);
  } finally {
    await file.close();
  }
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "ui-forge-delivery-")));
  workspace = join(directory, "project");
  await mkdir(workspace);
  runtime = join(directory, "runtime");
  index = new SessionIndex(runtime);
  await index.initialize();
  await index.put({
    taskId: "task-1",
    projectPath: workspace,
    title: "delivery",
    updatedAt: "2026-09-23T00:00:00.000Z",
  });
  temporary = await prepareTemporaryWorkspace(workspace, runtime);
  reportPath = deliveryReportPath(temporary, "task-1");
  history = {
    id: "task-1",
    cwd: workspace,
    preview: "",
    name: null,
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    turns: [],
  };
  readNative.mockReset();
  readNative.mockImplementation(async () => history);
  service = new DeliveryService(index, runtime, readNative);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("does not read native history or create a report when none exists", async () => {
  expect(await service.read("task-1")).toMatchObject({
    availability: "missing",
    issue: null,
    report: null,
    source: { state: "unverifiable" },
    history: "not-requested",
  });
  expect(readNative).not.toHaveBeenCalled();
  await expect(service.read("unknown")).rejects.toThrow("任务不存在");
});

it("keeps a declared pass separate from evidence and does not treat an empty source list as current", async () => {
  const report = manifest();
  await save(report);
  const result = await service.read("task-1");
  expect(result).toMatchObject({
    availability: "available",
    issue: null,
    report,
    reportSha256: hash(JSON.stringify(report)),
    source: { state: "unverifiable", manifestFingerprint: null, files: [] },
    evidence: [],
    history: "not-requested",
  });
  expect(result).not.toHaveProperty("status");
  expect(result).not.toHaveProperty("passed");
  expect(readNative).not.toHaveBeenCalled();
});

it("keeps legacy path evidence available but marks it unsupported", async () => {
  await saveRaw(
    manifest({
      checks: [
        {
          id: "performance",
          category: "performance",
          title: "性能",
          declaredStatus: "passed",
          details: "旧报告格式",
          evidence: ["/tmp/validation/performance.json"],
        },
      ],
    }),
  );
  const result = await service.read("task-1");
  expect(result).toMatchObject({
    availability: "available",
    report: {
      checks: [
        {
          category: "performance",
          evidence: [{ kind: "legacy", path: "/tmp/validation/performance.json" }],
        },
      ],
    },
    evidence: [
      {
        checkId: "performance",
        index: 0,
        state: "unsupported",
        resolvedPath: null,
        exitCode: null,
      },
    ],
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("reads a matching report from the pre-hash path only when the task path is missing", async () => {
  const legacyPath = join(temporary, "delivery", "report.json");
  await mkdir(dirname(legacyPath), { recursive: true });
  await writeFile(
    legacyPath,
    JSON.stringify(
      manifest({
        checks: [
          {
            id: "build",
            category: "build",
            title: "构建",
            declaredStatus: "passed",
            details: "旧报告",
            evidence: [{ path: "/tmp/build.log", description: "旧格式输出" }],
          },
        ],
      }),
    ),
  );
  const result = await service.read("task-1");
  expect(result).toMatchObject({
    availability: "available",
    report: { taskId: "task-1" },
    evidence: [{ state: "unsupported", resolvedPath: null }],
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("rejects a pre-hash report belonging to another task", async () => {
  const legacyPath = join(temporary, "delivery", "report.json");
  await mkdir(dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, JSON.stringify(manifest({ taskId: "task-2" })));
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "identity-mismatch",
    report: null,
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("does not read file evidence from the shared pre-hash directory", async () => {
  const legacyPath = join(temporary, "delivery", "report.json");
  const artifact = join(temporary, "delivery", "legacy.log");
  await mkdir(dirname(legacyPath), { recursive: true });
  await writeFile(artifact, "legacy evidence");
  await writeFile(
    legacyPath,
    JSON.stringify(
      manifest({
        checks: [
          {
            id: "build",
            category: "build",
            title: "构建",
            declaredStatus: "passed",
            details: "旧报告",
            evidence: [{ kind: "file", path: artifact, sha256: hash("legacy evidence") }],
          },
        ],
      }),
    ),
  );
  expect(await service.read("task-1")).toMatchObject({
    availability: "available",
    evidence: [{ state: "unsupported", resolvedPath: null }],
  });
});

it("prefers the task-hashed report when both report locations exist", async () => {
  await save(manifest({ summary: "任务专属报告" }));
  const legacyPath = join(temporary, "delivery", "report.json");
  await mkdir(dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, JSON.stringify(manifest({ summary: "旧直路径报告" })));
  expect(await service.read("task-1")).toMatchObject({
    availability: "available",
    report: { summary: "任务专属报告" },
  });
});

it("rejects malformed, wrong-task and oversized reports without consulting history", async () => {
  await save();
  await writeFile(reportPath, "{");
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "invalid-report",
    report: null,
  });
  await save(manifest({ taskId: "task-2" }));
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "identity-mismatch",
  });
  await save(
    manifest({
      sourceFiles: [
        { path: "App.tsx", sha256: hash("") },
        { path: "App.tsx", sha256: hash("") },
      ],
    }),
  );
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "invalid-report",
  });
  await sparseFile(reportPath, 256 * 1024 + 1);
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "too-large",
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("rejects a report directory symlink even when it points to another valid task directory", async () => {
  const otherPath = deliveryReportPath(temporary, "task-2");
  await mkdir(dirname(otherPath), { recursive: true });
  await writeFile(otherPath, JSON.stringify(manifest()));
  await symlink(dirname(otherPath), dirname(reportPath));
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "outside-scope",
    report: null,
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("rejects a symlink in an ancestor of the task report directory", async () => {
  const outside = join(directory, "reports");
  await mkdir(join(outside, hash("task-1")), { recursive: true });
  await writeFile(join(outside, hash("task-1"), "report.json"), JSON.stringify(manifest()));
  await symlink(outside, join(temporary, "delivery"));
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "outside-scope",
  });
});

it("rejects the report file itself when it links outside the task directory", async () => {
  const outside = join(workspace, "other-report.json");
  await writeFile(outside, JSON.stringify(manifest()));
  await mkdir(dirname(reportPath), { recursive: true });
  await symlink(outside, reportPath);
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "outside-scope",
    report: null,
    reportSha256: null,
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("does not allow other task artifacts through a runtime nested inside the workspace", async () => {
  const nestedRuntime = join(workspace, ".ui-forge", "runtime");
  const index = new SessionIndex(nestedRuntime);
  await index.initialize();
  await index.put({
    taskId: "task-1",
    projectPath: workspace,
    title: "nested-runtime",
    updatedAt: "2026-09-23T00:00:00.000Z",
  });
  const nestedTemporary = await prepareTemporaryWorkspace(workspace, nestedRuntime);
  const nestedReport = deliveryReportPath(nestedTemporary, "task-1");
  const otherDirectory = dirname(deliveryReportPath(nestedTemporary, "task-2"));
  await mkdir(dirname(nestedReport), { recursive: true });
  await mkdir(otherDirectory, { recursive: true });
  const ownEvidence = join(dirname(nestedReport), "result.json");
  const otherEvidence = join(otherDirectory, "result.json");
  await writeFile(ownEvidence, "own result");
  await writeFile(otherEvidence, "other result");
  await symlink(otherEvidence, join(workspace, "artifact-alias.json"));
  await writeFile(
    nestedReport,
    JSON.stringify(
      manifest({
        checks: [
          {
            id: "build",
            category: "build",
            title: "构建",
            declaredStatus: "passed",
            details: "",
            evidence: [
              { kind: "file", path: ownEvidence, sha256: hash("own result") },
              { kind: "file", path: otherEvidence, sha256: hash("other result") },
              { kind: "file", path: "artifact-alias.json", sha256: hash("other result") },
            ],
          },
        ],
      }),
    ),
  );
  const nestedService = new DeliveryService(index, nestedRuntime, readNative);
  const result = await nestedService.read("task-1");
  expect(result.availability).toBe("available");
  expect(result.evidence.map((evidence) => evidence.state)).toEqual([
    "matched",
    "outside-scope",
    "outside-scope",
  ]);
  expect(result.evidence.slice(1).every((evidence) => evidence.resolvedPath === null)).toBe(true);
  expect(readNative).not.toHaveBeenCalled();
});

it("compares listed source files and evidence afresh without rewriting the declared result", async () => {
  await writeFile(join(workspace, "App.tsx"), "first");
  const report = manifest({
    sourceFiles: [{ path: "App.tsx", sha256: hash("first") }],
    checks: [
      {
        id: "build",
        category: "build",
        title: "构建",
        declaredStatus: "passed",
        details: "",
        evidence: [{ kind: "file", path: "App.tsx", sha256: hash("first") }],
      },
    ],
  });
  await save(report);
  expect(await service.read("task-1")).toMatchObject({
    source: { state: "matches", files: [{ path: "App.tsx", state: "matched" }] },
    evidence: [{ state: "matched", resolvedPath: join(workspace, "App.tsx") }],
  });
  await writeFile(join(workspace, "App.tsx"), "second");
  expect(await service.read("task-1")).toMatchObject({
    source: { state: "stale", files: [{ state: "changed" }] },
    evidence: [{ state: "changed" }],
    report,
  });
  await unlink(join(workspace, "App.tsx"));
  expect(await service.read("task-1")).toMatchObject({
    source: { state: "stale", files: [{ state: "missing" }] },
    evidence: [{ state: "missing", resolvedPath: null }],
    report,
  });
});

it.each(["renamed", "deleted", "replaced-by-file", "redirected-by-symlink"])(
  "preserves the historical report when the workspace is %s without following a new binding",
  async (change) => {
    await writeFile(join(workspace, "App.tsx"), "source");
    await save();
    const artifact = join(dirname(reportPath), "result.json");
    await writeFile(artifact, "evidence");
    const otherArtifact = join(dirname(deliveryReportPath(temporary, "task-2")), "result.json");
    await mkdir(dirname(otherArtifact), { recursive: true });
    await writeFile(otherArtifact, "other evidence");
    const report = manifest({
      sourceFiles: [{ path: "App.tsx", sha256: hash("source") }],
      checks: [
        {
          id: "build",
          category: "build",
          title: "构建",
          declaredStatus: "passed",
          details: "",
          evidence: [
            { kind: "file", path: artifact, sha256: hash("evidence") },
            { kind: "file", path: "App.tsx", sha256: hash("source") },
            { kind: "file", path: join(workspace, "App.tsx"), sha256: hash("source") },
            { kind: "native", turnId: "turn-1", itemId: "tool-1" },
            { kind: "file", path: otherArtifact, sha256: hash("other evidence") },
          ],
        },
      ],
    });
    await save(report);
    expect(await service.read("task-1")).toMatchObject({
      availability: "available",
      source: { state: "matches" },
    });
    readNative.mockClear();
    if (change === "deleted") await rm(workspace, { recursive: true });
    else await rename(workspace, join(directory, "renamed-project"));
    if (change === "replaced-by-file") await writeFile(workspace, "not a directory");
    if (change === "redirected-by-symlink")
      await symlink(join(directory, "renamed-project"), workspace);
    const result = await service.read("task-1");
    expect(await readFile(reportPath, "utf8")).toBe(JSON.stringify(report));
    expect(result).toMatchObject({
      availability: "available",
      issue: null,
      report,
      reportSha256: hash(JSON.stringify(report)),
      source: { state: "unverifiable", files: [{ path: "App.tsx", state: "unavailable" }] },
      history: "unavailable",
    });
    expect(result.evidence.map((entry) => entry.state)).toEqual([
      "matched",
      "unavailable",
      "unavailable",
      "unavailable",
      "outside-scope",
    ]);
    expect(result.evidence.slice(1).every((entry) => entry.resolvedPath === null)).toBe(true);
    expect(index.get("task-1").projectPath).toBe(workspace);
    expect(readNative).not.toHaveBeenCalled();
  },
);

it("rechecks the original workspace after it is restored without rewriting the report", async () => {
  await writeFile(join(workspace, "App.tsx"), "source");
  const report = manifest({ sourceFiles: [{ path: "App.tsx", sha256: hash("source") }] });
  await save(report);
  const moved = join(directory, "renamed-project");
  await rename(workspace, moved);
  expect(await service.read("task-1")).toMatchObject({ source: { state: "unverifiable" }, report });
  await rename(moved, workspace);
  expect(await service.read("task-1")).toMatchObject({ source: { state: "matches" }, report });
  expect(readNative).not.toHaveBeenCalled();
});

it.each([
  { kind: "missing", availability: "missing", issue: null },
  { kind: "malformed", availability: "invalid", issue: "invalid-report" },
  { kind: "wrong-task", availability: "invalid", issue: "identity-mismatch" },
  { kind: "directory-symlink", availability: "invalid", issue: "outside-scope" },
])(
  "still rejects a $kind report independently of an unavailable workspace",
  async ({ kind, availability, issue }) => {
    if (kind === "malformed") {
      await save();
      await writeFile(reportPath, "{");
    }
    if (kind === "wrong-task") await save(manifest({ taskId: "task-2" }));
    if (kind === "directory-symlink") {
      const other = deliveryReportPath(temporary, "task-2");
      await mkdir(dirname(other), { recursive: true });
      await writeFile(other, JSON.stringify(manifest()));
      await symlink(dirname(other), dirname(reportPath));
    }
    await rename(workspace, join(directory, "renamed-project"));
    expect(await service.read("task-1")).toMatchObject({ availability, issue, report: null });
    expect(readNative).not.toHaveBeenCalled();
  },
);

it("does not read artifact symlinks into a renamed workspace or relax source path validation", async () => {
  await writeFile(join(workspace, "App.tsx"), "source");
  await save();
  const moved = join(directory, "renamed-project");
  const alias = join(dirname(reportPath), "source-alias.txt");
  await symlink(join(moved, "App.tsx"), alias);
  await save(
    manifest({
      sourceFiles: [{ path: "../renamed-project/App.tsx", sha256: hash("source") }],
      checks: [
        {
          id: "build",
          category: "build",
          title: "构建",
          declaredStatus: "passed",
          details: "",
          evidence: [{ kind: "file", path: alias, sha256: hash("source") }],
        },
      ],
    }),
  );
  await rename(workspace, moved);
  expect(await service.read("task-1")).toMatchObject({
    availability: "available",
    source: { state: "unverifiable", files: [{ state: "outside-scope" }] },
    evidence: [{ state: "outside-scope", resolvedPath: null }],
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("reports an inaccessible runtime as unreadable rather than claiming that no report exists", async () => {
  await save();
  await rename(runtime, join(directory, "renamed-runtime"));
  expect(await service.read("task-1")).toMatchObject({
    availability: "invalid",
    issue: "unreadable",
    report: null,
  });
  expect(readNative).not.toHaveBeenCalled();
});

it("rejects noncanonical source paths, escaping symlinks and duplicate real source files", async () => {
  await writeFile(join(workspace, "App.tsx"), "source");
  const outside = join(directory, "secret.txt");
  await writeFile(outside, "secret");
  await symlink(outside, join(workspace, "outside.txt"));
  await symlink(join(workspace, "App.tsx"), join(workspace, "alias.tsx"));
  await save(
    manifest({
      sourceFiles: [
        { path: "App.tsx", sha256: hash("source") },
        { path: "alias.tsx", sha256: hash("source") },
        { path: "./App.tsx", sha256: hash("source") },
        { path: "../secret.txt", sha256: hash("secret") },
        { path: "outside.txt", sha256: hash("secret") },
        { path: join(workspace, "App.tsx"), sha256: hash("source") },
        { path: "file:///secret.txt", sha256: hash("secret") },
        { path: "folder/../App.tsx", sha256: hash("source") },
      ],
    }),
  );
  const result = await service.read("task-1");
  expect(result.source.state).toBe("unverifiable");
  expect(result.source.files.map((file) => file.state)).toEqual([
    "matched",
    ...Array<string>(7).fill("outside-scope"),
  ]);
  expect(JSON.stringify(result)).not.toContain('"secret"');
});

it("does not decode percent-encoded paths into parent traversal", async () => {
  await writeFile(join(directory, "secret.txt"), "secret");
  await save(manifest({ sourceFiles: [{ path: "%2e%2e%2fsecret.txt", sha256: hash("secret") }] }));
  expect(await service.read("task-1")).toMatchObject({ source: { files: [{ state: "missing" }] } });
});

it("limits evidence to the workspace or this task's directory and rejects nonfiles", async () => {
  await save();
  const own = join(dirname(reportPath), "result.json");
  const other = join(temporary, "other-task.json");
  const outside = join(directory, "secret.txt");
  await writeFile(own, "result");
  await writeFile(other, "other");
  await writeFile(outside, "secret");
  await symlink(outside, join(workspace, "escape.txt"));
  await mkdir(join(workspace, "folder"));
  await save(
    manifest({
      checks: [
        {
          id: "visual",
          category: "visual",
          title: "视觉",
          declaredStatus: "failed",
          details: "",
          evidence: [
            { kind: "file", path: own, sha256: hash("result") },
            { kind: "file", path: other, sha256: hash("other") },
            { kind: "file", path: "../secret.txt", sha256: hash("secret") },
            { kind: "file", path: "escape.txt", sha256: hash("secret") },
            { kind: "file", path: "file://remote/secret.txt", sha256: hash("secret") },
            { kind: "file", path: "folder", sha256: hash("") },
          ],
        },
      ],
    }),
  );
  const result = await service.read("task-1");
  expect(result.evidence.map((item) => item.state)).toEqual([
    "matched",
    "outside-scope",
    "outside-scope",
    "outside-scope",
    "outside-scope",
    "unavailable",
  ]);
  expect(result.evidence.slice(1).every((item) => item.resolvedPath === null)).toBe(true);
});

it("caps individual files and the shared source/evidence read budget", async () => {
  const entries = [];
  for (let index = 0; index < 5; index += 1) {
    const path = `large-${index}.txt`;
    await sparseFile(join(workspace, path), 16 * 1024 * 1024);
    entries.push({ path, sha256: hash("") });
  }
  await sparseFile(join(workspace, "oversized.txt"), 16 * 1024 * 1024 + 1);
  await save(manifest({ sourceFiles: [...entries, { path: "oversized.txt", sha256: hash("") }] }));
  const result = await service.read("task-1");
  expect(result.source.files.map((file) => file.state)).toEqual([
    "changed",
    "changed",
    "changed",
    "changed",
    "unavailable",
    "unavailable",
  ]);
});

it("only reports actual native command outcomes and never promotes agent text to evidence", async () => {
  history.turns = [
    {
      id: "turn-1",
      status: "completed",
      error: null,
      itemsView: "full",
      items: [
        { id: "ok", type: "commandExecution", status: "completed", exitCode: 0 },
        { id: "failed", type: "commandExecution", status: "completed", exitCode: 1 },
        { id: "pending", type: "commandExecution", status: "inProgress", exitCode: null },
        { id: "no-exit", type: "commandExecution", status: "completed", exitCode: null },
        { id: "claim", type: "agentMessage", text: "All passed" },
        {
          id: "mcp-ok",
          type: "mcpToolCall",
          status: "completed",
          error: null,
          result: { content: [] },
        },
        {
          id: "mcp-error",
          type: "mcpToolCall",
          status: "completed",
          error: null,
          result: { isError: true },
        },
      ],
    },
  ];
  await save(
    manifest({
      checks: [
        {
          id: "build",
          category: "build",
          title: "构建",
          declaredStatus: "passed",
          details: "",
          evidence: [
            "ok",
            "failed",
            "pending",
            "no-exit",
            "claim",
            "mcp-ok",
            "mcp-error",
            "forged",
          ].map((itemId) => ({ kind: "native", turnId: "turn-1", itemId })),
        },
      ],
    }),
  );
  const result = await service.read("task-1");
  expect(result.history).toBe("available");
  expect(result.evidence.map((item) => item.state)).toEqual([
    "succeeded",
    "failed",
    "incomplete",
    "incomplete",
    "unsupported",
    "succeeded",
    "failed",
    "missing",
  ]);
  expect(result.evidence[1]?.exitCode).toBe(1);
  expect(readNative).toHaveBeenCalledExactlyOnceWith("task-1");
});

it("keeps missing or unavailable history explicit without falling back to execution", async () => {
  await save(
    manifest({
      checks: [
        {
          id: "build",
          category: "build",
          title: "构建",
          declaredStatus: "passed",
          details: "",
          evidence: [{ kind: "native", turnId: "turn-1", itemId: "tool-1" }],
        },
      ],
    }),
  );
  history.turns = [
    { id: "turn-1", status: "completed", error: null, itemsView: "notLoaded", items: [] },
  ];
  expect(await service.read("task-1")).toMatchObject({
    availability: "available",
    history: "available",
    evidence: [{ state: "incomplete" }],
  });
  readNative.mockRejectedValueOnce(new Error("connection unavailable"));
  expect(await service.read("task-1")).toMatchObject({
    availability: "available",
    history: "unavailable",
    evidence: [{ state: "unavailable" }],
  });
  readNative.mockResolvedValueOnce({ ...history, id: "task-2" });
  expect(await service.read("task-1")).toMatchObject({
    history: "unavailable",
    evidence: [{ state: "unavailable" }],
  });
  readNative.mockResolvedValueOnce({ ...history, cwd: directory });
  expect(await service.read("task-1")).toMatchObject({
    history: "unavailable",
    evidence: [{ state: "unavailable" }],
  });
});
