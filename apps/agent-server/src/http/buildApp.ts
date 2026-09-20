/** 装配本地服务锁、Codex 会话、规则文件和通信路由。 */
import Fastify from "fastify";
import { resolveRuntimeDirectory } from "../runtime/runtimeDirectory.js";
import { ServerInstanceLock } from "../runtime/serverInstanceLock.js";
import { SessionService } from "../sessions/sessionService.js";
import { InstructionService } from "../instructions/instructionService.js";
import { CommunicationRequestHandler } from "./communicationRequestHandler.js";
import { CommunicationStreamRequestHandler } from "./communicationStreamRequestHandler.js";
import { registerCommunicationRoute } from "./registerCommunicationRoute.js";
import { registerHealthRoute } from "./registerHealthRoute.js";
import { SessionFileService } from "../files/sessionFileService.js";
import { registerSessionFileRoute } from "./registerSessionFileRoute.js";
import { isLoopbackHttpUrl } from "../runtime/serverHostPolicy.js";

/** 可注入的单实例生命周期端口。 */
export interface AgentServerInstanceLock {
  /** 取得当前运行目录所有权。 */
  acquire(): Promise<void>;
  /** 释放本实例持有的锁。 */
  release(): Promise<void>;
}
/** 嵌入和测试可替换服务依赖。 */
export interface BuildAppOptions {
  sessionService?: SessionService;
  instructionService?: InstructionService;
  instanceLock?: AgentServerInstanceLock | false;
  runtimeDirectory?: string;
}
/** 创建服务，取得锁后才读取索引；关闭时先回收进程再释放锁。 */
export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ bodyLimit: 32 * 1024 * 1024, logger: process.env.NODE_ENV !== "test" });
  const directory =
    options.runtimeDirectory ?? resolveRuntimeDirectory(process.env.UI_FORGE_RUNTIME_DIR);
  const lock =
    options.instanceLock === false
      ? undefined
      : (options.instanceLock ?? new ServerInstanceLock(directory));
  const sessions = options.sessionService ?? new SessionService({ directory });
  const instructions = options.instructionService ?? new InstructionService();
  const files = new SessionFileService(sessions.index, directory);
  app.addHook("onReady", async () => {
    await lock?.acquire();
    try {
      await sessions.initialize();
    } catch (error) {
      await sessions.close();
      await lock?.release();
      throw error;
    }
  });
  app.addHook("preClose", async () => {
    await sessions.close();
  });
  app.addHook("onClose", async () => {
    await lock?.release();
  });
  app.addHook("onRequest", async (request, reply) => {
    if (
      !isLoopbackHttpUrl(`http://${request.headers.host ?? "localhost"}`) ||
      (request.headers.origin && !isLoopbackHttpUrl(request.headers.origin))
    ) {
      return reply.code(403).send({ message: "仅允许本机客户端访问。" });
    }
  });
  registerHealthRoute(app);
  registerCommunicationRoute(
    app,
    new CommunicationRequestHandler(sessions, instructions, files),
    new CommunicationStreamRequestHandler(sessions),
  );
  registerSessionFileRoute(app, files);
  return app;
}
