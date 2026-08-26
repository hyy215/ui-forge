/** 将版本化 Plan、受控源码快照和 Code Agent 封装为可暂停恢复的 Graph 节点。 */

import type { CodeGenerationAgent } from "../../../code-generation/codeGenerationAgent.js";
import type { CodeGenerationOutcome } from "../../../code-generation/codePatch.js";
import type { ProjectCodeContextReader } from "../../../code-generation/projectCodeContext.js";
import type { CodeGenerationProgressReporter } from "../../../code-generation/codeGenerationProgress.js";
import type { ProjectContextAnalyzer } from "../../../project-context/projectContextAnalysis.js";
import type { D2CGraphState } from "../../d2cGraphState.js";
import { dirname, join, normalize } from "node:path/posix";

/** 代码生成节点的稳定标识。 */
export const generateCodeNodeId = "generateCode";

/** 携带可持久化阻塞结论，同时让 Graph 保留在代码生成节点前供用户重试。 */
export class CodeGenerationBlockedError extends Error {
  /** 保存已裁剪的业务阻塞原因，不包含内部异常对象。 */
  constructor(readonly outcome: Extract<CodeGenerationOutcome, { status: "blocked" }>) {
    super(outcome.summary);
    this.name = "CodeGenerationBlockedError";
  }
}

/** 创建只从权威任务和受控端口读取代码上下文的 Graph 节点。 */
export function createGenerateCodeNode(
  codeAgent: CodeGenerationAgent,
  contextReader: ProjectCodeContextReader,
  projectContextAnalyzer: ProjectContextAnalyzer,
  resolveProgress: (taskId: string) => CodeGenerationProgressReporter | undefined,
  resolveSignal: (taskId: string) => AbortSignal | undefined,
) {
  return {
    id: generateCodeNodeId,
    execute: async (state: D2CGraphState): Promise<Partial<D2CGraphState>> => {
      const task = state.task;
      if (!task?.inspectedDesign || !task.projectInspection || task.projectInspection.kind === "unsupported"
        || !task.componentRecognition || !task.evolvingPlan || !task.planApproval
        || task.planApproval.planVersion !== task.evolvingPlan.planVersion
        || task.planApproval.planHash !== task.evolvingPlan.planHash) {
        throw new Error("代码生成节点缺少已批准 Plan 或前置设计、项目与组件结果。");
      }
      const signal = resolveSignal(task.taskId);
      throwIfAborted(signal);
      const progress = resolveProgress(task.taskId);
      const plannedPaths = task.evolvingPlan.execution.files;
      await progress?.({ type: "code-context-start", fileCount: plannedPaths.length });
      const contextStartedAt = performance.now();
      const projectContext = await projectContextAnalyzer.analyze({
        inspection: structuredClone(task.projectInspection),
        recognition: structuredClone(task.componentRecognition),
        ...(signal ? { signal } : {}),
      });
      const selectedRepositoryIds = new Set(task.evolvingPlan.execution.componentDecisions
        .flatMap((decision) => decision.repositoryComponentId ? [decision.repositoryComponentId] : []));
      const selectedMatches = projectContext.matches.filter((match) => selectedRepositoryIds.has(match.component.id));
      const missingRepositoryIds = [...selectedRepositoryIds].filter(
        (id) => !selectedMatches.some((match) => match.component.id === id),
      );
      if (missingRepositoryIds.length > 0) {
        throw blocked("计划引用的仓库组件已经变化。", missingRepositoryIds.map((id) => `无法重新确认仓库组件：${id}`));
      }
      const referencePaths = selectedMatches.flatMap((match) => [
        match.component.sourcePath,
        ...match.component.styleFiles.flatMap((stylePath) => resolveStyleReference(
          match.component.sourcePath,
          stylePath,
        )),
      ]);
      let codeContext;
      try {
        codeContext = await contextReader.read({
          inspection: structuredClone(task.projectInspection),
          plannedPaths,
          referencePaths,
          ...(signal ? { signal } : {}),
        });
        validateInitialFileStates(task.evolvingPlan.execution.steps, codeContext.files);
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        const reason = error instanceof Error ? error.message : "无法读取计划文件。";
        throw blocked("代码生成前的文件版本检查未通过。", [reason]);
      }
      await progress?.({
        type: "code-context-complete",
        fileCount: codeContext.files.length,
        warningCount: codeContext.warnings.length,
        durationMs: elapsedMilliseconds(contextStartedAt),
      });
      await progress?.({
        type: "code-generation-start",
        stepCount: task.evolvingPlan.execution.steps.filter((step) => step.files.length > 0).length,
      });
      const generationStartedAt = performance.now();
      const result = await codeAgent.generate({
        taskId: task.taskId,
        taskGoal: task.taskGoal,
        inspection: structuredClone(task.inspectedDesign),
        projectInspection: structuredClone(task.projectInspection),
        recognition: structuredClone(task.componentRecognition),
        plan: structuredClone(task.evolvingPlan),
        projectContext,
        codeContext,
        ...(signal ? { signal } : {}),
      });
      await progress?.({
        type: "code-generation-complete",
        outcome: structuredClone(result.outcome),
        durationMs: elapsedMilliseconds(generationStartedAt),
        ...(result.usage ? { tokenUsage: result.usage } : {}),
      });
      if (result.outcome.status === "blocked") throw new CodeGenerationBlockedError(result.outcome);
      return {
        execution: {
          codeGeneration: structuredClone(result.outcome),
          evolvingPlan: structuredClone(result.plan),
        },
      };
    },
  };
}

/** 将组件内部相对样式导入解析为项目根目录相对路径，忽略包级样式。 */
function resolveStyleReference(sourcePath: string, stylePath: string): string[] {
  if (!stylePath.startsWith(".")) return [];
  const resolved = normalize(join(dirname(sourcePath), stylePath));
  return resolved === ".." || resolved.startsWith("../") ? [] : [resolved];
}

/** 确认首个计划文件动作与生成前真实存在性一致。 */
function validateInitialFileStates(
  steps: ReadonlyArray<{ files: ReadonlyArray<{ path: string; action: "create" | "modify" | "delete" }> }>,
  files: ReadonlyArray<{ path: string; role: "planned" | "reference"; status: "existing" | "missing" }>,
): void {
  const firstAction = new Map<string, "create" | "modify" | "delete">();
  for (const operation of steps.flatMap((step) => step.files)) {
    if (!firstAction.has(operation.path)) firstAction.set(operation.path, operation.action);
  }
  const snapshots = new Map(files.filter((file) => file.role === "planned").map((file) => [file.path, file.status]));
  for (const [path, action] of firstAction) {
    const status = snapshots.get(path);
    if (!status) throw new Error(`缺少计划文件快照：${path}`);
    if (action === "create" && status !== "missing") throw new Error(`计划新建文件已经存在：${path}`);
    if (action !== "create" && status !== "existing") throw new Error(`计划操作的现有文件已经不存在：${path}`);
  }
}

/** 创建稳定的业务阻塞异常。 */
function blocked(summary: string, reasons: string[]): CodeGenerationBlockedError {
  return new CodeGenerationBlockedError({ status: "blocked", summary, reasons, warnings: [] });
}

/** 判断异常是否来自显式取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 在耗时节点边界传播用户取消。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("代码生成已由用户终止。", "AbortError");
}

/** 将高精度耗时转换为非负整数毫秒。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
