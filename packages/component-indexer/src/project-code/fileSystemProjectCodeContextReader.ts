/** 为代码生成阶段读取受控、带指纹且不可越界的目标仓库文本快照。 */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";

const maximumFiles = 80;
const maximumFileBytes = 512 * 1024;
const maximumTotalBytes = 2 * 1024 * 1024;

/** 只读取任务绑定项目内计划文件和显式复用参考文件的适配器。 */
export class FileSystemProjectCodeContextReader implements D2CAgent.ProjectCodeContextReader {
  /** 校验全部相对路径并返回不可由模型扩大的文本快照。 */
  async read(input: {
    inspection: Exclude<D2CAgent.ProjectInspection, { kind: "unsupported" }>;
    plannedPaths: readonly string[];
    referencePaths: readonly string[];
    signal?: AbortSignal;
  }): Promise<D2CAgent.ProjectCodeContext> {
    throwIfAborted(input.signal);
    const projectRoot = await realpath(input.inspection.projectRoot);
    const requested = collectRequestedPaths(input.plannedPaths, input.referencePaths);
    if (requested.length > maximumFiles) throw new Error(`代码上下文文件数超过 ${maximumFiles} 个上限。`);
    const files: D2CAgent.ProjectCodeFileSnapshot[] = [];
    const warnings: string[] = [];
    let totalBytes = 0;
    for (const request of requested) {
      throwIfAborted(input.signal);
      const snapshot = await readSnapshot(projectRoot, request.path, request.role, input.signal);
      if (snapshot.status === "existing") {
        totalBytes += snapshot.byteSize;
        if (totalBytes > maximumTotalBytes) throw new Error("代码上下文总内容超过 2 MiB 上限。");
      } else if (snapshot.role === "reference") {
        warnings.push(`复用参考文件在生成前已不存在：${snapshot.path}`);
      }
      files.push(snapshot);
    }
    return { files, warnings };
  }
}

/** 让计划文件覆盖同路径参考文件，并保持稳定顺序。 */
function collectRequestedPaths(
  plannedPaths: readonly string[],
  referencePaths: readonly string[],
): Array<{ path: string; role: "planned" | "reference" }> {
  const requests = new Map<string, "planned" | "reference">();
  for (const path of referencePaths) requests.set(validateRelativePath(path), "reference");
  for (const path of plannedPaths) requests.set(validateRelativePath(path), "planned");
  return [...requests.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, role]) => ({ path, role }));
}

/** 读取一个普通 UTF-8 文本文件；不存在时只返回明确缺失状态。 */
async function readSnapshot(
  projectRoot: string,
  path: string,
  role: "planned" | "reference",
  signal?: AbortSignal,
): Promise<D2CAgent.ProjectCodeFileSnapshot> {
  const absolutePath = resolve(projectRoot, path);
  assertWithinProject(projectRoot, absolutePath, path);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) throw error;
    await assertMissingPathAncestor(projectRoot, absolutePath, path);
    return { path, role, status: "missing", byteSize: 0 };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`代码上下文路径不是普通文件：${path}`);
  if (stats.size > maximumFileBytes) throw new Error(`代码上下文文件超过 512 KiB 上限：${path}`);
  const resolvedPath = await realpath(absolutePath);
  if (resolvedPath !== absolutePath) throw new Error(`代码上下文拒绝符号链接或非规范路径：${path}`);
  assertWithinProject(projectRoot, resolvedPath, path);
  const content = await readFile(resolvedPath, "utf8");
  throwIfAborted(signal);
  if (content.includes("\0")) throw new Error(`代码上下文拒绝二进制文件：${path}`);
  return {
    path,
    role,
    status: "existing",
    byteSize: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    content,
  };
}

/** 对尚不存在的新文件验证最近存在祖先没有通过符号链接逃逸。 */
async function assertMissingPathAncestor(
  projectRoot: string,
  absolutePath: string,
  requestedPath: string,
): Promise<void> {
  let candidate = dirname(absolutePath);
  while (candidate !== projectRoot) {
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`新建文件父路径不安全：${requestedPath}`);
      }
      const resolved = await realpath(candidate);
      assertWithinProject(projectRoot, resolved, requestedPath);
      return;
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
      candidate = dirname(candidate);
    }
  }
}

/** 拒绝绝对路径、当前目录、父目录和空路径片段。 */
function validateRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`代码上下文包含不安全路径：${path}`);
  }
  return normalized;
}

/** 判断候选绝对路径仍位于规范项目根目录内。 */
function assertWithinProject(projectRoot: string, candidate: string, requestedPath: string): void {
  const relativePath = relative(projectRoot, candidate);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) return;
  throw new Error(`代码上下文路径逃逸项目根目录：${requestedPath}`);
}

/** 仅将标准 ENOENT 识别为预期的文件缺失。 */
function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** 在遍历和读取边界及时传播用户取消。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("代码上下文读取已由用户终止。", "AbortError");
}
