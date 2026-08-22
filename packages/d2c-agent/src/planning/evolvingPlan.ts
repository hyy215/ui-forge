/** 定义可在后续 Patch 阶段增量演进、同时保护人工意图的版本化 Plan 领域模型。 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  PlanningFileImpact,
  PlanningResult,
  PlanningStep,
} from "./planningResult.js";

/** 人工可以确认并锁定的稳定意图字段。 */
export const planIntentFieldSchema = z.enum([
  "layout.role",
  "layout.relationship",
  "layout.direction",
  "component.componentType",
  "component.responsibility",
  "interaction.trigger",
  "interaction.expectedEffect",
]);

/** 人工可以确认并锁定的稳定意图字段。 */
export type PlanIntentField = z.infer<typeof planIntentFieldSchema>;

const planIntentTargetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["layout", "component", "interaction"]),
  fields: z.partialRecord(planIntentFieldSchema, z.string().min(1)),
}).superRefine((target, context) => {
  for (const field of Object.keys(target.fields) as PlanIntentField[]) {
    if (!field.startsWith(`${target.kind}.`)) {
      context.addIssue({
        code: "custom",
        path: ["fields", field],
        message: `意图字段 ${field} 不属于 ${target.kind} 目标。`,
      });
    }
  }
});

/** 描述人工审阅的稳定布局、组件和交互目标。 */
export const planningIntentSchema = z.object({
  targets: z.array(planIntentTargetSchema),
}).superRefine((intent, context) => {
  const ids = new Set<string>();
  for (const [index, target] of intent.targets.entries()) {
    if (ids.has(target.id)) {
      context.addIssue({ code: "custom", path: ["targets", index, "id"], message: `意图目标重复：${target.id}` });
    }
    ids.add(target.id);
  }
});

/** 描述人工审阅的稳定布局、组件和交互目标。 */
export type PlanningIntent = z.infer<typeof planningIntentSchema>;

/** 记录一个只能由人工显式解锁的字段值。 */
export interface HumanPlanFieldLock {
  targetId: string;
  field: PlanIntentField;
  value: string;
  reason: string;
  lockedAtVersion: number;
}

/** 把候选 Patch 绑定到产生它的 Plan 版本和步骤。 */
export interface PlanPatchBinding {
  patchHash: string;
  planHash: string;
  stepId: string;
  status: "active" | "invalidated";
  invalidatedByPlanVersion?: number | undefined;
}

/** 保存每次人工或自动 Plan 演进的审计摘要。 */
export interface PlanRevisionRecord {
  version: number;
  source: "human" | "automatic";
  reason: string;
  evidence: string[];
  affectedStepIds: string[];
}

/** 将稳定人工意图与可以继续细化的执行方案组合成版本化 Plan。 */
export interface EvolvingPlanningResult {
  planVersion: number;
  planHash: string;
  intent: PlanningIntent;
  execution: PlanningResult;
  locks: HumanPlanFieldLock[];
  patchBindings: PlanPatchBinding[];
  revisionHistory: PlanRevisionRecord[];
}

const planningStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["initialize", "layout", "component", "interaction", "cross-cutting", "validation"]),
  targetId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  decision: z.enum(["create", "reuse", "configure", "wrap", "extend", "modify", "validate"]),
  dependsOn: z.array(z.string().min(1)),
  files: z.array(z.object({
    path: z.string().min(1),
    action: z.enum(["create", "modify", "delete"]),
  })),
  designElementIds: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)),
});

const planningFileImpactSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["create", "modify", "delete"]),
  reason: z.string().min(1),
  affectedSymbols: z.array(z.string().min(1)),
  downstreamConsumers: z.array(z.string().min(1)),
  risk: z.enum(["low", "medium", "high"]),
  evidence: z.array(z.string().min(1)).min(1),
});

const planDeltaSchema = z.object({
  id: z.string().min(1),
  basePlanVersion: z.number().int().positive(),
  basePlanHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  intentUpdates: z.array(z.object({
    targetId: z.string().min(1),
    field: planIntentFieldSchema,
    value: z.string().min(1),
  })),
  executionChanges: z.array(z.discriminatedUnion("action", [
    z.object({ action: z.literal("upsert-step"), step: planningStepSchema }),
    z.object({ action: z.literal("remove-step"), stepId: z.string().min(1) }),
    z.object({ action: z.literal("upsert-file-impact"), impact: planningFileImpactSchema }),
    z.object({ action: z.literal("remove-file-impact"), path: z.string().min(1) }),
  ])),
}).refine(
  (delta) => delta.intentUpdates.length + delta.executionChanges.length > 0,
  { message: "PlanDelta 至少包含一项变更。" },
);

/** 描述代码阶段基于新证据提出的一次最小 Plan 调整。 */
export type PlanDelta = z.infer<typeof planDeltaSchema>;

const humanCorrectionSchema = z.object({
  reason: z.string().min(1),
  corrections: z.array(z.object({
    targetId: z.string().min(1),
    field: planIntentFieldSchema,
    value: z.string().min(1),
  })).min(1),
});

/** 描述自动修订试图覆盖人工锁时的精确冲突。 */
export interface PlanLockConflict {
  targetId: string;
  field: PlanIntentField;
  lockedValue: string;
  proposedValue: string;
  reason: string;
}

/** PlanDelta 的确定性合并结果。 */
export type PlanDeltaApplicationResult =
  | { status: "applied"; plan: EvolvingPlanningResult; affectedStepIds: string[] }
  | { status: "stale"; expectedVersion: number; expectedHash: string }
  | { status: "human-decision-required"; conflicts: PlanLockConflict[] }
  | { status: "rejected"; errors: string[] };

/** 校验并复制人工意图，创建尚未绑定任何 Patch 的首版 Plan。 */
export function createEvolvingPlanningResult(
  intentInput: unknown,
  execution: PlanningResult,
): EvolvingPlanningResult {
  const intent = planningIntentSchema.parse(intentInput);
  return finalizePlan({
    planVersion: 1,
    intent: structuredClone(intent),
    execution: structuredClone(execution),
    locks: [],
    patchBindings: [],
    revisionHistory: [],
  });
}

/** 校验来自模型或外部阶段的未知 PlanDelta。 */
export function parsePlanDelta(input: unknown): PlanDelta {
  return structuredClone(planDeltaSchema.parse(input));
}

/** 应用人工修正并把修正字段锁定；已有同字段锁会被最新人工值替换。 */
export function applyHumanPlanCorrections(
  plan: EvolvingPlanningResult,
  input: unknown,
): EvolvingPlanningResult {
  const correction = humanCorrectionSchema.parse(input);
  const intent = structuredClone(plan.intent);
  for (const update of correction.corrections) setIntentField(intent, update);
  const nextVersion = plan.planVersion + 1;
  const lockByField = new Map(plan.locks.map((lock) => [lockKey(lock.targetId, lock.field), structuredClone(lock)]));
  for (const update of correction.corrections) {
    lockByField.set(lockKey(update.targetId, update.field), {
      targetId: update.targetId,
      field: update.field,
      value: update.value,
      reason: correction.reason,
      lockedAtVersion: nextVersion,
    });
  }
  const affectedStepIds = collectAffectedSteps(
    plan.execution,
    plan.execution,
    correction.corrections.map((update) => ({ kind: "target" as const, value: update.targetId })),
  );
  return finalizePlan({
    planVersion: nextVersion,
    intent,
    execution: structuredClone(plan.execution),
    locks: [...lockByField.values()],
    patchBindings: invalidatePatchBindings(plan.patchBindings, affectedStepIds, nextVersion),
    revisionHistory: [...plan.revisionHistory, {
      version: nextVersion,
      source: "human",
      reason: correction.reason,
      evidence: ["人工修正并锁定意图字段"],
      affectedStepIds,
    }],
  });
}

/** 仅由人工显式解锁字段；解锁本身产生新 Plan 版本。 */
export function unlockHumanPlanFields(
  plan: EvolvingPlanningResult,
  fields: ReadonlyArray<{ targetId: string; field: PlanIntentField }>,
  reason: string,
): EvolvingPlanningResult {
  if (!reason.trim()) throw new Error("人工解锁必须说明原因。");
  const keys = new Set(fields.map((field) => lockKey(field.targetId, field.field)));
  const nextLocks = plan.locks.filter((lock) => !keys.has(lockKey(lock.targetId, lock.field)));
  if (nextLocks.length === plan.locks.length) throw new Error("没有找到需要解锁的人工字段。");
  const nextVersion = plan.planVersion + 1;
  return finalizePlan({
    planVersion: nextVersion,
    intent: structuredClone(plan.intent),
    execution: structuredClone(plan.execution),
    locks: nextLocks,
    patchBindings: structuredClone(plan.patchBindings),
    revisionHistory: [...plan.revisionHistory, {
      version: nextVersion,
      source: "human",
      reason,
      evidence: ["人工显式解锁意图字段"],
      affectedStepIds: [],
    }],
  });
}

/** 自动合并未触碰人工锁的 PlanDelta，并失效受影响步骤绑定的旧 Patch。 */
export function applyPlanDelta(
  plan: EvolvingPlanningResult,
  deltaInput: unknown,
): PlanDeltaApplicationResult {
  const parsed = planDeltaSchema.safeParse(deltaInput);
  if (!parsed.success) {
    return { status: "rejected", errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`) };
  }
  const delta = parsed.data;
  if (delta.basePlanVersion !== plan.planVersion || delta.basePlanHash !== plan.planHash) {
    return { status: "stale", expectedVersion: plan.planVersion, expectedHash: plan.planHash };
  }
  const locks = new Map(plan.locks.map((lock) => [lockKey(lock.targetId, lock.field), lock]));
  const conflicts = delta.intentUpdates.flatMap((update) => {
    const lock = locks.get(lockKey(update.targetId, update.field));
    return lock && lock.value !== update.value ? [{
      targetId: update.targetId,
      field: update.field,
      lockedValue: lock.value,
      proposedValue: update.value,
      reason: lock.reason,
    }] : [];
  });
  if (conflicts.length > 0) return { status: "human-decision-required", conflicts };

  const intent = structuredClone(plan.intent);
  try {
    for (const update of delta.intentUpdates) setIntentField(intent, update);
  } catch (error: unknown) {
    return { status: "rejected", errors: [error instanceof Error ? error.message : String(error)] };
  }
  const execution = structuredClone(plan.execution);
  const seeds: Array<{ kind: "target" | "step" | "file"; value: string }> = delta.intentUpdates
    .map((update) => ({ kind: "target" as const, value: update.targetId }));
  for (const change of delta.executionChanges) {
    switch (change.action) {
      case "upsert-step":
        upsertBy(execution.steps, toPlanningStep(change.step), (step) => step.id);
        seeds.push({ kind: "step", value: change.step.id });
        break;
      case "remove-step":
        execution.steps = execution.steps.filter((step) => step.id !== change.stepId);
        seeds.push({ kind: "step", value: change.stepId });
        break;
      case "upsert-file-impact":
        upsertBy(execution.fileImpacts, toPlanningFileImpact(change.impact), (impact) => impact.path);
        seeds.push({ kind: "file", value: change.impact.path });
        break;
      case "remove-file-impact":
        execution.fileImpacts = execution.fileImpacts.filter((impact) => impact.path !== change.path);
        seeds.push({ kind: "file", value: change.path });
        break;
    }
  }
  execution.files = [...new Set(execution.fileImpacts.map((impact) => impact.path))];
  const structuralErrors = validateExecutionStructure(execution);
  if (structuralErrors.length > 0) return { status: "rejected", errors: structuralErrors };
  const affectedStepIds = collectAffectedSteps(plan.execution, execution, seeds);
  const nextVersion = plan.planVersion + 1;
  const nextPlan = finalizePlan({
    planVersion: nextVersion,
    intent,
    execution,
    locks: structuredClone(plan.locks),
    patchBindings: invalidatePatchBindings(plan.patchBindings, affectedStepIds, nextVersion),
    revisionHistory: [...plan.revisionHistory, {
      version: nextVersion,
      source: "automatic",
      reason: delta.reason,
      evidence: [...delta.evidence],
      affectedStepIds,
    }],
  });
  return { status: "applied", plan: nextPlan, affectedStepIds };
}

/** 记录候选 Patch 对当前 Plan 和单个步骤的绑定。 */
export function bindPatchToPlan(
  plan: EvolvingPlanningResult,
  input: { patchHash: string; planHash: string; stepId: string },
): EvolvingPlanningResult {
  if (!/^[a-f0-9]{64}$/.test(input.patchHash)) throw new Error("Patch 哈希必须是 SHA-256 十六进制字符串。");
  if (input.planHash !== plan.planHash) throw new Error("Patch 绑定的 Plan 哈希已经过期。");
  if (!plan.execution.steps.some((step) => step.id === input.stepId)) throw new Error(`Patch 引用了未知步骤：${input.stepId}`);
  return {
    ...structuredClone(plan),
    patchBindings: [
      ...plan.patchBindings
        .filter((binding) => binding.patchHash !== input.patchHash)
        .map((binding) => structuredClone(binding)),
      { patchHash: input.patchHash, planHash: input.planHash, stepId: input.stepId, status: "active" },
    ],
  };
}

interface PlanWithoutHash {
  planVersion: number;
  intent: PlanningIntent;
  execution: PlanningResult;
  locks: HumanPlanFieldLock[];
  patchBindings: PlanPatchBinding[];
  revisionHistory: PlanRevisionRecord[];
}

/** 计算 Plan 内容哈希并返回不可与旧 Patch 混用的新对象。 */
function finalizePlan(plan: PlanWithoutHash): EvolvingPlanningResult {
  const planHash = calculatePlanHash(plan);
  return {
    ...structuredClone(plan),
    planHash,
    patchBindings: plan.patchBindings.map((binding) => binding.status === "active"
      ? { ...structuredClone(binding), planHash }
      : structuredClone(binding)),
  };
}

/** 只把影响实现语义的当前状态纳入 Plan 哈希。 */
function calculatePlanHash(plan: PlanWithoutHash): string {
  return createHash("sha256").update(stableStringify({
    planVersion: plan.planVersion,
    intent: plan.intent,
    execution: plan.execution,
    locks: plan.locks,
  })).digest("hex");
}

/** 更新一个已存在且字段类型匹配的意图目标。 */
function setIntentField(
  intent: PlanningIntent,
  update: { targetId: string; field: PlanIntentField; value: string },
): void {
  const target = intent.targets.find((candidate) => candidate.id === update.targetId);
  if (!target) throw new Error(`Plan 修订引用了未知意图目标：${update.targetId}`);
  if (!update.field.startsWith(`${target.kind}.`)) {
    throw new Error(`意图字段 ${update.field} 不属于 ${target.kind} 目标。`);
  }
  target.fields[update.field] = update.value;
}

/** 将 Zod 输出显式复制为现有执行步骤契约。 */
function toPlanningStep(step: z.infer<typeof planningStepSchema>): PlanningStep {
  return {
    id: step.id,
    kind: step.kind,
    targetId: step.targetId,
    title: step.title,
    description: step.description,
    decision: step.decision,
    dependsOn: [...step.dependsOn],
    files: structuredClone(step.files),
    designElementIds: [...step.designElementIds],
    evidence: [...step.evidence],
    acceptanceCriteria: [...step.acceptanceCriteria],
    risks: [...step.risks],
  };
}

/** 将 Zod 输出显式复制为现有文件影响契约。 */
function toPlanningFileImpact(impact: z.infer<typeof planningFileImpactSchema>): PlanningFileImpact {
  return {
    path: impact.path,
    action: impact.action,
    reason: impact.reason,
    affectedSymbols: [...impact.affectedSymbols],
    downstreamConsumers: [...impact.downstreamConsumers],
    risk: impact.risk,
    evidence: [...impact.evidence],
  };
}

/** 按稳定键替换或追加领域对象。 */
function upsertBy<T>(values: T[], value: T, readKey: (entry: T) => string): void {
  const index = values.findIndex((entry) => readKey(entry) === readKey(value));
  if (index < 0) values.push(value);
  else values[index] = value;
}

/** 拒绝重复步骤、悬空依赖和重复文件影响。 */
function validateExecutionStructure(execution: PlanningResult): string[] {
  const errors: string[] = [];
  const stepIndexes = new Map<string, number>();
  for (const [index, step] of execution.steps.entries()) {
    if (stepIndexes.has(step.id)) errors.push(`执行方案步骤 ID 重复：${step.id}`);
    stepIndexes.set(step.id, index);
  }
  for (const [index, step] of execution.steps.entries()) {
    for (const dependency of step.dependsOn) {
      const dependencyIndex = stepIndexes.get(dependency);
      if (dependencyIndex === undefined) errors.push(`步骤 ${step.id} 引用了未知依赖：${dependency}`);
      else if (dependencyIndex >= index) errors.push(`步骤 ${step.id} 的依赖没有位于它之前：${dependency}`);
    }
  }
  const paths = new Set<string>();
  for (const impact of execution.fileImpacts) {
    if (paths.has(impact.path)) errors.push(`文件影响重复：${impact.path}`);
    paths.add(impact.path);
  }
  return [...new Set(errors)];
}

/** 从直接变化计算旧、新执行图中的全部下游步骤。 */
function collectAffectedSteps(
  previous: PlanningResult,
  next: PlanningResult,
  seeds: ReadonlyArray<{ kind: "target" | "step" | "file"; value: string }>,
): string[] {
  const allSteps = new Map([...previous.steps, ...next.steps].map((step) => [step.id, step]));
  const affected = new Set<string>();
  for (const seed of seeds) {
    if (seed.kind === "step") affected.add(seed.value);
    if (seed.kind === "target") {
      for (const step of allSteps.values()) if (step.targetId === seed.value) affected.add(step.id);
    }
    if (seed.kind === "file") {
      for (const step of allSteps.values()) {
        if (step.files.some((file) => file.path === seed.value)) affected.add(step.id);
      }
    }
  }
  if (affected.size > 0) {
    for (const step of allSteps.values()) if (step.kind === "validation") affected.add(step.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of allSteps.values()) {
      if (!affected.has(step.id) && step.dependsOn.some((dependency) => affected.has(dependency))) {
        affected.add(step.id);
        changed = true;
      }
    }
  }
  return [...affected].sort();
}

/** 只失效实际受影响步骤绑定的旧 Patch。 */
function invalidatePatchBindings(
  bindings: readonly PlanPatchBinding[],
  affectedStepIds: readonly string[],
  nextVersion: number,
): PlanPatchBinding[] {
  const affected = new Set(affectedStepIds);
  return bindings.map((binding) => binding.status === "active" && affected.has(binding.stepId)
    ? { ...structuredClone(binding), status: "invalidated", invalidatedByPlanVersion: nextVersion }
    : structuredClone(binding));
}

/** 为字段锁生成稳定复合键。 */
function lockKey(targetId: string, field: PlanIntentField): string {
  return `${targetId}\u0000${field}`;
}

/** 对对象键排序后生成跨调用稳定的 JSON。 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

/** 递归排序普通记录，同时保留数组中具有语义的原始顺序。 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJsonValue(entry)]));
}
