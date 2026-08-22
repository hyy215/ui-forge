/** 按 Workspace 与任务持久化通信审计日志，且只写入明确允许的非配置字段。 */

import { appendFile, lstat, mkdir, readdir, rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import {
  WorkspaceIdentityResolver,
  type WorkspaceIdentity,
} from "./workspaceIdentityResolver.js";

/** 单次通信日志成功结果所需的安全上下文。 */
export interface SuccessfulCommunicationLog {
  requestId: string;
  method: string;
  durationMs: number;
  snapshot?: D2CWorkflowSnapshot;
  taskId?: string;
}

/** 单次通信日志失败结果所需的安全上下文。 */
export interface FailedCommunicationLog {
  requestId: string;
  method: string;
  durationMs: number;
  taskId?: string;
  projectPath?: string;
  errorName: string;
}

/** 模型调用安全诊断日志允许保存的有限字段。 */
export interface ModelInvocationLog {
  taskId?: string;
  stage: string;
  attempt: number;
  status:
    | "started"
    | "turn-started"
    | "first-token"
    | "stream-progress"
    | "turn-completed"
    | "turn-failed"
    | "structured-output-invalid"
    | "structured-output-repaired"
    | "succeeded"
    | "failed";
  turn?: number;
  durationMs?: number;
  elapsedMs?: number;
  timeToFirstTokenMs?: number;
  chunkCount?: number;
  idleMs?: number;
  errorName?: string;
  errorCode?: string;
  retryable?: boolean;
  validationIssueCount?: number;
  validationIssuePaths?: string[];
}

/** 通信路由依赖的最小日志端口，便于测试和宿主替换持久化实现。 */
export interface CommunicationRequestLogger {
  initialize?(): Promise<void>;
  dispose?(): Promise<void>;
  recordSuccess(input: SuccessfulCommunicationLog): Promise<void>;
  recordFailure(input: FailedCommunicationLog): Promise<void>;
  recordModelInvocation?(input: ModelInvocationLog): Promise<void>;
}

/** Workspace JSONL 日志的创建选项。 */
export interface WorkspaceRequestLoggerOptions {
  rootDirectory: string;
  workspaceIdentityResolver?: WorkspaceIdentityResolver;
  now?: () => Date;
  onError?: (error: unknown) => void;
  retentionMs?: number;
  maxFileBytes?: number;
  cleanupIntervalMs?: number;
}

const defaultLogRetentionMs = 90 * 24 * 60 * 60_000;
const defaultMaxLogFileBytes = 10 * 1024 * 1024;
const defaultCleanupIntervalMs = 24 * 60 * 60_000;

/** 以 Workspace 为目录、taskId 为文件记录通信结果的安全日志实现。 */
export class WorkspaceRequestLogger implements CommunicationRequestLogger {
  private readonly rootDirectory: string;
  private readonly identityResolver: WorkspaceIdentityResolver;
  private readonly now: () => Date;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly retentionMs: number;
  private readonly maxFileBytes: number;
  private readonly cleanupIntervalMs: number;
  private readonly taskWorkspaces = new Map<string, { projectPath: string; identity: WorkspaceIdentity }>();
  private readonly workspaceIdentities = new Map<string, Promise<WorkspaceIdentity>>();
  private writeQueue: Promise<void> = Promise.resolve();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  /** 创建日志器；rootDirectory 仅决定存储位置，自身不会写入日志。 */
  constructor(options: WorkspaceRequestLoggerOptions) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.identityResolver = options.workspaceIdentityResolver ?? new WorkspaceIdentityResolver();
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError;
    this.retentionMs = options.retentionMs ?? defaultLogRetentionMs;
    this.maxFileBytes = options.maxFileBytes ?? defaultMaxLogFileBytes;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? defaultCleanupIntervalMs;
    if (!Number.isFinite(this.retentionMs) || this.retentionMs < 0) {
      throw new Error("日志保留期必须是非负有限数值。");
    }
    if (!Number.isFinite(this.maxFileBytes) || this.maxFileBytes <= 0) {
      throw new Error("日志文件上限必须是正有限数值。");
    }
    if (!Number.isFinite(this.cleanupIntervalMs) || this.cleanupIntervalMs <= 0) {
      throw new Error("日志清理周期必须是正有限数值。");
    }
  }

  /** 启动时执行一次过期清理，并注册不会阻止进程退出的周期任务。 */
  async initialize(): Promise<void> {
    await this.collectGarbage().catch((error: unknown) => this.onError?.(error));
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      void this.collectGarbage().catch((error: unknown) => this.onError?.(error));
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  /** 停止清理周期并等待已经排队的日志写入结束。 */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    await this.writeQueue;
  }

  /** 记录成功请求，并用返回快照建立 taskId 到 Workspace 的关联。 */
  async recordSuccess(input: SuccessfulCommunicationLog): Promise<void> {
    await this.persistSafely(async () => {
      const timestamp = this.now();
      const projectPath = input.snapshot?.viewModel.setup.projectPath
        ?? (input.taskId ? this.taskWorkspaces.get(input.taskId)?.projectPath : undefined)
        ?? "";
      const identity = input.taskId
        ? this.taskWorkspaces.get(input.taskId)?.identity ?? await this.resolveIdentity(projectPath)
        : await this.resolveIdentity(projectPath);
      const taskId = input.snapshot?.taskId ?? input.taskId;
      if (input.snapshot) this.taskWorkspaces.set(input.snapshot.taskId, { projectPath, identity });
      await this.append(identity, taskId ?? input.requestId, timestamp, {
        timestamp: timestamp.toISOString(),
        event: "communication.completed",
        workspaceType: identity.type,
        workspace: identity.value,
        requestId: input.requestId,
        ...(taskId ? { taskId } : {}),
        method: input.method,
        status: "success",
        durationMs: input.durationMs,
        ...(input.snapshot ? {
          revision: input.snapshot.revision,
          workflowPhase: input.snapshot.workflowPhase,
        } : {}),
      });
    });
  }

  /** 记录失败请求；不写入 params、配置、请求头或原始错误消息。 */
  async recordFailure(input: FailedCommunicationLog): Promise<void> {
    await this.persistSafely(async () => {
      const timestamp = this.now();
      const knownWorkspace = input.taskId ? this.taskWorkspaces.get(input.taskId) : undefined;
      const projectPath = knownWorkspace?.projectPath ?? input.projectPath ?? "";
      const identity = knownWorkspace?.identity ?? await this.resolveIdentity(projectPath);
      const fileId = input.taskId ?? input.requestId;
      await this.append(identity, fileId, timestamp, {
        timestamp: timestamp.toISOString(),
        event: "communication.completed",
        workspaceType: identity.type,
        workspace: identity.value,
        requestId: input.requestId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        method: input.method,
        status: "failure",
        durationMs: input.durationMs,
        errorName: input.errorName,
      });
    });
  }

  /** 记录模型阶段、尝试次数和耗时，不保存提示词、响应、图片或思维内容。 */
  async recordModelInvocation(input: ModelInvocationLog): Promise<void> {
    await this.persistSafely(async () => {
      const timestamp = this.now();
      const knownWorkspace = input.taskId ? this.taskWorkspaces.get(input.taskId) : undefined;
      const identity = knownWorkspace?.identity ?? await this.resolveIdentity(
        knownWorkspace?.projectPath ?? "",
      );
      await this.append(identity, input.taskId ?? "model-invocation", timestamp, {
        timestamp: timestamp.toISOString(),
        event: "model.invocation",
        workspaceType: identity.type,
        workspace: identity.value,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        stage: input.stage,
        attempt: input.attempt,
        status: input.status,
        ...(input.turn !== undefined ? { turn: input.turn } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
        ...(input.timeToFirstTokenMs !== undefined
          ? { timeToFirstTokenMs: input.timeToFirstTokenMs }
          : {}),
        ...(input.chunkCount !== undefined ? { chunkCount: input.chunkCount } : {}),
        ...(input.idleMs !== undefined ? { idleMs: input.idleMs } : {}),
        ...(input.errorName ? { errorName: input.errorName } : {}),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        ...(input.retryable !== undefined ? { retryable: String(input.retryable) } : {}),
        ...(input.validationIssueCount !== undefined
          ? { validationIssueCount: input.validationIssueCount }
          : {}),
        ...(input.validationIssuePaths && input.validationIssuePaths.length > 0
          ? { validationIssuePaths: input.validationIssuePaths.join(",") }
          : {}),
      });
    });
  }

  /** 串行追加 JSONL，确保同一进程内并发记录不会相互穿插。 */
  private async append(
    identity: WorkspaceIdentity,
    fileId: string,
    timestamp: Date,
    record: Record<string, string | number>,
  ): Promise<void> {
    const safeFileId = toSafeFileName(fileId);
    const month = timestamp.toISOString().slice(0, 7);
    const directory = resolve(this.rootDirectory, identity.directoryName, month);
    const serialized = `${JSON.stringify(record)}\n`;
    const write = this.writeQueue.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const filePath = await this.resolveWritableLogPath(directory, safeFileId, serialized);
      await appendFile(filePath, serialized, { encoding: "utf8", mode: 0o600 });
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
  }

  /** 删除超过保留期的分区日志，并尽力移除清空后的月份和 Workspace 目录。 */
  async collectGarbage(now: Date = this.now()): Promise<number> {
    const cutoff = now.getTime() - this.retentionMs;
    if (!Number.isFinite(cutoff)) throw new Error("日志清理时间无效。");
    let deleted = 0;
    for (const workspace of await readDirectories(this.rootDirectory)) {
      const workspacePath = resolve(this.rootDirectory, workspace);
      for (const month of await readDirectories(workspacePath)) {
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const monthPath = resolve(workspacePath, month);
        let files: string[];
        try {
          files = await readdir(monthPath);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const path = resolve(monthPath, file);
          const metadata = await lstat(path).catch(() => undefined);
          if (!metadata?.isFile() || metadata.mtimeMs > cutoff) continue;
          await rm(path, { force: true });
          deleted += 1;
        }
        await rmdir(monthPath).catch(() => undefined);
      }
      await rmdir(workspacePath).catch(() => undefined);
    }
    return deleted;
  }

  /** 选择仍有容量的当前分段，跨进程重启也根据实际文件大小继续轮转。 */
  private async resolveWritableLogPath(
    directory: string,
    safeFileId: string,
    serialized: string,
  ): Promise<string> {
    const incomingBytes = Buffer.byteLength(serialized, "utf8");
    for (let segment = 0; ; segment += 1) {
      const suffix = segment === 0 ? "" : `.${segment}`;
      const path = resolve(directory, `${safeFileId}${suffix}.jsonl`);
      const metadata = await lstat(path).catch(() => undefined);
      if (!metadata) return path;
      if (!metadata.isFile()) throw new Error("日志目标不是普通文件。");
      if (metadata.size + incomingBytes <= this.maxFileBytes) return path;
    }
  }

  /** 在进程生命周期内复用只读 Git 探测结果。 */
  private resolveIdentity(projectPath: string): Promise<WorkspaceIdentity> {
    const existing = this.workspaceIdentities.get(projectPath);
    if (existing) return existing;
    const identity = this.identityResolver.resolve(projectPath);
    this.workspaceIdentities.set(projectPath, identity);
    identity.catch(() => this.workspaceIdentities.delete(projectPath));
    return identity;
  }

  /** 将持久化故障转为可选告警，保证日志不会改变业务请求结果。 */
  private async persistSafely(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error: unknown) {
      this.onError?.(error);
    }
  }
}

/** 仅读取一层真实目录，不跟随符号链接或把缺失根目录视为错误。 */
async function readDirectories(rootDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 防止外部 requestId 或 taskId 影响日志目录结构。 */
function toSafeFileName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (safe || "request").slice(0, 120);
}
