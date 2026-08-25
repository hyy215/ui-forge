/** 组装 Agent Server 的 Fastify 实例、健康检查和统一通信路由。 */

import Fastify from "fastify";
import { resolve } from "node:path";
import { createD2CWorkflowServiceFromEnvironment } from "../d2c/createD2CWorkflowService.js";
import type { D2CWorkflowService } from "../d2c/d2cWorkflowService.js";
import {
  WorkspaceRequestLogger,
  type CommunicationRequestLogger,
} from "../logging/workspaceRequestLogger.js";
import { ServerInstanceLock } from "../runtime/serverInstanceLock.js";
import { CommunicationRequestHandler } from "./communicationRequestHandler.js";
import { CommunicationStreamRequestHandler } from "./communicationStreamRequestHandler.js";
import { registerCommunicationRoute } from "./registerCommunicationRoute.js";
import { registerHealthRoute } from "./registerHealthRoute.js";

/** Server 生命周期使用的最小单实例所有权端口。 */
export interface AgentServerInstanceLock {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

/** 创建 Agent Server 时允许注入的运行时依赖。 */
export interface BuildAppOptions {
  d2cWorkflowService?: D2CWorkflowService;
  requestLogger?: CommunicationRequestLogger | false;
  instanceLock?: AgentServerInstanceLock | false;
  logRootDirectory?: string;
}

/** 创建包含健康检查和统一通信端点的 Fastify 应用。 */
export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const requestLogger = options.requestLogger === false
    ? undefined
    : options.requestLogger ?? (process.env.NODE_ENV === "test" ? undefined : new WorkspaceRequestLogger({
      rootDirectory: options.logRootDirectory
        ?? process.env.UI_FORGE_LOG_DIR
        ?? resolve(process.cwd(), ".ui-forge", "logs"),
      retentionMs: readLogRetentionMs(),
      onError: () => app.log.warn("Workspace request log could not be persisted."),
    }));
  const instanceLock = options.instanceLock === false
    ? undefined
    : options.instanceLock ?? (process.env.NODE_ENV === "test" ? undefined : new ServerInstanceLock(
      process.env.UI_FORGE_RUNTIME_DIR
        ?? resolve(process.cwd(), ".ui-forge", "runtime"),
    ));
  const d2cWorkflowService = options.d2cWorkflowService ?? createD2CWorkflowServiceFromEnvironment({
    ...(requestLogger?.recordModelInvocation
      ? { modelDiagnosticReporter: (event) => requestLogger.recordModelInvocation!(event) }
      : {}),
  });
  const requestHandler = new CommunicationRequestHandler({
    workflowService: d2cWorkflowService,
    ...(requestLogger ? { requestLogger } : {}),
  });
  const streamRequestHandler = new CommunicationStreamRequestHandler({
    workflowService: d2cWorkflowService,
    ...(requestLogger ? { requestLogger } : {}),
  });

  app.addHook("onReady", async () => {
    await instanceLock?.acquire();
    try {
      await d2cWorkflowService.initialize();
      await requestLogger?.initialize?.();
    } catch (error: unknown) {
      await instanceLock?.release();
      throw error;
    }
  });
  app.addHook("onClose", async () => {
    try {
      await requestLogger?.dispose?.();
      await d2cWorkflowService.dispose();
    } finally {
      await instanceLock?.release();
    }
  });

  registerHealthRoute(app);
  registerCommunicationRoute(app, requestHandler, streamRequestHandler);

  return app;
}

/** 将日志保留天数配置转换为毫秒，并拒绝无效环境输入。 */
function readLogRetentionMs(): number {
  const configured = process.env.UI_FORGE_LOG_RETENTION_DAYS?.trim();
  if (!configured) return 90 * 24 * 60 * 60_000;
  const days = Number(configured);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error("UI_FORGE_LOG_RETENTION_DAYS 必须是非负数值。");
  }
  return days * 24 * 60 * 60_000;
}
