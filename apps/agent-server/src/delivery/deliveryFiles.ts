/** 有界读取交付文件，核对真实路径和同一文件句柄，避免报告扩展任务访问范围。 */
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** 文件检查失败只暴露固定原因，不将底层磁盘错误或文件内容交给客户端。 */
export class DeliveryFileError extends Error {
  /** 用于映射报告可用性及单项文件证据状态。 */
  constructor(readonly reason: "missing" | "outside-scope" | "unreadable" | "too-large") {
    super(reason);
  }
}

/** 一次查询共享的读取预算；失败的已分配读取也计入预算。 */
export interface DeliveryReadBudget {
  /** 本次查询尚可读取的文件内容总字节数。 */
  remaining: number;
}

/** 使用路径段判断包含关系，拒绝同名前缀及其他盘符。 */
export function containsDeliveryPath(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/** 报告目录由服务计算，其下不能通过符号链接切换到其他任务或目录。 */
export async function assertDeliveryDirectory(root: string, directory: string): Promise<void> {
  if (!containsDeliveryPath(root, directory)) throw new DeliveryFileError("outside-scope");
  let path = root;
  for (const part of relative(root, directory).split(sep).filter(Boolean)) {
    path = resolve(path, part);
    const entry = await diskOperation(() => lstat(path));
    if (entry.isSymbolicLink()) throw new DeliveryFileError("outside-scope");
    if (!entry.isDirectory()) throw new DeliveryFileError("unreadable");
  }
}

/** 普通磁盘异常映射为稳定状态；仅文件确实不存在时返回 missing。 */
export async function diskOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DeliveryFileError) throw error;
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") throw new DeliveryFileError("missing");
    if (code === "ELOOP") throw new DeliveryFileError("outside-scope");
    throw new DeliveryFileError("unreadable");
  }
}

/** 不解码报告路径；拒绝 URL 和跨平台歧义，百分号只是文件名的字面字符。 */
export function deliveryPath(path: string, workspace: string): string {
  const nativeDrivePath = isAbsolute(path) && /^[a-z]:[\\/]/i.test(path);
  if (
    /[\u0000-\u001f\u007f]/.test(path) ||
    (path.includes("\\") && !nativeDrivePath) ||
    (/^[a-z][a-z\d+.-]*:/i.test(path) && !nativeDrivePath) ||
    path.startsWith("//") ||
    path.startsWith("\\\\")
  )
    throw new DeliveryFileError("outside-scope");
  return resolve(workspace, path);
}

/** 拒绝绝对路径、父目录段和非规范写法，源码清单始终使用工作区相对路径。 */
export function sourceDeliveryPath(path: string, workspace: string): string {
  const resolved = deliveryPath(path, workspace);
  if (
    isAbsolute(path) ||
    !path ||
    !containsDeliveryPath(workspace, resolved) ||
    relative(workspace, resolved).split(sep).join("/") !== path ||
    path === "."
  ) {
    throw new DeliveryFileError("outside-scope");
  }
  return resolved;
}

/** 从校验后的同一文件句柄读取，大小、总预算和读取期间身份变化都保持失败关闭。 */
export async function readDeliveryFile(
  path: string,
  roots: readonly string[],
  budget: DeliveryReadBudget,
  maximumBytes: number,
  restricted?: { root: string; allowed: string },
): Promise<{ bytes: Buffer; path: string }> {
  return diskOperation(async () => {
    const forbidden = (candidate: string) =>
      restricted &&
      containsDeliveryPath(restricted.root, candidate) &&
      !containsDeliveryPath(restricted.allowed, candidate);
    if (forbidden(path)) throw new DeliveryFileError("outside-scope");
    if (!roots.some((root) => containsDeliveryPath(root, path))) {
      throw new DeliveryFileError("outside-scope");
    }
    const actual = await realpath(path);
    if (forbidden(actual)) throw new DeliveryFileError("outside-scope");
    if (!roots.some((root) => containsDeliveryPath(root, actual))) {
      throw new DeliveryFileError("outside-scope");
    }
    // NONBLOCK prevents a swapped FIFO from hanging before fstat can reject it.
    const handle = await open(
      actual,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new DeliveryFileError("unreadable");
      if (before.size > maximumBytes || before.size > budget.remaining) {
        throw new DeliveryFileError("too-large");
      }
      budget.remaining -= before.size;
      const bytes = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const location = await stat(actual);
      if (
        length !== before.size ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        location.dev !== after.dev ||
        location.ino !== after.ino ||
        location.size !== after.size ||
        location.mtimeMs !== after.mtimeMs ||
        location.ctimeMs !== after.ctimeMs ||
        (await realpath(path)) !== actual ||
        (await realpath(actual)) !== actual
      )
        throw new DeliveryFileError("unreadable");
      return { bytes: bytes.subarray(0, length), path: actual };
    } finally {
      await handle.close();
    }
  });
}
