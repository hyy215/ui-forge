/** 将共享通信协议命令分发到 D2C Agent，并返回面向客户端的快照投影。 */

import type { D2CAgent } from "@ui-forge/d2c-agent";
import {
  cancelD2CConversationInputSchema,
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
} from "@ui-forge/shared-protocol";
import { D2CConversationRunner } from "./d2cConversationRunner.js";
import { D2CDesignDataQueryService } from "./d2cDesignDataQueryService.js";
import { toD2CWorkflowSnapshot } from "./d2cSnapshotPresenter.js";
import { D2CCodeGenerationRunner } from "./d2cCodeGenerationRunner.js";

/** 配置 D2C 通信服务的领域命令、查询和宿主资源生命周期。 */
export interface D2CWorkflowServiceOptions {
  /** 领域服务拥有确认规则、revision 校验和状态持久化；Server 只负责协议适配。 */
  service: D2CAgent.Service;
  designProvider: string;
  designArtifactReader?: D2CAgent.DesignArtifactReader;
  resolveWorkspaceId?: (projectPath: string) => Promise<string>;
  initialize?: () => Promise<void>;
  dispose?: () => Promise<void>;
}

/** D2C 通信服务能够返回的快照或按需设计数据。 */
export type D2CWorkflowResult = D2CWorkflowSnapshot | DesignDataIndex | DesignDataSection
  | CancelD2CConversationResult | CancelD2CCodeGenerationResult;

/** 只负责资源入口、Schema 校验和方法到应用操作的分发。 */
export class D2CWorkflowService {
  private readonly service: D2CAgent.Service;
  private readonly designProvider: string;
  private readonly resolveWorkspaceId: ((projectPath: string) => Promise<string>) | undefined;
  private readonly initializeResources: (() => Promise<void>) | undefined;
  private readonly disposeResources: (() => Promise<void>) | undefined;
  private readonly designDataQueries: D2CDesignDataQueryService;
  private readonly conversationRunner: D2CConversationRunner;
  private readonly codeGenerationRunner: D2CCodeGenerationRunner;
  private initialization: Promise<void> | undefined;

  /** 装配协议门面、查询服务以及两个互相隔离的长流 Runner。 */
  constructor(options: D2CWorkflowServiceOptions) {
    this.service = options.service;
    this.designProvider = options.designProvider;
    this.resolveWorkspaceId = options.resolveWorkspaceId;
    this.initializeResources = options.initialize;
    this.disposeResources = options.dispose;
    this.designDataQueries = new D2CDesignDataQueryService({
      service: options.service,
      ...(options.designArtifactReader ? { designArtifactReader: options.designArtifactReader } : {}),
    });
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
      case d2cWorkflowMethods.getSnapshot: {
        const input = getD2CWorkflowSnapshotInputSchema.parse(params);
        task = await this.service.getTask(input.taskId);
        break;
      }
      case d2cWorkflowMethods.getDesignDataIndex: {
        const input = getDesignDataIndexInputSchema.parse(params);
        return this.designDataQueries.getIndex(input.taskId, input.artifactId);
      }
      case d2cWorkflowMethods.getDesignDataSection: {
        const input = getDesignDataSectionInputSchema.parse(params);
        return this.designDataQueries.getSection(input.taskId, input.artifactId, input.sectionIndex);
      }
      case d2cWorkflowMethods.cancelConversation: {
        const input = cancelD2CConversationInputSchema.parse(params);
        return { cancelled: this.conversationRunner.cancel(input.taskId) };
      }
      case d2cWorkflowMethods.cancelCodeGeneration: {
        const input = cancelD2CCodeGenerationInputSchema.parse(params);
        return { cancelled: this.codeGenerationRunner.cancel(input.taskId) };
      }
      case d2cWorkflowMethods.inspectDesign: {
        const input = inspectD2CDesignInputSchema.parse(params);
        task = await this.service.inspectDesign({
          taskId: input.taskId,
          expectedRevision: input.expectedRevision,
          source: { provider: this.designProvider, reference: input.designUrl },
        });
        break;
      }
      case d2cWorkflowMethods.confirmDesign: {
        const input = confirmD2CDesignInputSchema.parse(params);
        task = await this.service.confirmDesign(input);
        break;
      }
      case d2cWorkflowMethods.reset:
        task = await this.service.reset(d2cTaskCommandInputSchema.parse(params));
        break;
      default:
        throw new Error(`不支持的 D2C 通信方法：${method}`);
    }
    return toD2CWorkflowSnapshot(task);
  }

  /** 委托 Conversation Runner 执行长流分析。 */
  async *stream(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationStreamEvent | CodeGenerationStreamEvent> {
    await this.initialize();
    if (method === d2cWorkflowMethods.streamConversation) {
      yield* this.conversationRunner.stream(method, params, signal);
      return;
    }
    if (method === d2cWorkflowMethods.streamCodeGeneration) {
      yield* this.codeGenerationRunner.stream(method, params, signal);
      return;
    }
    throw new Error(`不支持的 D2C 流式通信方法：${method}`);
  }
}
