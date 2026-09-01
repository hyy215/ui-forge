/** 在任务绑定 Workspace 内校验、暂存并以可回滚方式应用完整 D2C Patch。 */

import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";

const maximumFiles = 80;
const maximumFileBytes = 512 * 1024;
const maximumTotalBytes = 2 * 1024 * 1024;

interface PlannedFileApplication {
  path: string;
  absolutePath: string;
  initialHash: string | null;
  finalHash: string | null;
  finalContent: string | null;
  action: D2CAgent.AppliedPatchFile["action"];
}

interface CurrentFileState {
  exists: boolean;
  hash: string | null;
  mode: number | null;
}

interface CommitRecord {
  plan: PlannedFileApplication;
  backupPath?: string;
  targetIdentity?: { dev: bigint; ino: bigint };
  createdDirectories: string[];
}

/** 使用规范路径、内容指纹和回滚记录保护真实 Workspace 写入。 */
export class FileSystemProjectPatchApplier implements D2CAgent.ProjectPatchApplier {
  private readonly workspaceLocks = new Map<string, Promise<void>>();

  /** 串行化同一项目的应用，并把所有异常收敛为需要人工处理的阻塞结论。 */
  async apply(input: {
    inspection: Exclude<D2CAgent.ProjectInspection, { kind: "unsupported" }>;
    patchSet: D2CAgent.CodePatchSet;
  }): Promise<D2CAgent.ProjectPatchApplyResult> {
    let projectRoot: string;
    try {
      projectRoot = await realpath(input.inspection.projectRoot);
    } catch (error: unknown) {
      return blocked(`无法解析目标项目目录：${errorMessage(error)}`);
    }
    return this.withWorkspaceLock(projectRoot, async () => {
      try {
        return await applyPatchSet(
          projectRoot,
          input.patchSet,
          (path, index) => this.beforeCommitFile(path, index),
        );
      } catch (error: unknown) {
        return blocked(errorMessage(error));
      }
    });
  }

  /** 在每个文件提交前提供可测试的故障边界；默认实现不产生副作用。 */
  protected async beforeCommitFile(_path: string, _index: number): Promise<void> {
    await Promise.resolve();
  }

  /** 让同一 Server 内指向相同真实目录的任务不会交错写入。 */
  private async withWorkspaceLock<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.workspaceLocks.get(workspaceRoot) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolveLock) => { release = resolveLock; });
    this.workspaceLocks.set(workspaceRoot, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.workspaceLocks.get(workspaceRoot) === current) this.workspaceLocks.delete(workspaceRoot);
    }
  }
}

/** 完成全量预检后暂存最终内容，并在提交失败时反向恢复已触碰文件。 */
async function applyPatchSet(
  projectRoot: string,
  patchSet: D2CAgent.CodePatchSet,
  beforeCommitFile: (path: string, index: number) => Promise<void>,
): Promise<D2CAgent.ProjectPatchApplyResult> {
  const plans = createApplicationPlans(projectRoot, patchSet);
  if (plans.length > maximumFiles) return blocked(`候选 Patch 文件数超过 ${maximumFiles} 个上限。`);
  const currentStates = new Map<string, CurrentFileState>();
  for (const plan of plans) currentStates.set(plan.path, await readCurrentState(projectRoot, plan));
  if (plans.every((plan) => stateMatches(currentStates.get(plan.path), plan.finalHash))) {
    return { status: "applied", files: toAppliedFiles(plans), alreadyApplied: true };
  }
  const drifted = plans.filter((plan) => !stateMatches(currentStates.get(plan.path), plan.initialHash));
  if (drifted.length > 0) {
    return blocked(...drifted.map((plan) => `目标文件版本已变化：${plan.path}`));
  }

  const temporaryRoot = await mkdtemp(join(projectRoot, ".ui-forge-apply-"));
  const records: CommitRecord[] = [];
  try {
    const stagedFiles = await stageFinalFiles(temporaryRoot, plans, currentStates);
    for (const [index, plan] of plans.entries()) {
      await beforeCommitFile(plan.path, index);
      const record: CommitRecord = { plan, createdDirectories: [] };
      records.push(record);
      record.createdDirectories = await ensureSafeParentDirectories(projectRoot, plan.absolutePath, plan.path);
      const backupPath = join(temporaryRoot, `backup-${index}`);
      if (plan.initialHash !== null) {
        await rename(plan.absolutePath, backupPath);
        record.backupPath = backupPath;
        const captured = await readRegularFileState(projectRoot, backupPath, plan.path, false);
        if (captured.hash !== plan.initialHash) throw new Error(`提交前文件版本已变化：${plan.path}`);
      } else {
        await assertTargetMissing(projectRoot, plan.absolutePath, plan.path);
      }
      const stagedPath = stagedFiles.get(plan.path);
      if (plan.finalHash !== null && stagedPath) {
        await link(stagedPath, plan.absolutePath);
        const stats = await lstat(plan.absolutePath, { bigint: true });
        record.targetIdentity = { dev: stats.dev, ino: stats.ino };
        await unlink(stagedPath);
      }
    }
  } catch (error: unknown) {
    const rollbackErrors = await rollback(records);
    if (rollbackErrors.length === 0) {
      await rm(temporaryRoot, { recursive: true, force: true });
      return blocked(`候选 Patch 应用失败，已恢复全部目标文件：${errorMessage(error)}`);
    }
    return {
      status: "blocked",
      summary: "候选 Patch 应用失败且自动恢复不完整，需要立即人工检查目标项目。",
      reasons: [
        `候选 Patch 应用失败：${errorMessage(error)}`,
        `请检查 ${relative(projectRoot, temporaryRoot)} 中的恢复数据：${rollbackErrors.join("；")}`,
      ],
      manualActionRequired: true,
    };
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch {
    // 文件结果已经完整提交；遗留隔离备份不会改变目标文件，后续可由人工清理。
  }
  return { status: "applied", files: toAppliedFiles(plans), alreadyApplied: false };
}

/** 把逐步骤操作折叠为每个文件的一次最终应用，同时验证内部哈希链。 */
function createApplicationPlans(
  projectRoot: string,
  patchSet: D2CAgent.CodePatchSet,
): PlannedFileApplication[] {
  const states = new Map<string, {
    initialHash: string | null;
    currentHash: string | null;
    finalContent: string | null;
  }>();
  for (const patch of patchSet.patches) {
    for (const operation of patch.operations) {
      const path = validateRelativePath(operation.path);
      const existing = states.get(path);
      const state = existing ?? {
        initialHash: operation.beforeHash,
        currentHash: operation.beforeHash,
        finalContent: null,
      };
      if (state.currentHash !== operation.beforeHash) throw new Error(`候选 Patch 文件哈希链断裂：${path}`);
      if (operation.action === "create" && state.currentHash !== null) {
        throw new Error(`候选 Patch 尝试覆盖已存在文件：${path}`);
      }
      if (operation.action !== "create" && state.currentHash === null) {
        throw new Error(`候选 Patch 尝试修改不存在文件：${path}`);
      }
      if (operation.action === "delete") {
        if (operation.afterHash !== null || operation.content !== undefined) {
          throw new Error(`候选 Patch 删除操作结构无效：${path}`);
        }
        state.currentHash = null;
        state.finalContent = null;
      } else {
        if (operation.content === undefined || hashContent(operation.content) !== operation.afterHash) {
          throw new Error(`候选 Patch 内容哈希不一致：${path}`);
        }
        state.currentHash = operation.afterHash;
        state.finalContent = operation.content;
      }
      states.set(path, state);
    }
  }
  let totalBytes = 0;
  return [...states.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, state]) => {
    if (state.initialHash === state.currentHash) throw new Error(`候选 Patch 最终没有改变文件：${path}`);
    const byteSize = state.finalContent === null ? 0 : Buffer.byteLength(state.finalContent, "utf8");
    if (byteSize > maximumFileBytes) throw new Error(`候选 Patch 文件超过 512 KiB 上限：${path}`);
    totalBytes += byteSize;
    if (totalBytes > maximumTotalBytes) throw new Error("候选 Patch 总写入内容超过 2 MiB 上限。");
    return {
      path,
      absolutePath: resolve(projectRoot, path),
      initialHash: state.initialHash,
      finalHash: state.currentHash,
      finalContent: state.finalContent,
      action: state.initialHash === null ? "create" : state.currentHash === null ? "delete" : "modify",
    };
  });
}

/** 读取预检时的普通文件状态；缺失文件必须拥有安全的最近存在祖先。 */
async function readCurrentState(
  projectRoot: string,
  plan: PlannedFileApplication,
): Promise<CurrentFileState> {
  try {
    return await readRegularFileState(projectRoot, plan.absolutePath, plan.path, true);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await assertMissingPathAncestor(projectRoot, plan.absolutePath, plan.path);
    return { exists: false, hash: null, mode: null };
  }
}

/** 拒绝符号链接、目录和解析到其他位置的现有路径。 */
async function readRegularFileState(
  projectRoot: string,
  absolutePath: string,
  requestedPath: string,
  requireProjectContainment: boolean,
): Promise<CurrentFileState> {
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Patch 目标不是普通文件：${requestedPath}`);
  const resolvedPath = await realpath(absolutePath);
  if (resolvedPath !== absolutePath) throw new Error(`Patch 目标包含符号链接或非规范路径：${requestedPath}`);
  if (requireProjectContainment) assertWithinProject(projectRoot, resolvedPath, requestedPath);
  const content = await readFile(resolvedPath);
  return {
    exists: true,
    hash: createHash("sha256").update(content).digest("hex"),
    mode: stats.mode & 0o777,
  };
}

/** 为每个最终存在文件创建同文件系统暂存文件，并保留修改目标的权限位。 */
async function stageFinalFiles(
  temporaryRoot: string,
  plans: readonly PlannedFileApplication[],
  currentStates: ReadonlyMap<string, CurrentFileState>,
): Promise<Map<string, string>> {
  const staged = new Map<string, string>();
  for (const [index, plan] of plans.entries()) {
    if (plan.finalHash === null || plan.finalContent === null) continue;
    const stagedPath = join(temporaryRoot, `staged-${index}`);
    await writeFile(stagedPath, plan.finalContent, { encoding: "utf8", flag: "wx" });
    const mode = currentStates.get(plan.path)?.mode;
    if (mode !== null && mode !== undefined) await chmod(stagedPath, mode);
    staged.set(plan.path, stagedPath);
  }
  return staged;
}

/** 逐级创建缺失父目录，并拒绝任何既有符号链接或非目录节点。 */
async function ensureSafeParentDirectories(
  projectRoot: string,
  absolutePath: string,
  requestedPath: string,
): Promise<string[]> {
  const parent = dirname(absolutePath);
  const relativeParent = relative(projectRoot, parent);
  if (!relativeParent) return [];
  const created: string[] = [];
  let candidate = projectRoot;
  for (const segment of relativeParent.split(sep)) {
    candidate = join(candidate, segment);
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Patch 父目录不安全：${requestedPath}`);
      const resolved = await realpath(candidate);
      if (resolved !== candidate) throw new Error(`Patch 父目录包含符号链接：${requestedPath}`);
      assertWithinProject(projectRoot, resolved, requestedPath);
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
      try {
        await mkdir(candidate);
        created.push(candidate);
      } catch (mkdirError: unknown) {
        if (!isNodeError(mkdirError, "EEXIST")) throw mkdirError;
        const stats = await lstat(candidate);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Patch 父目录不安全：${requestedPath}`);
        const resolved = await realpath(candidate);
        if (resolved !== candidate) throw new Error(`Patch 父目录包含符号链接：${requestedPath}`);
        assertWithinProject(projectRoot, resolved, requestedPath);
      }
    }
  }
  return created;
}

/** 对新建目标再次执行无覆盖检查，避免预检后的并发文件漂移。 */
async function assertTargetMissing(projectRoot: string, absolutePath: string, requestedPath: string): Promise<void> {
  try {
    await lstat(absolutePath);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      await assertMissingPathAncestor(projectRoot, absolutePath, requestedPath);
      return;
    }
    throw error;
  }
  throw new Error(`提交前新建目标已经存在：${requestedPath}`);
}

/** 验证缺失目标最近存在的祖先目录没有通过符号链接逃逸。 */
async function assertMissingPathAncestor(
  projectRoot: string,
  absolutePath: string,
  requestedPath: string,
): Promise<void> {
  let candidate = dirname(absolutePath);
  while (candidate !== projectRoot) {
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Patch 新建路径父级不安全：${requestedPath}`);
      const resolved = await realpath(candidate);
      if (resolved !== candidate) throw new Error(`Patch 新建路径父级包含符号链接：${requestedPath}`);
      assertWithinProject(projectRoot, resolved, requestedPath);
      return;
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
      candidate = dirname(candidate);
    }
  }
}

/** 按提交逆序移除本次结果、恢复备份，并尽力清理新建空目录。 */
async function rollback(records: readonly CommitRecord[]): Promise<string[]> {
  const errors: string[] = [];
  for (const record of [...records].reverse()) {
    try {
      if (record.targetIdentity) {
        const stats = await lstat(record.plan.absolutePath, { bigint: true });
        if (stats.dev !== record.targetIdentity.dev || stats.ino !== record.targetIdentity.ino) {
          throw new Error(`回滚目标已被外部替换：${record.plan.path}`);
        }
        await unlink(record.plan.absolutePath);
      }
      if (record.backupPath) await rename(record.backupPath, record.plan.absolutePath);
      for (const directory of [...record.createdDirectories].reverse()) {
        try {
          await rmdir(directory);
        } catch (error: unknown) {
          if (!isNodeError(error, "ENOENT") && !isNodeError(error, "ENOTEMPTY")) throw error;
        }
      }
    } catch (error: unknown) {
      errors.push(errorMessage(error));
    }
  }
  return errors;
}

/** 校验路径严格使用安全的项目相对 POSIX 形式。 */
function validateRelativePath(path: string): string {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:\//.test(path)
    || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`候选 Patch 包含不安全路径：${path}`);
  }
  return path;
}

/** 确认绝对目标仍位于规范项目根目录内部。 */
function assertWithinProject(projectRoot: string, candidate: string, requestedPath: string): void {
  const relativePath = relative(projectRoot, candidate);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) return;
  throw new Error(`候选 Patch 路径逃逸项目根目录：${requestedPath}`);
}

/** 判断实际状态是否与 Patch 指定的存在性和内容哈希一致。 */
function stateMatches(state: CurrentFileState | undefined, expectedHash: string | null): boolean {
  if (!state) return false;
  return expectedHash === null ? !state.exists : state.exists && state.hash === expectedHash;
}

/** 生成不暴露内容的最终文件动作清单。 */
function toAppliedFiles(plans: readonly PlannedFileApplication[]): D2CAgent.AppliedPatchFile[] {
  return plans.map((plan) => ({ path: plan.path, action: plan.action }));
}

/** 返回需要人工处理且未宣称成功的统一结果。 */
function blocked(...reasons: string[]): D2CAgent.ProjectPatchApplyResult {
  return {
    status: "blocked",
    summary: "候选 Patch 未写入目标项目，需要人工处理。",
    reasons,
    manualActionRequired: true,
  };
}

/** 计算写入内容的 UTF-8 SHA-256。 */
function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 收窄 Node.js 文件系统异常代码。 */
function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** 将未知异常压缩为适合人工排查的稳定文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知 Workspace 写入错误。";
}
