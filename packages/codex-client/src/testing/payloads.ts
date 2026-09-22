/** 原生协议测试样本；仅用于连接测试，不模拟业务流程。 */
import type { NativeMethods, ServerNotification, ServerRequest } from "../generated/native.js";

/** 一个尚未执行轮次的原生线程。 */
export const thread = {
  id: "thread-1",
  extra: null,
  sessionId: "session-1",
  forkedFromId: null,
  parentThreadId: null,
  preview: "",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: "legacy",
  modelProvider: "openai",
  model: "fixture-model",
  reasoningEffort: null,
  createdAt: 0,
  updatedAt: 0,
  recencyAt: null,
  status: { type: "idle" },
  path: null,
  cwd: "/fixture",
  cliVersion: "0.153.4",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns: [],
} satisfies NativeMethods["thread/read"]["result"]["thread"];

/** 原生线程创建响应。 */
export const startResponse = {
  thread,
  model: "fixture-model",
  modelProvider: "openai",
  serviceTier: null,
  cwd: "/fixture",
  runtimeWorkspaceRoots: [],
  instructionSources: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: {
    type: "workspaceWrite",
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  activePermissionProfile: null,
  reasoningEffort: null,
  multiAgentMode: "explicitRequestOnly",
} satisfies NativeMethods["thread/start"]["result"];

/** 原生轮次响应。 */
export const turn = {
  id: "turn-1",
  items: [],
  itemsView: "full",
  status: "inProgress",
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
} satisfies NativeMethods["turn/start"]["result"]["turn"];

/** 原生命令审批请求。 */
export const approval = {
  id: "approval-1",
  method: "item/commandExecution/requestApproval",
  params: {
    kind: "command",
    threadId: thread.id,
    turnId: turn.id,
    itemId: "item-1",
    startedAtMs: 0,
    environmentId: null,
    command: "npm test",
    cwd: "/fixture",
  },
} satisfies ServerRequest;

const completedCommand = {
  type: "commandExecution",
  id: "capacity-command",
  pluginId: null,
  scriptPath: null,
  command: "npm test",
  cwd: thread.cwd,
  processId: null,
  source: "agent",
  status: "completed",
  commandActions: [],
  aggregatedOutput: "Checks passed before capacity failure.\n",
  exitCode: 0,
  durationMs: 100,
} satisfies NativeMethods["turn/start"]["result"]["turn"]["items"][number];
const capacityError = {
  message: "Selected model is at capacity. Please try a different model.",
  codexErrorInfo: "serverOverloaded",
  additionalDetails: null,
  misalignment: null,
} satisfies NonNullable<NativeMethods["turn/start"]["result"]["turn"]["error"]>;
const activeCapacityTurn = {
  ...turn,
  items: [completedCommand],
} satisfies NativeMethods["turn/start"]["result"]["turn"];
const failedCapacityTurn = {
  ...activeCapacityTurn,
  status: "failed",
  error: capacityError,
} satisfies NativeMethods["turn/start"]["result"]["turn"];
const continuedCapacityTurn = {
  ...turn,
  id: "turn-after-capacity",
} satisfies NativeMethods["turn/start"]["result"]["turn"];

/** 固定原生消息序列：保留已有输出，经过服务重试与失败，再由测试显式请求下一轮。 */
export const capacityFailureScenario = {
  activeTurn: activeCapacityTurn,
  failedTurn: failedCapacityTurn,
  continuedTurn: continuedCapacityTurn,
  retrying: [
    {
      method: "thread/status/changed",
      params: { threadId: thread.id, status: { type: "active", activeFlags: [] } },
    },
    { method: "turn/started", params: { threadId: thread.id, turn } },
    {
      method: "item/completed",
      params: { threadId: thread.id, turnId: turn.id, item: completedCommand, completedAtMs: 100 },
    },
    {
      method: "error",
      params: { threadId: thread.id, turnId: turn.id, error: capacityError, willRetry: true },
    },
  ] satisfies ServerNotification[],
  failed: [
    {
      method: "error",
      params: { threadId: thread.id, turnId: turn.id, error: capacityError, willRetry: false },
    },
    {
      method: "turn/completed",
      params: { threadId: thread.id, turn: failedCapacityTurn },
    },
    { method: "thread/status/changed", params: { threadId: thread.id, status: { type: "idle" } } },
  ] satisfies ServerNotification[],
  continued: [
    {
      method: "thread/status/changed",
      params: { threadId: thread.id, status: { type: "active", activeFlags: [] } },
    },
    { method: "turn/started", params: { threadId: thread.id, turn: continuedCapacityTurn } },
  ] satisfies ServerNotification[],
};
