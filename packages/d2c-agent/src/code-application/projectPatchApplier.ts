/** 定义把已授权候选 Patch 受控应用到目标项目的领域端口与持久结果。 */

import type { CodePatchSet } from "../code-generation/codePatch.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";

/** 单个目标文件完成应用后的最终动作。 */
export interface AppliedPatchFile {
  path: string;
  action: "create" | "modify" | "delete";
}

/** 文件系统适配器成功应用精确 Patch 后返回的有限结果。 */
export interface ProjectPatchApplySuccess {
  status: "applied";
  files: AppliedPatchFile[];
  alreadyApplied: boolean;
}

/** 文件漂移或安全门禁阻止写入时返回的可审计结果。 */
export interface ProjectPatchApplyBlocked {
  status: "blocked";
  summary: string;
  reasons: string[];
  manualActionRequired: true;
}

/** 受控文件系统应用器允许返回的确定性结论。 */
export type ProjectPatchApplyResult = ProjectPatchApplySuccess | ProjectPatchApplyBlocked;

/** 持久化到权威任务中的 Patch 应用结果。 */
export type PatchApplicationOutcome =
  | (ProjectPatchApplySuccess & { patchSetHash: string; appliedAt: string })
  | (ProjectPatchApplyBlocked & { patchSetHash: string; blockedAt: string });

/** 隔离 D2C 领域与真实 Workspace 写入实现。 */
export interface ProjectPatchApplier {
  /** 全量校验目标文件版本，并在可观察提交失败时回滚已触碰文件。 */
  apply(input: {
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    patchSet: CodePatchSet;
  }): Promise<ProjectPatchApplyResult>;
}
