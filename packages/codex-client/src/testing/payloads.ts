/** 原生协议测试样本；仅用于连接测试，不模拟业务流程。 */
import type { NativeMethods, ServerRequest } from "../generated/native.js";

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
