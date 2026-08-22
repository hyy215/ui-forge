/** 将模型生成的消费者简称限定地归一化为受控项目中的完整相对文件路径。 */

import { basename, extname } from "node:path/posix";
import type { PlanningResult } from "./planningResult.js";

/** 根据组件与步骤中的明确新建意图纠正文件动作，并标记仍待执行前确认的引用。 */
export function reconcilePlanningFileOperations(
  plan: PlanningResult,
  knownFiles: readonly string[],
  filesComplete: boolean,
): PlanningResult {
  const normalizedKnownFiles = new Set(knownFiles.map(normalizePath));
  const explicitCreatePaths = collectExplicitCreatePaths(plan);
  const reconcileImpactAction = (
    path: string,
    action: "create" | "modify" | "delete",
  ): "create" | "modify" | "delete" => {
    if (action === "delete") return action;
    const normalizedPath = normalizePath(path);
    if (normalizedKnownFiles.has(normalizedPath)) return "modify";
    return filesComplete && explicitCreatePaths.has(normalizedPath) ? "create" : action;
  };
  const fileImpacts = plan.fileImpacts.map((impact) => ({
    ...structuredClone(impact),
    action: reconcileImpactAction(impact.path, impact.action),
  }));
  const filesAtStep = new Set(normalizedKnownFiles);
  const steps = plan.steps.map((step) => ({
    ...structuredClone(step),
    files: step.files.map((operation) => {
      const path = normalizePath(operation.path);
      const action = operation.action === "delete"
        ? "delete" as const
        : filesAtStep.has(path)
          ? "modify" as const
          : filesComplete && (explicitCreatePaths.has(path) || operation.action === "create")
            ? "create" as const
            : operation.action;
      if (action === "delete") filesAtStep.delete(path);
      else filesAtStep.add(path);
      return { ...operation, action };
    }),
  }));
  const uncertainties = collectFileOperationUncertainties(
    plan,
    normalizedKnownFiles,
    explicitCreatePaths,
    filesComplete,
  );
  return {
    ...structuredClone(plan),
    status: uncertainties.contextGaps.length > 0 ? "blocked" : plan.status,
    fileImpacts,
    steps,
    contextGaps: [...new Set([
      ...plan.contextGaps.filter((value) => !/^文件 .+ 的计划动作 .+ (?:与扫描结果不一致|缺少存在性证据：.+)。$/.test(value)),
      ...uncertainties.contextGaps,
    ])],
    stopConditions: [...new Set([
      ...plan.stopConditions.filter((value) => !/^生成 Patch 前必须重新确认 .+ 是否存在及其操作类型。$/.test(value)),
      ...uncertainties.stopConditions,
    ])],
  };
}

/** 从模型显式 create 动作和 create-new 组件步骤中收集可安全纠正的新文件。 */
function collectExplicitCreatePaths(plan: PlanningResult): Set<string> {
  const paths = new Set<string>();
  for (const impact of plan.fileImpacts) {
    if (impact.action === "create") paths.add(normalizePath(impact.path));
  }
  const createNewCandidates = new Set(plan.componentDecisions
    .filter((decision) => decision.source === "new" && decision.action === "create-new")
    .map((decision) => decision.candidateId));
  for (const step of plan.steps) {
    const hasCreateIntent = step.kind === "initialize"
      || (step.kind === "component" && step.decision === "create" && createNewCandidates.has(step.targetId));
    for (const operation of step.files) {
      if (operation.action === "create" || hasCreateIntent) paths.add(normalizePath(operation.path));
    }
  }
  return paths;
}

/** 依据已扫描文件与当前方案文件，将可唯一证明的消费者引用转换为完整路径。 */
export function normalizePlanningConsumerPaths(
  plan: PlanningResult,
  knownFiles: readonly string[],
): PlanningResult {
  const allowedPaths = [...new Set([
    ...knownFiles.map(normalizePath),
    ...plan.fileImpacts.map((impact) => normalizePath(impact.path)),
  ])];
  return {
    ...structuredClone(plan),
    fileImpacts: plan.fileImpacts.map((impact) => ({
      ...structuredClone(impact),
      downstreamConsumers: [...new Set(impact.downstreamConsumers.map(
        (reference) => resolveConsumerPath(reference, allowedPaths),
      ))],
    })),
  };
}

/** 只接受精确路径或唯一的文件名、文件 stem 与 index 目录名匹配。 */
function resolveConsumerPath(reference: string, allowedPaths: readonly string[]): string {
  const normalizedReference = normalizePath(reference);
  if (allowedPaths.includes(normalizedReference)) return normalizedReference;
  const matches = allowedPaths.filter((path) => matchesConsumerReference(path, normalizedReference));
  if (matches.length === 1) return matches[0] as string;
  if (matches.length > 1) throw new Error(`文件影响消费者路径存在歧义：${reference}`);
  throw new Error(`文件影响引用了未知消费者：${reference}`);
}

/** 判断简称是否能无歧义地指向某个允许文件。 */
function matchesConsumerReference(path: string, reference: string): boolean {
  const fileName = basename(path);
  const fileStem = fileName.slice(0, Math.max(0, fileName.length - extname(fileName).length));
  if (reference === fileName || reference === fileStem) return true;
  if (fileStem !== "index") return false;
  const segments = path.split("/");
  return segments.length > 1 && reference === segments.at(-2);
}

/** 收集不阻断方案审阅、但必须在 Patch 阶段重新核实的文件存在性疑点。 */
function collectFileOperationUncertainties(
  plan: PlanningResult,
  knownFiles: ReadonlySet<string>,
  explicitCreatePaths: ReadonlySet<string>,
  filesComplete: boolean,
): { contextGaps: string[]; stopConditions: string[] } {
  const operations = [
    ...plan.fileImpacts.map(({ path, action }) => ({ path, action })),
    ...plan.steps.flatMap((step) => step.files),
  ];
  const contextGaps: string[] = [];
  const stopConditions: string[] = [];
  for (const operation of operations) {
    const path = normalizePath(operation.path);
    const exists = knownFiles.has(path);
    if (exists || (filesComplete && (operation.action === "create" || explicitCreatePaths.has(path)))) continue;
    const evidence = filesComplete ? "完整扫描未发现该文件" : "仓库扫描不完整，无法确认该文件是否存在";
    contextGaps.push(`文件 ${path} 的计划动作 ${operation.action} 缺少存在性证据：${evidence}。`);
    stopConditions.push(`生成 Patch 前必须重新确认 ${path} 是否存在及其操作类型。`);
  }
  return { contextGaps, stopConditions };
}

/** 统一模型可能返回的 Windows 分隔符与显式当前目录前缀。 */
function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
