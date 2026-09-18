/** Server 运行目录边界：UI、CLI 和独立进程使用同一安装根，避免启动工作目录改变任务所有权。 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 相对配置始终以安装根解析；锁与会话索引 必须共用这个目录。 */
export function resolveRuntimeDirectory(configured?: string): string {
  return resolveServerDirectory(configured ?? ".ui-forge/runtime");
}

/** 附件的相对配置也必须与调用命令的当前目录无关。 */
export function resolveServerDirectory(configured: string): string {
  return resolve(fileURLToPath(new URL("../../../../", import.meta.url)), configured);
}
