/** 校验第一方操作并交给会话或配置服务，保留请求标识。 */
import {
  createSessionSchema,
  sessionIdSchema,
  sendSessionInputSchema,
  stopSessionSchema,
  respondSessionSchema,
  listSessionsSchema,
  sessionMethods,
  instructionMethods,
  readInstructionSchema,
  saveInstructionSchema,
  sessionFileMethods,
  sessionFileInputSchema,
  createSuccessfulCommunicationResponseMessage,
  createFailedCommunicationResponseMessage,
  type CommunicationRequestMessage,
  type CommunicationResponseMessage,
} from "@ui-forge/shared-protocol";
import type { SessionService } from "../sessions/sessionService.js";
import type { InstructionService } from "../instructions/instructionService.js";
import type { SessionFileService } from "../files/sessionFileService.js";

/** 请求适配器不启动进程、不执行工具，也不重写审批决议。 */
export class CommunicationRequestHandler {
  /** 注入共享会话和真实文件服务。 */
  constructor(
    private readonly sessions: SessionService,
    private readonly instructions: InstructionService,
    private readonly files: SessionFileService,
  ) {}
  /** 统一包装成功与错误，避免向客户端返回异常堆栈。 */
  async handle(message: CommunicationRequestMessage): Promise<CommunicationResponseMessage> {
    try {
      return createSuccessfulCommunicationResponseMessage(
        message.requestId,
        await this.dispatch(message),
      );
    } catch (error) {
      return createFailedCommunicationResponseMessage(
        message.requestId,
        error instanceof Error ? error.message : "请求失败。",
      );
    }
  }
  /** 每个操作在进入服务之前执行对应的边界校验。 */
  private async dispatch({ method, params }: CommunicationRequestMessage): Promise<unknown> {
    switch (method) {
      case sessionMethods.create:
        return this.sessions.create(createSessionSchema.parse(params));
      case sessionMethods.read:
        return this.sessions.read(sessionIdSchema.parse(params).taskId);
      case sessionMethods.list: {
        const input = listSessionsSchema.parse(params);
        return this.sessions.index.list(input.offset, input.projectPath);
      }
      case sessionMethods.status:
        return this.sessions.status();
      case sessionMethods.send: {
        const input = sendSessionInputSchema.parse(params);
        await this.sessions.send(input.taskId, input.text, input.images, input.startOnlyIfIdle);
        break;
      }
      case sessionMethods.stop: {
        const input = stopSessionSchema.parse(params);
        await this.sessions.stop(input.taskId, input.turnId);
        break;
      }
      case sessionMethods.respond: {
        const input = respondSessionSchema.parse(params);
        await this.sessions.respond(input.taskId, input.token, input.result);
        break;
      }
      case instructionMethods.read:
        return this.instructions.read(readInstructionSchema.parse(params).kind);
      case sessionFileMethods.open:
        return this.files.resolve(sessionFileInputSchema.parse(params));
      case instructionMethods.save: {
        const input = saveInstructionSchema.parse(params);
        return this.instructions.save(input.kind, input.content, input.revision);
      }
      default:
        throw new Error(`不支持的操作：${method}`);
    }
    return { accepted: true };
  }
}
