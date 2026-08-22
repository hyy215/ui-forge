/** 定义由外部仓库扫描能力实现的目标项目检查端口。 */

import type { ProjectInspection } from "./projectInspection.js";

/** 隔离 D2C 工作流与具体文件系统或远程仓库读取方式。 */
export interface ProjectInspector {
  /** 检查任务绑定项目并返回确定性的技术栈分类。 */
  inspect(projectPath: string): Promise<ProjectInspection>;
}
