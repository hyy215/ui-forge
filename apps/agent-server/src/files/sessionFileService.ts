/** 解析任务引用的真实文件，仅允许目标工作区及该项目的 ui-forge 临时目录。 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryWorkspacePath } from "@ui-forge/codex-client";
import {
  sessionFileInputSchema,
  sessionFileSchema,
  type SessionFile,
  type SessionFileInput,
} from "@ui-forge/shared-protocol";
import type { SessionIndex } from "../sessions/sessionIndex.js";

/** 只使用本地任务索引，打开文件不会启动或恢复 Codex。 */
export class SessionFileService {
  /** 运行目录由服务启动配置提供，不能由页面覆盖。 */
  constructor(
    private readonly index: SessionIndex,
    private readonly runtimeDirectory: string,
  ) {}

  /** 校验真实路径和常规文件类型；拒绝目录、越界路径及指向外部的符号链接。 */
  async resolve(input: SessionFileInput): Promise<SessionFile> {
    const parsed = sessionFileInputSchema.parse(input);
    const entry = this.index.get(parsed.taskId);
    const workspace = await realpath(entry.projectPath);
    const temporary = await optionalRealpath(
      await temporaryWorkspacePath(workspace, this.runtimeDirectory),
    );
    const location = fileLocation(parsed.path);
    let decoded = location.path;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* 含字面百分号的文件名保持原样。 */
    }
    for (const candidate of new Set([location.path, decoded])) {
      if (/[\u0000-\u001f]/.test(candidate)) throw new Error("文件路径包含无效字符。");
      const absolute = resolve(workspace, candidate);
      const actual = await optionalRealpath(absolute);
      if (!actual) continue;
      if (![workspace, temporary].some((root) => root && contains(root, actual)))
        throw new Error("不能打开任务目录之外的文件。");
      if (!(await stat(actual)).isFile()) throw new Error("链接必须指向文件，不能是目录。");
      return sessionFileSchema.parse({ ...location, path: actual });
    }
    throw new Error("文件不存在，或不在任务工作区及其临时目录中。");
  }
}

/** 使用路径段比较，避免同名前缀目录被误判为子目录。 */
function contains(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/** 缺失文件可继续尝试编码路径，其他磁盘错误保留为可见失败。 */
async function optionalRealpath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** 分离 Codex 常用的 :行:列 与 #L行C列，file URI 不允许远程主机。 */
function fileLocation(value: string): SessionFile {
  const location = /(?:#L(\d+)(?:C(\d+))?|:(\d+)(?::(\d+))?)$/.exec(value);
  let path = location ? value.slice(0, location.index) : value;
  if (/^file:/i.test(path)) {
    const url = new URL(path);
    if (url.hostname || url.search || url.hash) throw new Error("仅支持本地文件链接。");
    path = fileURLToPath(url);
  } else if (
    (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) ||
    path.startsWith("//") ||
    path.startsWith("\\\\")
  ) {
    throw new Error("仅支持本地文件路径。");
  }
  const line = location?.[1] ?? location?.[3];
  const column = location?.[2] ?? location?.[4];
  return sessionFileSchema.parse({
    path,
    ...(line ? { line: Number(line) } : {}),
    ...(column ? { column: Number(column) } : {}),
  });
}
