/** ui-forge 的 Codex 原生接入入口；实际工具执行由 Codex 完成。 */
export {
  CodexClient,
  type CodexClientOptions,
  type CodexEvent,
  type CodexMethod,
  type PendingRequest,
} from "./codexClient.js";
export { CodexProcessError, CodexRpcError, CodexTimeoutError } from "./errors.js";
export { resolveCodexExecutable, explainCodexStartupError } from "./runtime/executable.js";
export { checkCodexVersion } from "./version.js";
export { codexProtocolVersion } from "./protocol.js";
export { deliveryContext, deliveryReportPath } from "./deliveryContext.js";
export type {
  NativeMethods,
  NativeReplies,
  ServerNotification,
  ServerRequest,
} from "./generated/native.js";
export type { D2COptions, PreparedD2C } from "./d2c.js";
export type { D2CRuntimeOptions, PreparedD2CRuntime } from "./d2cRuntime.js";
export {
  checkVibeConnection,
  checkMagicConnection,
  type DesignConnectionInfo,
} from "./design/connections.js";
export { parseMasterGoTarget, type VibeConnection, type VibeTarget } from "./design/boundaries.js";
export {
  startVibeReadOnlyBridge,
  type VibeReadOnlyBridge,
  type VibeReadOnlyBridgeOptions,
} from "./design/vibeReadOnlyBridge.js";
export {
  prepareTemporaryWorkspace,
  temporaryWorkspacePath,
  temporaryWorkspacePathForCanonicalCwd,
  temporaryWorkspaceContext,
} from "./temporaryWorkspace.js";
export {
  instructionPath,
  readInstructions,
  saveInstructions,
  type InstructionKind,
} from "./instructions.js";
