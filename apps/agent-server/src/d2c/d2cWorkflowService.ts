/** 将共享通信协议命令分发到 D2C Agent，并返回面向客户端的快照投影。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import {
  cancelD2CConversationInputSchema,
  approveD2CDeliveryCommandsInputSchema,
  approveD2CPlanInputSchema,
  confirmD2CDesignInputSchema,
  d2cTaskCommandInputSchema,
  d2cWorkflowMethods,
  getDesignDataIndexInputSchema,
  getDesignDataSectionInputSchema,
  getD2CWorkflowSnapshotInputSchema,
  initializeD2CWorkflowInputSchema,
  inspectD2CDesignInputSchema,
  type CancelD2CConversationResult,
  type ConversationStreamEvent,
  type D2CWorkflowSnapshot,
  type DesignDataIndex,
  type DesignDataSection,
  cancelD2CCodeGenerationInputSchema,
  type CancelD2CCodeGenerationResult,
  type CodeGenerationStreamEvent,
  deliveryEvidenceImageSchema,
  getDeliveryEvidenceInputSchema,
  type DeliveryEvidenceImage,
  changeD2CTaskArchiveInputSchema,
  deleteD2CTaskInputSchema,
  deleteD2CTaskResultSchema,
  d2cTaskSummaryPageSchema,
  listD2CTasksInputSchema,
  renameD2CTaskInputSchema,
  streamD2CCodeGenerationInputSchema,
  streamD2CConversationInputSchema,
  type D2CTaskSummaryPage,
  type DeleteD2CTaskResult,
} from "@ui-forge/shared-protocol";
import { D2CConversationRunner } from "./d2cConversationRunner.js";
import { D2CDesignDataQueryService } from "./d2cDesignDataQueryService.js";
import { toD2CWorkflowSnapshot } from "./d2cSnapshotPresenter.js";
import { D2CCodeGenerationRunner } from "./d2cCodeGenerationRunner.js";
import { D2CDeliveryEvidenceQueryService } from "./d2cDeliveryEvidenceQueryService.js";
import { D2CTaskListQueryService } from "./d2cTaskListQueryService.js";

/** 配置 D2C 通信服务的领域命令、查询和宿主资源生命周期。 */
export interface D2CWorkflowServiceOptions {
  /** 领域服务拥有确认规则、revision 校验和状态持久化；Server 只负责协议适配。 */
  service: D2CAgent.Service;
  designProvider: string;
  designArtifactReader?: D2CAgent.DesignArtifactReader;
  deliveryEvidenceStore?: D2CAgent.DeliveryEvidenceStore;
  commandAuditReporter?: (event: D2CAgent.DeliveryCommandAuditEvent) => void | Promise<void>;
  resolveWorkspaceId?: (projectPath: string) => Promise<string>;
  initialize?: () => Promise<void>;
  dispose?: () => Promise<void>;
}

/** D2C 通信服务能够返回的快照或按需设计数据。 */
export type D2CWorkflowResult = D2CWorkflowSnapshot | DesignDataIndex | DesignDataSection
  | DeliveryEvidenceImage | D2CTaskSummaryPage
  | CancelD2CConversationResult | CancelD2CCodeGenerationResult | DeleteD2CTaskResult;

/** 只负责资源入口、Schema 校验和方法到应用操作的分发。 */
export class D2CWorkflowService {
  private readonly service: D2CAgent.Service;
  private readonly designProvider: string;
  private readonly resolveWorkspaceId: ((projectPath: string) => Promise<string>) | undefined;
  private readonly initializeResources: (() => Promise<void>) | undefined;
  private readonly disposeResources: (() => Promise<void>) | undefined;
  private readonly designDataQueries: D2CDesignDataQueryService;
  private readonly deliveryEvidenceQueries: D2CDeliveryEvidenceQueryService;
  private readonly taskListQueries: D2CTaskListQueryService;
  private readonly conversationRunner: D2CConversationRunner;
  private readonly codeGenerationRunner: D2CCodeGenerationRunner;
  private readonly commandAuditReporter:
    | ((event: D2CAgent.DeliveryCommandAuditEvent) => void | Promise<void>)
    | undefined;
  private initialization: Promise<void> | undefined;

  /** 装配协议门面、查询服务以及两个互相隔离的长流 Runner。 */
  constructor(options: D2CWorkflowServiceOptions) {
    this.service = options.service;
    this.designProvider = options.designProvider;
    this.resolveWorkspaceId = options.resolveWorkspaceId;
    this.initializeResources = options.initialize;
    this.disposeResources = options.dispose;
    this.commandAuditReporter = options.commandAuditReporter;
    this.designDataQueries = new D2CDesignDataQueryService({
      service: options.service,
      ...(options.designArtifactReader ? { designArtifactReader: options.designArtifactReader } : {}),
    });
    this.deliveryEvidenceQueries = new D2CDeliveryEvidenceQueryService({
      service: options.service,
      ...(options.deliveryEvidenceStore
        ? { deliveryEvidenceStore: options.deliveryEvidenceStore }
        : {}),
    });
    this.taskListQueries = new D2CTaskListQueryService({ service: options.service });
    this.conversationRunner = new D2CConversationRunner({ service: options.service });
    this.codeGenerationRunner = new D2CCodeGenerationRunner(options.service);
  }

  /** 幂等初始化 Checkpointer 等异步运行时资源。 */
  initialize(): Promise<void> {
    this.initialization ??= this.initializeResources?.() ?? Promise.resolve();
    return this.initialization;
  }

  /** 关闭由组合入口创建的运行时资源。 */
  async dispose(): Promise<void> {
    await this.disposeResources?.();
  }

  /** 根据公共方法名校验请求参数并执行对应应用操作。 */
  async handle(method: string, params: unknown): Promise<D2CWorkflowResult> {
    await this.initialize();
    let task: D2CAgent.Task;
    switch (method) {
      case d2cWorkflowMethods.initialize: {
        const input = initializeD2CWorkflowInputSchema.parse(params ?? {});
        const projectPath = input.projectPath ?? "";
        const workspaceId = await this.resolveWorkspaceId?.(projectPath) ?? "unknown";
        task = await this.service.initialize({ ...input, workspaceId });
        break;
      }
      case d2cWorkflowMethods.listTasks: {
        const input = listD2CTasksInputSchema.parse(params ?? {});
        const workspaceId = await this.resolveWorkspace(input.projectPath);
        return d2cTaskSummaryPageSchema.parse(await this.taskListQueries.list({
          workspaceId,
          ...(input.includeArchived === true ? { includeArchived: true } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }));
      }
      case d2cWorkflowMethods.getSnapshot: {
        const input = getD2CWorkflowSnapshotInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        await this.assertWorkspaceAccess(task, input.projectPath);
        break;
      }
      case d2cWorkflowMethods.renameTask: {
        const input = renameD2CTaskInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        await this.assertWorkspaceAccess(task, input.projectPath);
        task = await this.service.renameTask({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          displayName: input.displayName,
        });
        break;
      }
      case d2cWorkflowMethods.archiveTask: {
        const input = changeD2CTaskArchiveInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        await this.assertWorkspaceAccess(task, input.projectPath);
        task = await this.service.archiveTask({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
        });
        break;
      }
      case d2cWorkflowMethods.restoreTask: {
        const input = changeD2CTaskArchiveInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        await this.assertWorkspaceAccess(task, input.projectPath);
        task = await this.service.restoreTask({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
        });
        break;
      }
      case d2cWorkflowMethods.deleteTask: {
        const input = deleteD2CTaskInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        this.conversationRunner.cancel(input.taskId);
        this.codeGenerationRunner.cancel(input.taskId);
        await this.service.deleteTask({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
        });
        return deleteD2CTaskResultSchema.parse({ taskId: input.taskId, deleted: true });
      }
      case d2cWorkflowMethods.getDesignDataIndex: {
        const input = getDesignDataIndexInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        return this.designDataQueries.getIndex(input.taskId, input.artifactId);
      }
      case d2cWorkflowMethods.getDesignDataSection: {
        const input = getDesignDataSectionInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        return this.designDataQueries.getSection(input.taskId, input.artifactId, input.sectionIndex);
      }
      case d2cWorkflowMethods.getDeliveryEvidence: {
        const input = getDeliveryEvidenceInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        return deliveryEvidenceImageSchema.parse(
          await this.deliveryEvidenceQueries.get(input.taskId, input.evidenceId),
        );
      }
      case d2cWorkflowMethods.cancelConversation: {
        const input = cancelD2CConversationInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        return { cancelled: this.conversationRunner.cancel(input.taskId) };
      }
      case d2cWorkflowMethods.cancelCodeGeneration: {
        const input = cancelD2CCodeGenerationInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        return { cancelled: this.codeGenerationRunner.cancel(input.taskId) };
      }
      case d2cWorkflowMethods.inspectDesign: {
        const input = inspectD2CDesignInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        task = await this.service.inspectDesign({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          source: { provider: this.designProvider, reference: input.designUrl },
        });
        break;
      }
      case d2cWorkflowMethods.confirmDesign: {
        const input = confirmD2CDesignInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        task = await this.service.confirmDesign(input);
        break;
      }
      case d2cWorkflowMethods.approvePlan: {
        const input = approveD2CPlanInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        task = await this.service.approvePlan(input);
        break;
      }
      case d2cWorkflowMethods.approveDeliveryCommands: {
        const input = approveD2CDeliveryCommandsInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        task = await this.service.approveDeliveryCommands(input);
        const plan = task.deliveryCommandPlan;
        if (plan?.status === "approval_required"
          && task.deliveryCommandApproval?.commandPlanHash === plan.commandPlanHash) {
          await this.reportCommandAuditSafely({
            type: "approved",
            taskId: task.taskId,
            commandPlanHash: plan.commandPlanHash,
            commands: structuredClone(plan.commands),
          });
        }
        break;
      }
      case d2cWorkflowMethods.reset: {
        const input = d2cTaskCommandInputSchema.parse(params);
        await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
        task = await this.service.reset(input);
        break;
      }
      default:
        throw new Error(`不支持的 D2C 通信方法：${method}`);
    }
    return toD2CWorkflowSnapshot(task);
  }

  /** 审计持久化失败不得撤销已经提交的领域批准。 */
  private async reportCommandAuditSafely(event: D2CAgent.DeliveryCommandAuditEvent): Promise<void> {
    try {
      await this.commandAuditReporter?.(event);
    } catch {
      // 日志是旁路证据；失败由宿主告警，不覆盖权威任务状态。
    }
  }

  /** 将宿主项目路径转换为稳定 Workspace 身份。 */
  private async resolveWorkspace(projectPath: string | undefined): Promise<string> {
    return await this.resolveWorkspaceId?.(projectPath ?? "") ?? "unknown";
  }

  /** 在宿主提供项目路径时拒绝跨 Workspace 打开或修改任务。 */
  private async assertWorkspaceAccess(
    task: D2CAgent.Task,
    projectPath: string | undefined,
  ): Promise<void> {
    if (!this.resolveWorkspaceId) return;
    const workspaceId = await this.resolveWorkspace(projectPath);
    if (task.workspaceId !== workspaceId) throw new Error("任务不属于当前 Workspace。");
  }

  /** 读取权威任务后执行统一 Workspace 所有权检查。 */
  private async assertTaskWorkspaceAccess(
    taskId: string,
    projectPath: string | undefined,
  ): Promise<void> {
    await this.assertWorkspaceAccess(await this.service.getTask(taskId), projectPath);
  }

  /** 委托 Conversation Runner 执行长流分析。 */
  async *stream(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationStreamEvent | CodeGenerationStreamEvent> {
    await this.initialize();
    if (method === d2cWorkflowMethods.streamConversation) {
      const input = streamD2CConversationInputSchema.parse(params);
      await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
      yield* this.conversationRunner.stream(method, input, signal);
      return;
    }
    if (method === d2cWorkflowMethods.streamCodeGeneration) {
      const input = streamD2CCodeGenerationInputSchema.parse(params);
      await this.assertTaskWorkspaceAccess(input.taskId, input.projectPath);
      yield* this.codeGenerationRunner.stream(method, input, signal);
      return;
    }
    throw new Error(`不支持的 D2C 流式通信方法：${method}`);
  }
}
