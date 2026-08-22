/** 解析日志使用的稳定 Workspace 身份，并隔离 Git 探测与目录命名细节。 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 日志目录对应的 Workspace 类型与脱敏后身份。 */
export interface WorkspaceIdentity {
  type: "git" | "local" | "unknown";
  value: string;
  directoryName: string;
}

/** 允许测试替换固定参数的 Git remote 读取行为。 */
export type GitRemoteReader = (absoluteWorkspacePath: string) => Promise<string | undefined>;

/** 优先使用脱敏 Git remote，否则使用绝对路径生成稳定日志目录。 */
export class WorkspaceIdentityResolver {
  private readonly readGitRemote: GitRemoteReader;

  /** 创建 Workspace 身份解析器；默认只执行固定参数的只读 Git 命令。 */
  constructor(readGitRemote: GitRemoteReader = readOriginRemote) {
    this.readGitRemote = readGitRemote;
  }

  /** 解析路径对应的 Workspace 身份；空路径归入独立的 unknown 目录。 */
  async resolve(projectPath: string): Promise<WorkspaceIdentity> {
    if (!projectPath.trim()) {
      return { type: "unknown", value: "unknown", directoryName: "unknown" };
    }

    const absolutePath = resolve(projectPath);
    const remote = await this.readGitRemote(absolutePath).catch(() => undefined);
    if (remote) return createIdentity("git", sanitizeRemoteUrl(remote));
    return createIdentity("local", absolutePath);
  }
}

/** 使用固定参数读取 origin remote，不接受调用方提供任意命令。 */
async function readOriginRemote(absoluteWorkspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", absoluteWorkspacePath, "config", "--get", "remote.origin.url"],
      { encoding: "utf8", timeout: 2_000 },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** 移除 remote 中可能存在的认证信息和非仓库身份查询参数。 */
function sanitizeRemoteUrl(remote: string): string {
  const trimmed = remote.trim();
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed
      .replace(/^[^@/\s]+@(?=[^:/\s]+:)/, "")
      .replace(/[?#].*$/, "");
  }
}

/** 将完整 Workspace 身份映射为可读且不会路径逃逸的单级目录名。 */
function createIdentity(type: "git" | "local", value: string): WorkspaceIdentity {
  const repositoryName = basename(value.replace(/\.git\/?$/, "")) || "workspace";
  const slug = repositoryName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    || "workspace";
  const digest = createHash("sha256").update(`${type}:${value}`).digest("hex").slice(0, 16);
  return { type, value, directoryName: `${slug}-${digest}` };
}
