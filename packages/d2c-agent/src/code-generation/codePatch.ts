/** 定义按 Plan 步骤生成、带文件版本绑定和审阅 Diff 的结构化代码 Patch。 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { EvolvingPlanningResult } from "../planning/evolvingPlan.js";
import type { ProjectCodeContext, ProjectCodeFileSnapshot } from "./projectCodeContext.js";

const maximumGeneratedFileBytes = 512 * 1024;
const maximumGeneratedPatchBytes = 2 * 1024 * 1024;

const proposedFilePatchSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["create", "modify", "delete"]),
  content: z.string().max(maximumGeneratedFileBytes).optional(),
});

/** 校验 Code Agent 只能生成严格结构化的步骤 Patch 或明确阻塞结论。 */
export const codeGenerationProposalSchema = z.object({
  status: z.enum(["generated", "blocked"]),
  summary: z.string().min(1),
  stepPatches: z.array(z.object({
    stepId: z.string().min(1),
    files: z.array(proposedFilePatchSchema).min(1).max(80),
  })).max(80),
  warnings: z.array(z.string().min(1)).max(50),
  blockedReasons: z.array(z.string().min(1)).max(20),
}).superRefine((proposal, context) => {
  if (proposal.status === "generated" && proposal.blockedReasons.length > 0) {
    context.addIssue({ code: "custom", path: ["blockedReasons"], message: "已生成结果不能包含阻塞原因。" });
  }
  if (proposal.status === "blocked" && proposal.blockedReasons.length === 0) {
    context.addIssue({ code: "custom", path: ["blockedReasons"], message: "阻塞结果必须说明原因。" });
  }
  if (proposal.status === "blocked" && proposal.stepPatches.length > 0) {
    context.addIssue({ code: "custom", path: ["stepPatches"], message: "阻塞结果不能包含部分候选 Patch。" });
  }
});

/** 代码模型可以返回的唯一结构化响应。 */
export type CodeGenerationProposal = z.infer<typeof codeGenerationProposalSchema>;

/** 单个计划步骤对一个文件产生的可审阅内容变换。 */
export interface CodePatchOperation {
  path: string;
  action: "create" | "modify" | "delete";
  beforeHash: string | null;
  afterHash: string | null;
  content?: string;
  reviewDiff: string;
}

/** 绑定一个原子计划步骤的候选 Patch。 */
export interface CodeStepPatch {
  stepId: string;
  patchHash: string;
  operations: CodePatchOperation[];
}

/** 绑定当前 Plan 版本的完整候选 Patch 集合。 */
export interface CodePatchSet {
  patchSetHash: string;
  planVersion: number;
  planHash: string;
  summary: string;
  patches: CodeStepPatch[];
  warnings: string[];
}

/** 代码阶段持久化到任务中的成功或阻塞结论。 */
export type CodeGenerationOutcome =
  | { status: "ready"; patchSet: CodePatchSet }
  | { status: "blocked"; summary: string; reasons: string[]; warnings: string[] };

/** 校验并隔离复制模型返回的未知代码生成结果。 */
export function parseCodeGenerationProposal(input: unknown): CodeGenerationProposal {
  return structuredClone(codeGenerationProposalSchema.parse(input));
}

/** 按计划步骤和初始文件快照验证模型输出，并生成带哈希的 Patch 集合。 */
export function createCodePatchSet(
  plan: EvolvingPlanningResult,
  context: ProjectCodeContext,
  proposalInput: unknown,
): CodePatchSet | { blocked: true; summary: string; reasons: string[]; warnings: string[] } {
  const proposal = parseCodeGenerationProposal(proposalInput);
  if (proposal.status === "blocked") {
    return {
      blocked: true,
      summary: proposal.summary,
      reasons: [...proposal.blockedReasons],
      warnings: [...proposal.warnings],
    };
  }

  const plannedSnapshots = new Map(context.files
    .filter((file) => file.role === "planned")
    .map((file) => [file.path, file]));
  const simulated = new Map<string, SimulatedFileState>();
  for (const path of plan.execution.files) {
    const snapshot = plannedSnapshots.get(path);
    if (!snapshot) throw new Error(`代码生成上下文缺少计划文件：${path}`);
    simulated.set(path, toSimulatedState(snapshot));
  }

  const expectedSteps = plan.execution.steps.filter((step) => step.files.length > 0);
  if (expectedSteps.length === 0) throw new Error("当前 Plan 没有可以生成代码的文件操作。");
  if (proposal.stepPatches.length !== expectedSteps.length) {
    throw new Error("代码 Patch 必须逐项覆盖所有包含文件操作的计划步骤。");
  }
  const patches: CodeStepPatch[] = [];
  let totalGeneratedBytes = 0;
  for (const [index, step] of expectedSteps.entries()) {
    const proposedStep = proposal.stepPatches[index];
    if (!proposedStep || proposedStep.stepId !== step.id) {
      throw new Error(`代码 Patch 步骤顺序或 ID 与 Plan 不一致：${step.id}`);
    }
    if (proposedStep.files.length !== step.files.length) {
      throw new Error(`代码 Patch 文件数与计划步骤不一致：${step.id}`);
    }
    const operations = step.files.map((plannedOperation, operationIndex) => {
      const proposed = proposedStep.files[operationIndex];
      if (!proposed || proposed.path !== plannedOperation.path || proposed.action !== plannedOperation.action) {
        throw new Error(`代码 Patch 扩大或改变了计划文件操作：${step.id}`);
      }
      const current = simulated.get(plannedOperation.path);
      if (!current) throw new Error(`代码 Patch 引用了未读取的计划文件：${plannedOperation.path}`);
      const operation = createOperation(proposed, current);
      totalGeneratedBytes += operation.content === undefined ? 0 : Buffer.byteLength(operation.content, "utf8");
      if (totalGeneratedBytes > maximumGeneratedPatchBytes) throw new Error("候选 Patch 总内容超过 2 MiB 上限。");
      simulated.set(plannedOperation.path, applyOperation(current, operation));
      return operation;
    });
    const patchHash = hashValue({ stepId: step.id, operations });
    patches.push({ stepId: step.id, patchHash, operations });
  }
  validateFinalFileImpacts(plan, context, simulated);
  const patchSetWithoutHash = {
    planVersion: plan.planVersion,
    planHash: plan.planHash,
    summary: proposal.summary,
    patches,
    warnings: [...new Set([...context.warnings, ...proposal.warnings])],
  };
  return {
    patchSetHash: hashValue(patchSetWithoutHash),
    ...patchSetWithoutHash,
  };
}

/** 重新计算步骤与集合哈希，并校验待写入完整内容没有在持久化后被篡改。 */
export function assertCodePatchSetIntegrity(patchSet: CodePatchSet): void {
  for (const patch of patchSet.patches) {
    for (const operation of patch.operations) {
      if (operation.action === "delete") {
        if (operation.content !== undefined || operation.afterHash !== null || operation.beforeHash === null) {
          throw new Error(`候选 Patch 删除操作结构无效：${operation.path}`);
        }
        continue;
      }
      if (operation.content === undefined || operation.afterHash !== hashText(operation.content)) {
        throw new Error(`候选 Patch 文件内容哈希不一致：${operation.path}`);
      }
      const validBeforeHash = operation.action === "create"
        ? operation.beforeHash === null
        : operation.beforeHash !== null;
      if (!validBeforeHash) throw new Error(`候选 Patch 文件前置哈希无效：${operation.path}`);
    }
    const expectedPatchHash = hashValue({ stepId: patch.stepId, operations: patch.operations });
    if (patch.patchHash !== expectedPatchHash) throw new Error(`候选步骤 Patch 哈希不一致：${patch.stepId}`);
  }
  const expectedPatchSetHash = hashValue({
    planVersion: patchSet.planVersion,
    planHash: patchSet.planHash,
    summary: patchSet.summary,
    patches: patchSet.patches,
    warnings: patchSet.warnings,
  });
  if (patchSet.patchSetHash !== expectedPatchSetHash) throw new Error("候选 Patch 集合哈希不一致。");
}

interface SimulatedFileState {
  exists: boolean;
  hash: string | null;
  content: string | null;
}

/** 将受控文件快照转换为逐步骤文件状态。 */
function toSimulatedState(snapshot: ProjectCodeFileSnapshot): SimulatedFileState {
  if (snapshot.status === "missing") return { exists: false, hash: null, content: null };
  if (!snapshot.sha256 || snapshot.content === undefined) {
    throw new Error(`现有计划文件缺少内容或哈希：${snapshot.path}`);
  }
  return { exists: true, hash: snapshot.sha256, content: snapshot.content };
}

/** 校验单次文件动作的前置状态、内容字段和大小。 */
function createOperation(
  proposed: z.infer<typeof proposedFilePatchSchema>,
  current: SimulatedFileState,
): CodePatchOperation {
  if (proposed.action === "create" && current.exists) throw new Error(`新建文件已经存在：${proposed.path}`);
  if (proposed.action !== "create" && !current.exists) throw new Error(`待${proposed.action === "modify" ? "修改" : "删除"}文件不存在：${proposed.path}`);
  if (proposed.action === "delete") {
    if (proposed.content !== undefined) throw new Error(`删除操作不能包含文件内容：${proposed.path}`);
    return {
      path: proposed.path,
      action: proposed.action,
      beforeHash: current.hash,
      afterHash: null,
      reviewDiff: createReviewDiff(proposed.path, current.content ?? "", null),
    };
  }
  if (proposed.content === undefined) throw new Error(`代码 Patch 缺少完整文件内容：${proposed.path}`);
  const byteSize = Buffer.byteLength(proposed.content, "utf8");
  if (byteSize > maximumGeneratedFileBytes) throw new Error(`候选文件超过 512 KiB 上限：${proposed.path}`);
  if (proposed.action === "modify" && proposed.content === current.content) {
    throw new Error(`修改操作没有产生内容变化：${proposed.path}`);
  }
  return {
    path: proposed.path,
    action: proposed.action,
    beforeHash: current.hash,
    afterHash: hashText(proposed.content),
    content: proposed.content,
    reviewDiff: createReviewDiff(proposed.path, current.content, proposed.content),
  };
}

/** 将已校验操作应用到内存状态，不触碰目标仓库。 */
function applyOperation(current: SimulatedFileState, operation: CodePatchOperation): SimulatedFileState {
  if (operation.action === "delete") return { exists: false, hash: null, content: null };
  return {
    exists: true,
    hash: operation.afterHash,
    content: operation.content ?? current.content,
  };
}

/** 确认步骤执行后的最终文件生命周期与 Plan 文件影响一致。 */
function validateFinalFileImpacts(
  plan: EvolvingPlanningResult,
  context: ProjectCodeContext,
  simulated: ReadonlyMap<string, SimulatedFileState>,
): void {
  const initial = new Map(context.files
    .filter((file) => file.role === "planned")
    .map((file) => [file.path, file]));
  for (const impact of plan.execution.fileImpacts) {
    const initialSnapshot = initial.get(impact.path);
    const final = simulated.get(impact.path);
    if (!initialSnapshot || !final) throw new Error(`文件影响缺少代码快照：${impact.path}`);
    const existed = initialSnapshot.status === "existing";
    const valid = impact.action === "create"
      ? !existed && final.exists
      : impact.action === "modify"
        ? existed && final.exists && final.hash !== initialSnapshot.sha256
        : existed && !final.exists;
    if (!valid) throw new Error(`代码 Patch 最终生命周期与 Plan 不一致：${impact.path}`);
  }
}

/** 生成无需第三方依赖、可直接审阅的整文件 Unified Diff。 */
function createReviewDiff(path: string, before: string | null, after: string | null): string {
  const beforeLines = before === null ? [] : splitLines(before);
  const afterLines = after === null ? [] : splitLines(after);
  const oldPath = before === null ? "/dev/null" : `a/${path}`;
  const newPath = after === null ? "/dev/null" : `b/${path}`;
  const header = [`--- ${oldPath}`, `+++ ${newPath}`, `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`];
  return [...header, ...beforeLines.map((line) => `-${line}`), ...afterLines.map((line) => `+${line}`)].join("\n");
}

/** 保留末尾空行语义，同时避免空文件产生一个虚假行。 */
function splitLines(value: string): string[] {
  return value === "" ? [] : value.replace(/\n$/, "").split("\n");
}

/** 计算 UTF-8 文本的稳定 SHA-256。 */
function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 对结构化对象稳定排序后生成内容哈希。 */
function hashValue(value: unknown): string {
  return hashText(JSON.stringify(sortJsonValue(value)));
}

/** 递归排序记录键，保留数组的业务顺序。 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJsonValue(entry)]));
}
