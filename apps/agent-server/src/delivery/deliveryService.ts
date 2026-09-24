/** 只读核对任务专属交付声明、文件指纹和原生工具事实，不产生验收或执行状态。 */
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deliveryReportPath, temporaryWorkspacePathForCanonicalCwd } from "@ui-forge/codex-client";
import {
  deliveryManifestSchema,
  nativeThreadSchema,
  taskDeliverySchema,
  type DeliveryEvidenceResult,
  type DeliveryManifest,
  type NativeItem,
  type NativeThread,
  type TaskDelivery,
} from "@ui-forge/shared-protocol";
import type { SessionIndex } from "../sessions/sessionIndex.js";
import {
  assertDeliveryDirectory,
  containsDeliveryPath,
  DeliveryFileError,
  deliveryPath,
  diskOperation,
  readDeliveryFile,
  sourceDeliveryPath,
  type DeliveryReadBudget,
} from "./deliveryFiles.js";

const reportLimit = 256 * 1024;
const fileLimit = 16 * 1024 * 1024;
const queryLimit = 64 * 1024 * 1024;

function fingerprint(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileFailure(error: unknown): "missing" | "outside-scope" | "unavailable" {
  if (
    error instanceof DeliveryFileError &&
    (error.reason === "missing" || error.reason === "outside-scope")
  ) {
    return error.reason;
  }
  return "unavailable";
}

function emptyDelivery(taskId: string): TaskDelivery {
  return {
    version: 1,
    taskId,
    checkedAt: new Date().toISOString(),
    availability: "missing",
    issue: null,
    report: null,
    reportSha256: null,
    source: { state: "unverifiable", manifestFingerprint: null, files: [] },
    evidence: [],
    history: "not-requested",
  };
}

/** 无证据时不启动原生连接；查询只核对本任务，不能加载或继续执行任务。 */
export class DeliveryService {
  /** 任务身份和产物目录只取宿主索引；原生历史通过只读回调注入。 */
  constructor(
    private readonly index: SessionIndex,
    private readonly runtimeDirectory: string,
    private readonly readNative: (taskId: string) => Promise<unknown>,
  ) {}

  /** 重新核对当前文件，保留作者原始声明，不生成总体通过结论。 */
  async read(taskId: string): Promise<TaskDelivery> {
    const entry = this.index.get(taskId);
    const result = emptyDelivery(taskId);
    const workspace = entry.projectPath;
    let runtime: string;
    let directory: string;
    let temporary: string;
    let report: DeliveryManifest;
    let legacyReportPath = false;
    try {
      runtime = await diskOperation(() => realpath(this.runtimeDirectory));
    } catch (error) {
      return {
        ...result,
        availability: "invalid",
        issue:
          error instanceof DeliveryFileError && error.reason === "outside-scope"
            ? "outside-scope"
            : "unreadable",
      };
    }
    try {
      temporary = temporaryWorkspacePathForCanonicalCwd(workspace, runtime);
      const reportPath = deliveryReportPath(temporary, taskId);
      const deliveryRoot = join(temporary, "delivery");
      directory = dirname(reportPath);
      await assertDeliveryDirectory(runtime, deliveryRoot);
      let file: Awaited<ReturnType<typeof readDeliveryFile>>;
      try {
        await assertDeliveryDirectory(runtime, directory);
        file = await readDeliveryFile(
          reportPath,
          [directory],
          { remaining: reportLimit },
          reportLimit,
        );
      } catch (error) {
        if (!(error instanceof DeliveryFileError) || error.reason !== "missing") throw error;
        // Read the pre-hash location only as a compatibility fallback. The report taskId
        // is still checked below, and evidence from this format remains unsupported.
        legacyReportPath = true;
        file = await readDeliveryFile(
          join(deliveryRoot, "report.json"),
          [deliveryRoot],
          { remaining: reportLimit },
          reportLimit,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.bytes.toString("utf8"));
      } catch {
        return { ...result, availability: "invalid", issue: "invalid-report" };
      }
      const manifest = deliveryManifestSchema.safeParse(parsed);
      if (!manifest.success) return { ...result, availability: "invalid", issue: "invalid-report" };
      report = manifest.data;
      if (report.taskId !== taskId)
        return { ...result, availability: "invalid", issue: "identity-mismatch" };
      result.reportSha256 = fingerprint(file.bytes);
    } catch (error) {
      if (error instanceof DeliveryFileError && error.reason === "missing") return result;
      const issue = error instanceof DeliveryFileError ? error.reason : "unreadable";
      return {
        ...result,
        availability: "invalid",
        issue: issue === "missing" ? "unreadable" : issue,
      };
    }
    result.availability = "available";
    result.report = report;
    let workspaceAvailable = false;
    try {
      workspaceAvailable =
        (await realpath(workspace)) === workspace && (await stat(workspace)).isDirectory();
    } catch {
      // 历史报告独立于源码存续；缺失或不可读时不寻找新路径，也不改变任务绑定。
    }
    const budget = { remaining: queryLimit };
    result.source = await this.checkSources(report, workspace, workspaceAvailable, budget);
    const needsHistory = report.checks.some((check) =>
      check.evidence.some((item) => item.kind === "native"),
    );
    let history: NativeThread | undefined;
    if (needsHistory) {
      result.history = "unavailable";
    }
    if (needsHistory && workspaceAvailable) {
      try {
        const thread = nativeThreadSchema.parse(await this.readNative(taskId));
        if (thread.id !== taskId || (await realpath(thread.cwd)) !== workspace)
          throw new Error("Identity mismatch");
        history = thread;
        result.history = "available";
      } catch {
        result.history = "unavailable";
      }
    }
    for (const check of report.checks) {
      for (const [index, evidence] of check.evidence.entries()) {
        const item: DeliveryEvidenceResult = {
          checkId: check.id,
          index,
          state: "unavailable",
          resolvedPath: null,
          exitCode: null,
        };
        if (evidence.kind === "native") {
          Object.assign(item, nativeEvidence(history, evidence.turnId, evidence.itemId));
        } else if (evidence.kind === "legacy") {
          // 旧报告只保留作者写入的路径；没有指纹时不能读取或宣称匹配。
          item.state = "unsupported";
        } else if (legacyReportPath) {
          // The legacy root is shared by tasks, so never resolve new file evidence from it.
          item.state = "unsupported";
        } else {
          try {
            const path = deliveryPath(evidence.path, workspace);
            if (
              !workspaceAvailable &&
              containsDeliveryPath(workspace, path) &&
              !containsDeliveryPath(directory, path)
            )
              throw new DeliveryFileError("unreadable");
            const file = await readDeliveryFile(
              path,
              workspaceAvailable ? [workspace, directory] : [directory],
              budget,
              fileLimit,
              { root: temporary, allowed: directory },
            );
            item.resolvedPath = file.path;
            item.state = fingerprint(file.bytes) === evidence.sha256 ? "matched" : "changed";
          } catch (error) {
            item.state = fileFailure(error);
          }
        }
        result.evidence.push(item);
      }
    }
    return taskDeliverySchema.parse(result);
  }

  /** 指纹仅表示报告列出的路径和内容；不宣称覆盖整个工作区或验证发生时的源码。 */
  private async checkSources(
    report: DeliveryManifest,
    workspace: string,
    workspaceAvailable: boolean,
    budget: DeliveryReadBudget,
  ): Promise<TaskDelivery["source"]> {
    const files: TaskDelivery["source"]["files"] = [];
    const seen = new Set<string>();
    for (const entry of report.sourceFiles) {
      try {
        const path = sourceDeliveryPath(entry.path, workspace);
        if (!workspaceAvailable) throw new DeliveryFileError("unreadable");
        const file = await readDeliveryFile(path, [workspace], budget, fileLimit);
        if (seen.has(file.path)) throw new DeliveryFileError("outside-scope");
        seen.add(file.path);
        files.push({
          path: entry.path,
          state: fingerprint(file.bytes) === entry.sha256 ? "matched" : "changed",
        });
      } catch (error) {
        files.push({ path: entry.path, state: fileFailure(error) });
      }
    }
    const hasChange = files.some((file) => file.state === "changed" || file.state === "missing");
    return {
      state: hasChange
        ? "stale"
        : files.length > 0 && files.every((file) => file.state === "matched")
          ? "matches"
          : "unverifiable",
      manifestFingerprint: report.sourceFiles.length
        ? fingerprint(
            JSON.stringify([...report.sourceFiles].sort((a, b) => a.path.localeCompare(b.path))),
          )
        : null,
      files,
    };
  }
}

function nativeEvidence(
  history: NativeThread | undefined,
  turnId: string,
  itemId: string,
): Pick<DeliveryEvidenceResult, "state" | "exitCode"> {
  if (!history) return { state: "unavailable", exitCode: null };
  const turns = history.turns.filter((turn) => turn.id === turnId);
  if (turns.length !== 1) return { state: "missing", exitCode: null };
  const turn = turns[0];
  const items = turn?.items.filter((item) => item.id === itemId) ?? [];
  if (items.length !== 1)
    return { state: turn?.itemsView === "full" ? "missing" : "incomplete", exitCode: null };
  const item = items[0];
  if (!item) return { state: "missing", exitCode: null };
  return nativeItemResult(item);
}

function nativeItemResult(item: NativeItem): Pick<DeliveryEvidenceResult, "state" | "exitCode"> {
  if (item.type === "commandExecution") {
    const exitCode =
      typeof item.exitCode === "number" && Number.isInteger(item.exitCode) ? item.exitCode : null;
    if (
      item.status === "failed" ||
      item.status === "declined" ||
      (exitCode !== null && exitCode !== 0)
    )
      return { state: "failed", exitCode };
    return {
      state: item.status === "completed" && exitCode === 0 ? "succeeded" : "incomplete",
      exitCode,
    };
  }
  if (item.type === "mcpToolCall") {
    if (item.status === "failed" || (item.error !== null && item.error !== undefined))
      return { state: "failed", exitCode: null };
    const toolResult = item.result;
    if (
      toolResult &&
      typeof toolResult === "object" &&
      !Array.isArray(toolResult) &&
      toolResult.isError === true
    )
      return { state: "failed", exitCode: null };
    return { state: item.status === "completed" ? "succeeded" : "incomplete", exitCode: null };
  }
  return { state: "unsupported", exitCode: null };
}
