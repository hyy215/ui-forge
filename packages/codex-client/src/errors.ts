/** 保留 Codex 原生 RPC 错误，供宿主展示和处理。 */

/** Codex 返回的错误；不推断任务状态或自动重试。 */
export class CodexRpcError extends Error {
  /** Codex 原生错误码。 */
  readonly code: number;
  /** Codex 附带的错误数据，使用前由调用方收窄。 */
  readonly data: unknown;

  /** 保留服务端消息、错误码和数据。 */
  constructor(error: { code: number; message: string; data?: unknown }) {
    super(error.message);
    this.name = "CodexRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

/** RPC 等待超时；不表示任务失败，requestId 可关联后续 lateResponse 事件。 */
export class CodexTimeoutError extends Error {
  /** 本连接内的原生请求 ID。 */
  readonly requestId: number;
  /** 超时的原生方法。 */
  readonly method: string;
  /** 本次等待的上限。 */
  readonly timeoutMs: number;
  /** 执行结果需要通过迟到响应或原生查询确认。 */
  readonly executionStatus = "unknown";

  /** 保存请求关联信息，不保留包含用户内容的请求参数。 */
  constructor(requestId: number, method: string, timeoutMs: number) {
    super(`Codex request timed out: ${method}; execution may still be running`);
    this.name = "CodexTimeoutError";
    this.requestId = requestId;
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** Codex 进程退出错误，附带限长并脱敏的 stderr 诊断。 */
export class CodexProcessError extends Error {
  /** 操作系统退出码；由信号终止时可能为空。 */
  readonly exitCode: number | null;
  /** 终止进程的信号；正常退出时为空。 */
  readonly signal: NodeJS.Signals | null;
  /** 已脱敏的日志尾部，不包含完整配置或环境变量快照。 */
  readonly diagnostics: string;

  /** 组合可展示的退出原因与诊断信息。 */
  constructor(exitCode: number | null, signal: NodeJS.Signals | null, diagnostics: string) {
    super(`Codex process exited (${signal ?? exitCode})${diagnostics ? `\n${diagnostics}` : ""}`);
    this.name = "CodexProcessError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.diagnostics = diagnostics;
  }
}
