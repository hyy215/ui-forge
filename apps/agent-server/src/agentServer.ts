/** 作为 Agent Server 唯一公共入口，封装 Fastify 应用、监听和关闭生命周期。 */

import type {
  FastifyInstance,
  FastifyListenOptions,
} from "fastify";
import {
  buildApp,
  type BuildAppOptions,
} from "./http/buildApp.js";
import { normalizeLoopbackHost } from "./runtime/serverHostPolicy.js";

/** 提供可嵌入、可测试且不暴露内部目录聚合入口的 Agent Server Facade。 */
export class AgentServer {
  private readonly app: FastifyInstance;

  /** 使用显式依赖或默认运行时装配创建 Agent Server。 */
  constructor(options: AgentServer.Options = {}) {
    this.app = buildApp(options);
  }

  /** 暴露 Fastify 实例，供宿主集成、测试注入和日志访问。 */
  get application(): FastifyInstance {
    return this.app;
  }

  /** 启动 HTTP 监听并返回 Fastify 解析后的服务地址。 */
  async listen(options: AgentServer.ListenOptions): Promise<string> {
    return this.app.listen({
      ...options,
      host: normalizeLoopbackHost(options.host),
    });
  }

  /** 幂等关闭 Fastify 及其已注册资源。 */
  async close(): Promise<void> {
    await this.app.close();
  }
}

/** 为 AgentServer Facade 提供不产生额外运行时代码的公共类型命名空间。 */
export namespace AgentServer {
  /** 创建 Agent Server 时允许注入的运行时依赖。 */
  export type Options = BuildAppOptions;
  /** 启动 Fastify 监听所需配置。 */
  export type ListenOptions = FastifyListenOptions;
}
