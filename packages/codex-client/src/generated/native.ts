// Generated from Codex CLI 0.153.4. Run npm run generate:protocol -w @ui-forge/codex-client.
export type InitializeParams = { clientInfo: ClientInfo, capabilities: InitializeCapabilities | null, };
export type ClientInfo = { name: string, title: string | null, version: string, };
export type InitializeCapabilities = {
experimentalApi: boolean,
requestAttestation: boolean,
mcpServerOpenaiFormElicitation?: boolean,
optOutNotificationMethods?: Array<string> | null,
extensions?: { [key in string]?: serde_json_JsonValue } | null, };
export type serde_json_JsonValue = number | string | boolean | Array<serde_json_JsonValue> | { [key in string]?: serde_json_JsonValue } | null;
export type InitializeResponse = { userAgent: string,
codexHome: AbsolutePathBuf,
platformFamily: string,
platformOs: string, };
export type AbsolutePathBuf = string;
export type v2_ThreadStartParams = { model?: string | null, modelProvider?: string | null,
allowProviderModelFallback?: boolean, serviceTier?: string | null | null, cwd?: string | null,
runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null, approvalPolicy?: v2_AskForApproval | null,
approvalsReviewer?: v2_ApprovalsReviewer | null, sandbox?: v2_SandboxMode | null,
permissions?: string | null, config?: { [key in string]?: serde_json_JsonValue } | null, serviceName?: string | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null,
multiAgentMode?: MultiAgentMode | null, ephemeral?: boolean | null,
historyMode?: v2_ThreadHistoryMode | null, sessionStartSource?: v2_ThreadStartSource | null,
threadSource?: v2_ThreadSource | null,
projectId?: string | null,
environments?: Array<v2_TurnEnvironmentParams> | null, dynamicTools?: Array<v2_DynamicToolSpec> | null,
selectedCapabilityRoots?: Array<v2_SelectedCapabilityRoot> | null,
mockExperimentalField?: string | null,
experimentalRawEvents?: boolean, };
export type MultiAgentMode = { "custom": string } | "explicitRequestOnly" | "proactive";
export type Personality = "none" | "friendly" | "pragmatic";
export type v2_ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type v2_AskForApproval = "untrusted" | "on-request" | { "granular": { sandbox_approval: boolean, rules: boolean, skill_approval: boolean, request_permissions: boolean, mcp_elicitations: boolean, } } | "never";
export type v2_DynamicToolSpec = { "type": "function" } & v2_DynamicToolFunctionSpec | { "type": "namespace" } & v2_DynamicToolNamespaceSpec;
export type v2_DynamicToolFunctionSpec = { name: string, description: string, inputSchema: serde_json_JsonValue, deferLoading?: boolean, };
export type v2_DynamicToolNamespaceSpec = { name: string, description: string, tools: Array<v2_DynamicToolNamespaceTool>, };
export type v2_DynamicToolNamespaceTool = { "type": "function" } & v2_DynamicToolFunctionSpec;
export type v2_SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type v2_SelectedCapabilityRoot = {
id: string,
location: v2_CapabilityRootLocation, };
export type v2_CapabilityRootLocation = { "type": "environment", environmentId: string,
path: string, };
export type v2_ThreadHistoryMode = "legacy" | "paginated";
export type v2_ThreadSource = string;
export type v2_ThreadStartSource = "startup" | "clear";
export type v2_TurnEnvironmentParams = { environmentId: string, cwd: LegacyAppPathString,
runtimeWorkspaceRoots?: Array<LegacyAppPathString> | null, };
export type LegacyAppPathString = string;
export type v2_ThreadStartResponse = { thread: v2_Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf,
runtimeWorkspaceRoots: Array<AbsolutePathBuf>,
instructionSources: Array<LegacyAppPathString>, approvalPolicy: v2_AskForApproval,
approvalsReviewer: v2_ApprovalsReviewer,
sandbox: v2_SandboxPolicy,
activePermissionProfile: v2_ActivePermissionProfile | null, reasoningEffort: ReasoningEffort | null,
multiAgentMode: MultiAgentMode, };
export type ReasoningEffort = string;
export type v2_ActivePermissionProfile = {
id: string,
extends: string | null, };
export type v2_SandboxPolicy = { "type": "dangerFullAccess" } | { "type": "readOnly", networkAccess: boolean, } | { "type": "externalSandbox", networkAccess: v2_NetworkAccess, } | { "type": "workspaceWrite", writableRoots: Array<AbsolutePathBuf>, networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean, };
export type v2_NetworkAccess = "restricted" | "enabled";
export type v2_Thread = {
id: string,
extra: v2_ThreadExtra | null,
sessionId: string,
forkedFromId: string | null,
parentThreadId: string | null,
preview: string,
ephemeral: boolean,
section: v2_ThreadSection | null,
sectionEnteredAt: number | null,
projectId: string | null,
historyMode: v2_ThreadHistoryMode,
modelProvider: string,
model: string | null,
reasoningEffort: ReasoningEffort | null,
createdAt: number,
updatedAt: number,
recencyAt: number | null,
status: v2_ThreadStatus,
path: string | null,
cwd: AbsolutePathBuf,
cliVersion: string,
source: v2_SessionSource,
canAcceptDirectInput: boolean | null,
threadSource: v2_ThreadSource | null,
agentNickname: string | null,
agentRole: string | null,
gitInfo: v2_GitInfo | null,
name: string | null,
turns: Array<v2_Turn>, };
export type v2_GitInfo = { sha: string | null, branch: string | null, originUrl: string | null, };
export type v2_SessionSource = "cli" | "vscode" | "exec" | "appServer" | { "custom": string } | { "subAgent": SubAgentSource } | "unknown";
export type SubAgentSource = "review" | "compact" | { "thread_spawn": { parent_thread_id: ThreadId, depth: number, agent_path: AgentPath | null, agent_nickname: string | null, agent_role: string | null, } } | "memory_consolidation" | { "other": string };
export type AgentPath = string;
export type ThreadId = string;
export type v2_ThreadExtra = Record<string, never>;
export type v2_ThreadSection = {
id: string,
name: string,
appearance: v2_ThreadSectionAppearance | null, };
export type v2_ThreadSectionAppearance = { icon: string | null, color: string | null, };
export type v2_ThreadStatus = { "type": "notLoaded" } | { "type": "idle" } | { "type": "systemError" } | { "type": "active", activeFlags: Array<v2_ThreadActiveFlag>, };
export type v2_ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
export type v2_Turn = {
id: string,
items: Array<v2_ThreadItem>,
itemsView: v2_TurnItemsView, status: v2_TurnStatus,
error: v2_TurnError | null,
startedAt: number | null,
completedAt: number | null,
durationMs: number | null, };
export type v2_ThreadItem = { "type": "userMessage", id: string, clientId: string | null, content: Array<v2_UserInput>, } | { "type": "hookPrompt", id: string, fragments: Array<v2_HookPromptFragment>, } | { "type": "agentMessage", id: string, text: string, phase: MessagePhase | null, memoryCitation: v2_MemoryCitation | null, delivery: v2_AgentMessageDelivery | null, questions: Array<v2_AsyncUserInputQuestion> | null, } | { "type": "functionCallOutput", id: string, name: string, namespace: string | null, output: FunctionCallOutputBody, } | { "type": "plan", id: string, text: string, } | { "type": "reasoning", id: string, summary: Array<string>, content: Array<string>, } | { "type": "commandExecution", id: string,
pluginId: string | null,
scriptPath: string | null,
command: string,
cwd: LegacyAppPathString,
processId: string | null, source: v2_CommandExecutionSource, status: v2_CommandExecutionStatus,
commandActions: Array<v2_CommandAction>,
aggregatedOutput: string | null,
exitCode: number | null,
durationMs: number | null, } | { "type": "fileChange", id: string, changes: Array<v2_FileUpdateChange>, status: v2_PatchApplyStatus, } | { "type": "mcpToolCall", id: string, server: string, tool: string, status: v2_McpToolCallStatus, arguments: serde_json_JsonValue, appContext: v2_McpToolCallAppContext | null,
mcpAppResourceUri?: string, pluginId: string | null, readOnlyHint: boolean | null, result: v2_McpToolCallResult | null, error: v2_McpToolCallError | null,
durationMs: number | null, } | { "type": "dynamicToolCall", id: string, namespace: string | null, tool: string, arguments: serde_json_JsonValue, status: v2_DynamicToolCallStatus, contentItems: Array<v2_DynamicToolCallOutputContentItem> | null, success: boolean | null,
durationMs: number | null, } | { "type": "collabAgentToolCall",
id: string,
tool: v2_CollabAgentTool,
status: v2_CollabAgentToolCallStatus,
senderThreadId: string,
receiverThreadIds: Array<string>,
prompt: string | null,
model: string | null,
reasoningEffort: ReasoningEffort | null,
agentsStates: { [key in string]?: v2_CollabAgentState }, } | { "type": "subAgentActivity", id: string, kind: v2_SubAgentActivityKind, agentThreadId: string, agentPath: string, } | { "type": "webSearch" } & WebSearchItem | { "type": "imageView", id: string, path: LegacyAppPathString, } | { "type": "sleep" } & SleepItem | { "type": "imageGeneration" } & ImageGenerationItem | { "type": "enteredReviewMode", id: string, review: string, } | { "type": "exitedReviewMode", id: string, review: string, } | { "type": "contextCompaction", id: string, };
export type FunctionCallOutputBody = string | Array<FunctionCallOutputContentItem>;
export type FunctionCallOutputContentItem = { "type": "input_text", text: string, } | { "type": "input_image", image_url: string, detail?: ImageDetail, } | { "type": "input_audio", audio_url: string, } | { "type": "encrypted_content", encrypted_content: string, };
export type ImageDetail = "auto" | "low" | "high" | "original";
export type ImageGenerationItem = { id: string, status: string, revisedPrompt: string | null, result: string, transparentBackground?: boolean, failure: ImageGenerationFailure | null, savedPath?: AbsolutePathBuf, };
export type ImageGenerationFailure = { "type": "usageLimitExceeded", limitId: string, resetsAt: number | null, };
export type MessagePhase = "commentary" | "final_answer";
export type SleepItem = { id: string, durationMs: number, };
export type WebSearchItem = { id: string, query: string, action: v2_WebSearchAction | null,
results: Array<serde_json_JsonValue> | null, };
export type v2_WebSearchAction = { "type": "search", query: string | null, queries: Array<string> | null, } | { "type": "openPage", url: string | null, } | { "type": "findInPage", url: string | null, pattern: string | null, } | { "type": "other" };
export type v2_AgentMessageDelivery = "async";
export type v2_AsyncUserInputQuestion = { title: string, options: Array<string> | null, };
export type v2_CollabAgentState = { status: v2_CollabAgentStatus, message: string | null, };
export type v2_CollabAgentStatus = "pendingInit" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "notFound";
export type v2_CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent" | "sendMessage" | "followupTask" | "interruptAgent" | "listAgents";
export type v2_CollabAgentToolCallStatus = "inProgress" | "completed" | "failed" | "interrupted";
export type v2_CommandAction = { "type": "read", command: string, name: string, path: LegacyAppPathString, } | { "type": "listFiles", command: string, path: string | null, } | { "type": "search", command: string, query: string | null, path: string | null, } | { "type": "unknown", command: string, };
export type v2_CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";
export type v2_CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";
export type v2_DynamicToolCallOutputContentItem = { "type": "inputText", text: string, } | { "type": "inputImage", imageUrl: string, } | { "type": "inputAudio", audioUrl: string, };
export type v2_DynamicToolCallStatus = "inProgress" | "completed" | "failed";
export type v2_FileUpdateChange = { path: string, kind: v2_PatchChangeKind, diff: string, };
export type v2_PatchChangeKind = { "type": "add" } | { "type": "delete" } | { "type": "update", move_path: string | null, };
export type v2_HookPromptFragment = { text: string, hookRunId: string, };
export type v2_McpToolCallAppContext = { connectorId: string, linkId: string | null, resourceUri: string | null, appName: string | null, actionName: string | null, };
export type v2_McpToolCallError = { message: string, };
export type v2_McpToolCallResult = { content: Array<serde_json_JsonValue>, structuredContent: serde_json_JsonValue | null, _meta: serde_json_JsonValue | null, };
export type v2_McpToolCallStatus = "inProgress" | "completed" | "failed";
export type v2_MemoryCitation = { entries: Array<v2_MemoryCitationEntry>, threadIds: Array<string>, };
export type v2_MemoryCitationEntry = { path: string, lineStart: number, lineEnd: number, note: string, };
export type v2_PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";
export type v2_SubAgentActivityKind = "started" | "interacted" | "interrupted" | "completed";
export type v2_UserInput = { "type": "text", text: string,
text_elements: Array<v2_TextElement>, } | { "type": "image", detail?: ImageDetail, url: string, } | { "type": "localImage", detail?: ImageDetail, path: string, } | { "type": "audio", url: string, } | { "type": "localAudio", path: string, } | { "type": "skill", name: string, path: string, } | { "type": "mention", name: string, path: string, };
export type v2_TextElement = {
byteRange: v2_ByteRange,
placeholder: string | null, };
export type v2_ByteRange = { start: number, end: number, };
export type v2_TurnError = { message: string, codexErrorInfo: v2_CodexErrorInfo | null, additionalDetails: string | null,
misalignment: v2_MisalignmentErrorDetails | null, };
export type v2_CodexErrorInfo = "contextWindowExceeded" | "sessionBudgetExceeded" | "usageLimitExceeded" | "rateLimitExceeded" | "serverOverloaded" | "cyberPolicy" | "misalignmentPolicyViolation" | { "httpConnectionFailed": { httpStatusCode: number | null, } } | { "responseStreamConnectionFailed": { httpStatusCode: number | null, } } | "internalServerError" | "unauthorized" | "badRequest" | "threadRollbackFailed" | "sandboxError" | { "responseStreamDisconnected": { httpStatusCode: number | null, } } | { "responseTooManyFailedAttempts": { httpStatusCode: number | null, } } | { "activeTurnNotSteerable": { turnKind: v2_NonSteerableTurnKind, } } | "other";
export type v2_NonSteerableTurnKind = "review" | "compact";
export type v2_MisalignmentErrorDetails = {
errorType: string | null,
detailedExplanation: string | null,
steer: v2_MisalignmentSteer | null, };
export type v2_MisalignmentSteer = { message: string, };
export type v2_TurnItemsView = "notLoaded" | "summary" | "full";
export type v2_TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";
export type v2_ThreadResumeParams = { threadId: string,
history?: Array<ResponseItem> | null,
path?: string | null,
model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null,
runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null, approvalPolicy?: v2_AskForApproval | null,
approvalsReviewer?: v2_ApprovalsReviewer | null, sandbox?: v2_SandboxMode | null,
permissions?: string | null, config?: { [key in string]?: serde_json_JsonValue } | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null,
excludeTurns?: boolean,
initialTurnsPage?: v2_ThreadResumeInitialTurnsPageParams | null, };
export type ResponseItem = { "type": "message", id?: ResponseItemId, role: string, content: Array<ContentItem>, phase?: MessagePhase, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "agent_message", id?: ResponseItemId, author: string, recipient: string, content: Array<AgentMessageInputContent>, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "reasoning", id?: ResponseItemId, summary: Array<ReasoningItemReasoningSummary>, content?: Array<ReasoningItemContent>, encrypted_content: string | null, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "local_shell_call",
id?: ResponseItemId,
call_id: string | null, status: LocalShellStatus, action: LocalShellAction, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "function_call", id?: ResponseItemId, name: string, namespace?: string, arguments: string, encrypted_function_args?: Array<string>, call_id: string, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "tool_search_call", id?: ResponseItemId, call_id: string | null, status?: string, execution: string, arguments: unknown, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "function_call_output", id?: ResponseItemId, call_id?: string, name?: string, namespace?: string, output: FunctionCallOutputBody, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "custom_tool_call", id?: ResponseItemId, status?: string, call_id: string, name: string, namespace?: string, input: string, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "custom_tool_call_output", id?: ResponseItemId, call_id: string, name?: string, output: FunctionCallOutputBody, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "tool_search_output", id?: ResponseItemId, call_id: string | null, status: string, execution: string, tools: unknown[], internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "web_search_call", id?: ResponseItemId, status?: string, action?: WebSearchAction, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "image_generation_call", id?: ResponseItemId, status: string, revised_prompt?: string, result: string, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "compaction", id?: ResponseItemId, encrypted_content: string, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "compaction_trigger", } | { "type": "context_compaction", id?: ResponseItemId, encrypted_content?: string, internal_chat_message_metadata_passthrough?: InternalChatMessageMetadataPassthrough, } | { "type": "other" };
export type AgentMessageInputContent = { "type": "input_text", text: string, } | { "type": "encrypted_content", encrypted_content: string, };
export type ContentItem = { "type": "input_text", text: string, } | { "type": "input_image", image_url: string, detail?: ImageDetail, } | { "type": "input_audio", audio_url: string, } | { "type": "output_text", text: string, };
export type InternalChatMessageMetadataPassthrough = { turn_id?: string, };
export type LocalShellAction = { "type": "exec" } & LocalShellExecAction;
export type LocalShellExecAction = { command: Array<string>, timeout_ms: bigint | null, working_directory: string | null, env: { [key in string]?: string } | null, user: string | null, };
export type LocalShellStatus = "completed" | "in_progress" | "incomplete";
export type ReasoningItemContent = { "type": "reasoning_text", text: string, } | { "type": "text", text: string, };
export type ReasoningItemReasoningSummary = { "type": "summary_text", text: string, };
export type ResponseItemId = string;
export type WebSearchAction = { "type": "search", query?: string, queries?: Array<string>, } | { "type": "open_page", url?: string, } | { "type": "find_in_page", url?: string, pattern?: string, } | { "type": "other" };
export type v2_ThreadResumeInitialTurnsPageParams = {
limit?: number | null,
sortDirection?: v2_SortDirection | null,
itemsView?: v2_TurnItemsView | null, };
export type v2_SortDirection = "asc" | "desc";
export type v2_ThreadResumeResponse = { thread: v2_Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf,
runtimeWorkspaceRoots: Array<AbsolutePathBuf>,
instructionSources: Array<LegacyAppPathString>, approvalPolicy: v2_AskForApproval,
approvalsReviewer: v2_ApprovalsReviewer,
sandbox: v2_SandboxPolicy,
activePermissionProfile: v2_ActivePermissionProfile | null, reasoningEffort: ReasoningEffort | null,
multiAgentMode: MultiAgentMode,
initialTurnsPage: v2_TurnsPage | null,
turnsBackwardsCursor: string | null,
itemsBackwardsCursor: string | null, };
export type v2_TurnsPage = { data: Array<v2_Turn>, nextCursor: string | null, backwardsCursor: string | null, };
export type v2_ThreadReadParams = { threadId: string,
includeTurns?: boolean, };
export type v2_ThreadReadResponse = { thread: v2_Thread, };
export type v2_ThreadListParams = {
cursor?: string | null,
limit?: number | null,
sortKey?: v2_ThreadSortKey | null,
sortDirection?: v2_SortDirection | null,
modelProviders?: Array<string> | null,
sourceKinds?: Array<v2_ThreadSourceKind> | null,
archived?: boolean | null,
sectionId?: string | null,
projectId?: string | null,
cwd?: string | Array<string> | null,
useStateDbOnly?: boolean,
searchTerm?: string | null,
parentThreadId?: string | null,
ancestorThreadId?: string | null, };
export type v2_ThreadSortKey = "created_at" | "updated_at" | "recency_at" | "section_position";
export type v2_ThreadSourceKind = "cli" | "vscode" | "exec" | "appServer" | "subAgent" | "subAgentReview" | "subAgentCompact" | "subAgentThreadSpawn" | "subAgentOther" | "unknown";
export type v2_ThreadListResponse = { data: Array<v2_Thread>,
nextCursor: string | null,
backwardsCursor: string | null, };
export type v2_ThreadTurnsListParams = { threadId: string,
cursor?: string | null,
limit?: number | null,
sortDirection?: v2_SortDirection | null,
itemsView?: v2_TurnItemsView | null, };
export type v2_ThreadTurnsListResponse = { data: Array<v2_Turn>,
nextCursor: string | null,
backwardsCursor: string | null, };
export type v2_ThreadItemsListParams = { threadId: string,
turnId?: string | null,
cursor?: string | null,
limit?: number | null,
sortDirection?: v2_SortDirection | null, };
export type v2_ThreadItemsListResponse = { data: Array<v2_ThreadItemEntry>,
nextCursor: string | null,
backwardsCursor: string | null, };
export type v2_ThreadItemEntry = {
turnId: string, item: v2_ThreadItem, };
export type v2_TurnStartParams = { threadId: string, clientUserMessageId?: string | null, input: Array<v2_UserInput>,
turnTrigger?: string | null, toolOutput?: v2_TurnToolOutput | null,
responsesapiClientMetadata?: { [key in string]?: string } | null,
additionalContext?: { [key in string]?: v2_AdditionalContextEntry } | null,
environments?: Array<v2_TurnEnvironmentParams> | null,
cwd?: string | null,
runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null,
approvalPolicy?: v2_AskForApproval | null,
approvalsReviewer?: v2_ApprovalsReviewer | null,
sandboxPolicy?: v2_SandboxPolicy | null,
permissions?: string | null,
model?: string | null,
serviceTier?: string | null | null,
serviceTierForTurn?: string | null,
effort?: ReasoningEffort | null,
summary?: ReasoningSummary | null,
personality?: Personality | null,
outputSchema?: serde_json_JsonValue | null,
collaborationMode?: CollaborationMode | null,
multiAgentMode?: MultiAgentMode | null,
cyberAccessProgram?: v2_CyberAccessProgram | null, };
export type CollaborationMode = { mode: ModeKind, settings: Settings, };
export type ModeKind = "plan" | "default";
export type Settings = { model: string, reasoning_effort: ReasoningEffort | null, developer_instructions: string | null, };
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";
export type v2_AdditionalContextEntry = { value: string, kind: v2_AdditionalContextKind, };
export type v2_AdditionalContextKind = "untrusted" | "application";
export type v2_CyberAccessProgram = "standard" | "daybreakBlue" | "daybreakRed";
export type v2_TurnToolOutput = { name: string, namespace: string | null, output: FunctionCallOutputBody, };
export type v2_TurnStartResponse = { turn: v2_Turn, };
export type v2_TurnSteerParams = { threadId: string, clientUserMessageId?: string | null, input: Array<v2_UserInput>,
responsesapiClientMetadata?: { [key in string]?: string } | null,
additionalContext?: { [key in string]?: v2_AdditionalContextEntry } | null,
expectedTurnId: string, };
export type v2_TurnSteerResponse = { turnId: string, };
export type v2_TurnInterruptParams = { threadId: string, turnId: string, };
export type v2_TurnInterruptResponse = Record<string, never>;
export type v2_ReviewStartParams = { threadId: string, target: v2_ReviewTarget,
delivery?: v2_ReviewDelivery | null, };
export type v2_ReviewDelivery = "inline" | "detached";
export type v2_ReviewTarget = { "type": "uncommittedChanges" } | { "type": "baseBranch", branch: string, } | { "type": "commit", sha: string,
title: string | null, } | { "type": "custom", instructions: string, };
export type v2_ReviewStartResponse = { turn: v2_Turn,
reviewThreadId: string, };
export type v2_ConfigReadParams = { includeLayers?: boolean,
cwd?: string | null, };
export type v2_ConfigReadResponse = { config: v2_Config, origins: { [key in string]?: v2_ConfigLayerMetadata }, layers: Array<v2_ConfigLayer> | null, };
export type v2_Config = { model: string | null, review_model: string | null, model_context_window: bigint | null, model_auto_compact_token_limit: bigint | null, model_auto_compact_token_limit_scope: AutoCompactTokenLimitScope | null, model_provider: string | null, approval_policy: v2_AskForApproval | null,
approvals_reviewer: v2_ApprovalsReviewer | null, sandbox_mode: v2_SandboxMode | null, sandbox_workspace_write: v2_SandboxWorkspaceWrite | null, forced_chatgpt_workspace_id: v2_ForcedChatgptWorkspaceIds | null, forced_login_method: ForcedLoginMethod | null, web_search: WebSearchMode | null, tools: v2_ToolsV2 | null, instructions: string | null, developer_instructions: string | null, compact_prompt: string | null, model_reasoning_effort: ReasoningEffort | null, model_reasoning_summary: ReasoningSummary | null, model_verbosity: Verbosity | null, service_tier: string | null, analytics: v2_AnalyticsConfig | null, apps: v2_AppsConfig | null, browser_use: v2_BrowserUseConfig | null, computer_use: v2_ComputerUseConfig | null, desktop: { [key in string]?: serde_json_JsonValue } | null, } & ({ [key in string]?: number | string | boolean | Array<serde_json_JsonValue> | { [key in string]?: serde_json_JsonValue } | null });
export type AutoCompactTokenLimitScope = "total" | "body_after_prefix";
export type ForcedLoginMethod = "chatgpt" | "api";
export type Verbosity = "low" | "medium" | "high";
export type WebSearchMode = "disabled" | "cached" | "indexed" | "live";
export type v2_AnalyticsConfig = { enabled: boolean | null, } & ({ [key in string]?: number | string | boolean | Array<serde_json_JsonValue> | { [key in string]?: serde_json_JsonValue } | null });
export type v2_AppsConfig = { _default: v2_AppsDefaultConfig | null, } & ({ [key in string]?: { enabled: boolean, approvals_reviewer: v2_ApprovalsReviewer | null, destructive_enabled: boolean | null, open_world_enabled: boolean | null, default_tools_approval_mode: v2_AppToolApproval | null, default_tools_enabled: boolean | null, tools: v2_AppToolsConfig | null,
links: v2_AppLinksConfig | null, } });
export type v2_AppLinksConfig = { [key in string]?: { approvals_reviewer: v2_ApprovalsReviewer | null, default_tools_approval_mode: v2_AppToolApproval | null, } };
export type v2_AppToolApproval = "auto" | "prompt" | "writes" | "approve";
export type v2_AppToolsConfig = { [key in string]?: { enabled: boolean | null, approval_mode: v2_AppToolApproval | null, } };
export type v2_AppsDefaultConfig = { enabled: boolean, approvals_reviewer: v2_ApprovalsReviewer | null, destructive_enabled: boolean, open_world_enabled: boolean, default_tools_approval_mode: v2_AppToolApproval | null, };
export type v2_BrowserUseConfig = { allow_history_access: boolean | null, default_origin_policy: v2_BrowserUseOriginPolicyConfig | null, origins: { [key in string]?: v2_BrowserUseOriginPolicyConfig } | null, };
export type v2_BrowserUseOriginPolicyConfig = { access: v2_AllowDenyRequirement | null, downloads: v2_AllowDenyRequirement | null, uploads: v2_AllowDenyRequirement | null, full_cdp_access: v2_AllowDenyRequirement | null, };
export type v2_AllowDenyRequirement = "allow" | "deny";
export type v2_ComputerUseConfig = { default_app_access: v2_AllowDenyRequirement | null, macos: v2_ComputerUseMacosConfig | null, windows: v2_ComputerUseWindowsConfig | null, };
export type v2_ComputerUseMacosConfig = { bundle_ids: { [key in string]?: v2_AllowDenyRequirement } | null, };
export type v2_ComputerUseWindowsConfig = { aumids: { [key in string]?: v2_AllowDenyRequirement } | null, exes: Array<v2_ComputerUseWindowsExeConfig> | null, };
export type v2_ComputerUseWindowsExeConfig = { publisher_name: string, product_name: string, binary_name: string | null, access: v2_AllowDenyRequirement, };
export type v2_ForcedChatgptWorkspaceIds = string | Array<string>;
export type v2_SandboxWorkspaceWrite = { writable_roots: Array<string>, network_access: boolean, exclude_tmpdir_env_var: boolean, exclude_slash_tmp: boolean, };
export type v2_ToolsV2 = { web_search: WebSearchToolConfig | null, };
export type WebSearchToolConfig = { context_size: WebSearchContextSize | null, allowed_domains: Array<string> | null, location: WebSearchLocation | null, };
export type WebSearchContextSize = "low" | "medium" | "high";
export type WebSearchLocation = { country: string | null, region: string | null, city: string | null, timezone: string | null, };
export type v2_ConfigLayer = { name: v2_ConfigLayerSource, version: string, config: serde_json_JsonValue, disabledReason: string | null, };
export type v2_ConfigLayerSource = { "type": "packagedDefaults",
file: AbsolutePathBuf, } | { "type": "mdm", domain: string, key: string, } | { "type": "system",
file: AbsolutePathBuf, } | { "type": "enterpriseManaged",
id: string,
name: string, } | { "type": "user",
file: AbsolutePathBuf,
profile: string | null, } | { "type": "project", dotCodexFolder: AbsolutePathBuf, } | { "type": "sessionFlags" } | { "type": "legacyManagedConfigTomlFromFile", file: AbsolutePathBuf, } | { "type": "legacyManagedConfigTomlFromMdm" };
export type v2_ConfigLayerMetadata = { name: v2_ConfigLayerSource, version: string, };
export type v2_GetAccountParams = {
refreshToken?: boolean, };
export type v2_GetAccountResponse = { account: v2_Account | null, requiresOpenaiAuth: boolean, };
export type v2_Account = { "type": "apiKey", } | { "type": "chatgpt", email: string | null, planType: PlanType, } | { "type": "amazonBedrock", usesCodexManagedCredentials: boolean, };
export type PlanType = "free" | "go" | "plus" | "pro" | "prolite" | "team" | "self_serve_business_prolite" | "self_serve_business_usage_based" | "business" | "ent26" | "enterprise_cbp_automation" | "enterprise_cbp_usage_based" | "enterprise" | "edu" | "edu_plus" | "edu_pro" | "unknown";
export type v2_ListMcpServerStatusParams = {
cursor?: string | null,
limit?: number | null,
detail?: v2_McpServerStatusDetail | null, threadId?: string | null, };
export type v2_McpServerStatusDetail = "full" | "toolsAndAuthOnly";
export type v2_ListMcpServerStatusResponse = { data: Array<v2_McpServerStatus>,
nextCursor: string | null, };
export type v2_McpServerStatus = { name: string,
runtimeStatus: v2_McpServerConnectionStatus | null, pluginId: string | null, serverInfo: McpServerInfo | null, tools: { [key in string]?: Tool }, resources: Array<Resource>, resourceTemplates: Array<ResourceTemplate>, authStatus: v2_McpAuthStatus, };
export type McpServerInfo = { name: string, title: string | null, version: string, description: string | null, icons: Array<serde_json_JsonValue> | null, websiteUrl: string | null, };
export type Resource = { annotations?: serde_json_JsonValue, description?: string, mimeType?: string, name: string, size?: number, title?: string, uri: string, icons?: Array<serde_json_JsonValue>, _meta?: serde_json_JsonValue, };
export type ResourceTemplate = { annotations?: serde_json_JsonValue, uriTemplate: string, name: string, title?: string, description?: string, mimeType?: string, };
export type Tool = { name: string, title?: string, description?: string, inputSchema: serde_json_JsonValue, outputSchema?: serde_json_JsonValue, annotations?: serde_json_JsonValue, icons?: Array<serde_json_JsonValue>, _meta?: serde_json_JsonValue, };
export type v2_McpAuthStatus = "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
export type v2_McpServerConnectionStatus = "notStarted" | "starting" | "connected" | "authenticationRequired" | "failed" | "cancelled" | "disabled";
export type v2_SkillsListParams = {
cwds?: Array<string>,
forceReload?: boolean, };
export type v2_SkillsListResponse = { data: Array<v2_SkillsListEntry>, };
export type v2_SkillsListEntry = { cwd: string, skills: Array<v2_SkillMetadata>, errors: Array<v2_SkillErrorInfo>, };
export type v2_SkillErrorInfo = { path: string, message: string, };
export type v2_SkillMetadata = { name: string, description: string,
shortDescription?: string, interface?: v2_SkillInterface, dependencies?: v2_SkillDependencies, path: AbsolutePathBuf, scope: v2_SkillScope, enabled: boolean,
pluginId: string | null, };
export type v2_SkillDependencies = { tools: Array<v2_SkillToolDependency>, };
export type v2_SkillToolDependency = { type: string, value: string, description?: string, transport?: string, command?: string, url?: string, };
export type v2_SkillInterface = { displayName?: string, shortDescription?: string, iconSmall?: AbsolutePathBuf, iconLarge?: AbsolutePathBuf,
iconSmallUrl: string | null,
iconLargeUrl: string | null, brandColor?: string, defaultPrompt?: string, };
export type v2_SkillScope = "user" | "repo" | "system" | "admin";
export type v2_SkillsExtraRootsSetParams = { extraRoots: Array<AbsolutePathBuf>, };
export type v2_SkillsExtraRootsSetResponse = Record<string, never>;
export type v2_CommandExecutionRequestApprovalResponse = { decision: v2_CommandExecutionApprovalDecision, };
export type v2_CommandExecutionApprovalDecision = "accept" | "acceptForSession" | { "acceptWithExecpolicyAmendment": { execpolicy_amendment: v2_ExecPolicyAmendment, } } | { "applyNetworkPolicyAmendment": { network_policy_amendment: v2_NetworkPolicyAmendment, } } | "decline" | "cancel";
export type v2_ExecPolicyAmendment = Array<string>;
export type v2_NetworkPolicyAmendment = { host: string, action: v2_NetworkPolicyRuleAction, };
export type v2_NetworkPolicyRuleAction = "allow" | "deny";
export type v2_FileChangeRequestApprovalResponse = { decision: v2_FileChangeApprovalDecision, };
export type v2_FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type v2_ToolRequestUserInputResponse = { answers: { [key in string]?: v2_ToolRequestUserInputAnswer }, };
export type v2_ToolRequestUserInputAnswer = { answers: Array<string>, };
export type v2_McpServerElicitationRequestResponse = { action: v2_McpServerElicitationAction,
content: serde_json_JsonValue | null,
_meta: serde_json_JsonValue | null, };
export type v2_McpServerElicitationAction = "accept" | "decline" | "cancel";
export type v2_PermissionsRequestApprovalResponse = { permissions: v2_GrantedPermissionProfile, scope: v2_PermissionGrantScope,
strictAutoReview?: boolean, };
export type v2_GrantedPermissionProfile = { network?: v2_AdditionalNetworkPermissions, fileSystem?: v2_AdditionalFileSystemPermissions, };
export type v2_AdditionalFileSystemPermissions = {
read: Array<LegacyAppPathString> | null,
write: Array<LegacyAppPathString> | null, globScanMaxDepth?: number, entries?: Array<v2_FileSystemSandboxEntry>, };
export type v2_FileSystemSandboxEntry = { path: v2_FileSystemPath, access: v2_FileSystemAccessMode, };
export type v2_FileSystemAccessMode = "read" | "write" | "deny";
export type v2_FileSystemPath = { "type": "path", path: LegacyAppPathString, } | { "type": "glob_pattern", pattern: string, } | { "type": "special", value: v2_FileSystemSpecialPath, };
export type v2_FileSystemSpecialPath = { "kind": "root" } | { "kind": "minimal" } | { "kind": "project_roots", subpath: LegacyAppPathString | null, } | { "kind": "tmpdir" } | { "kind": "slash_tmp" } | { "kind": "unknown", path: string, subpath: LegacyAppPathString | null, };
export type v2_AdditionalNetworkPermissions = { enabled: boolean | null, };
export type v2_PermissionGrantScope = "turn" | "session";
export type v2_DynamicToolCallResponse = { contentItems: Array<v2_DynamicToolCallOutputContentItem>, success: boolean, };
export type v2_ChatgptAuthTokensRefreshResponse = { accessToken: string, chatgptAccountId: string, chatgptPlanType: string | null, };
export type v2_AttestationGenerateResponse = {
token: string, };
export type v2_CurrentTimeReadResponse = {
currentTimeAt: number, };
export type ApplyPatchApprovalResponse = { decision: ReviewDecision, };
export type ReviewDecision = "approved" | { "approved_execpolicy_amendment": { proposed_execpolicy_amendment: ExecPolicyAmendment, } } | "approved_for_session" | "approved_mcp_policy_amendment" | { "network_policy_amendment": { network_policy_amendment: NetworkPolicyAmendment, } } | { "denied": { rejection: string, } } | "timed_out" | "abort";
export type ExecPolicyAmendment = Array<string>;
export type NetworkPolicyAmendment = { host: string, action: NetworkPolicyRuleAction, };
export type NetworkPolicyRuleAction = "allow" | "deny";
export type ExecCommandApprovalResponse = { decision: ReviewDecision, };
export type ServerRequest = { "method": "item/commandExecution/requestApproval", id: RequestId, params: v2_CommandExecutionRequestApprovalParams, } | { "method": "item/fileChange/requestApproval", id: RequestId, params: v2_FileChangeRequestApprovalParams, } | { "method": "item/tool/requestUserInput", id: RequestId, params: v2_ToolRequestUserInputParams, } | { "method": "mcpServer/elicitation/request", id: RequestId, params: v2_McpServerElicitationRequestParams, } | { "method": "item/permissions/requestApproval", id: RequestId, params: v2_PermissionsRequestApprovalParams, } | { "method": "item/tool/call", id: RequestId, params: v2_DynamicToolCallParams, } | { "method": "account/chatgptAuthTokens/refresh", id: RequestId, params: v2_ChatgptAuthTokensRefreshParams, } | { "method": "attestation/generate", id: RequestId, params: v2_AttestationGenerateParams, } | { "method": "currentTime/read", id: RequestId, params: v2_CurrentTimeReadParams, } | { "method": "applyPatchApproval", id: RequestId, params: ApplyPatchApprovalParams, } | { "method": "execCommandApproval", id: RequestId, params: ExecCommandApprovalParams, };
export type ApplyPatchApprovalParams = { conversationId: ThreadId,
callId: string, fileChanges: { [key in string]?: FileChange },
reason: string | null,
grantRoot: string | null, };
export type FileChange = { "type": "add", content: string, } | { "type": "delete", content: string, } | { "type": "update", unified_diff: string, move_path: string | null, };
export type ExecCommandApprovalParams = { conversationId: ThreadId,
callId: string,
approvalId: string | null, command: Array<string>, cwd: string, reason: string | null, parsedCmd: Array<ParsedCommand>, };
export type ParsedCommand = { "type": "read", cmd: string, name: string,
path: string, } | { "type": "list_files", cmd: string, path: string | null, } | { "type": "search", cmd: string, query: string | null, path: string | null, } | { "type": "unknown", cmd: string, };
export type RequestId = string | number;
export type v2_AttestationGenerateParams = Record<string, never>;
export type v2_ChatgptAuthTokensRefreshParams = { reason: v2_ChatgptAuthTokensRefreshReason,
previousAccountId?: string | null, };
export type v2_ChatgptAuthTokensRefreshReason = "unauthorized";
export type v2_CommandExecutionRequestApprovalParams = {
kind: v2_CommandExecutionApprovalKind, threadId: string, turnId: string, itemId: string,
startedAtMs: number,
approvalId?: string | null,
environmentId: string | null,
reason?: string | null,
networkApprovalContext?: v2_NetworkApprovalContext | null,
command?: string | null,
cwd?: LegacyAppPathString | null,
commandActions?: Array<v2_CommandAction> | null,
additionalPermissions?: v2_AdditionalPermissionProfile | null,
proposedExecpolicyAmendment?: v2_ExecPolicyAmendment | null,
proposedNetworkPolicyAmendments?: Array<v2_NetworkPolicyAmendment> | null,
availableDecisions?: Array<v2_CommandExecutionApprovalDecision> | null, };
export type v2_AdditionalPermissionProfile = {
network: v2_AdditionalNetworkPermissions | null, fileSystem: v2_AdditionalFileSystemPermissions | null, };
export type v2_CommandExecutionApprovalKind = "command" | "writeStdin";
export type v2_NetworkApprovalContext = { host: string, protocol: v2_NetworkApprovalProtocol, };
export type v2_NetworkApprovalProtocol = "http" | "https" | "socks5Tcp" | "socks5Udp";
export type v2_CurrentTimeReadParams = { threadId: string, };
export type v2_DynamicToolCallParams = { threadId: string, turnId: string, callId: string, namespace: string | null, tool: string, arguments: serde_json_JsonValue, };
export type v2_FileChangeRequestApprovalParams = { threadId: string, turnId: string, itemId: string,
startedAtMs: number,
reason?: string | null,
grantRoot?: string | null, };
export type v2_McpServerElicitationRequestParams = { threadId: string,
turnId: string | null, serverName: string, } & ({ "mode": "form", _meta: serde_json_JsonValue | null, message: string, requestedSchema: v2_McpElicitationSchema, } | { "mode": "openai/form", _meta: serde_json_JsonValue | null, message: string, requestedSchema: serde_json_JsonValue, } | { "mode": "openaiForm", _meta: serde_json_JsonValue | null, message: string, requestedSchema: serde_json_JsonValue, } | { "mode": "url", _meta: serde_json_JsonValue | null, message: string, url: string, elicitationId: string, });
export type v2_McpElicitationSchema = { $schema?: string, type: v2_McpElicitationObjectType, properties: { [key in string]?: v2_McpElicitationPrimitiveSchema }, required?: Array<string>, };
export type v2_McpElicitationObjectType = "object";
export type v2_McpElicitationPrimitiveSchema = v2_McpElicitationEnumSchema | v2_McpElicitationStringSchema | v2_McpElicitationNumberSchema | v2_McpElicitationBooleanSchema;
export type v2_McpElicitationBooleanSchema = { type: v2_McpElicitationBooleanType, title?: string, description?: string, default?: boolean, };
export type v2_McpElicitationBooleanType = "boolean";
export type v2_McpElicitationEnumSchema = v2_McpElicitationSingleSelectEnumSchema | v2_McpElicitationMultiSelectEnumSchema | v2_McpElicitationLegacyTitledEnumSchema;
export type v2_McpElicitationLegacyTitledEnumSchema = { type: v2_McpElicitationStringType, title?: string, description?: string, enum: Array<string>, enumNames?: Array<string>, default?: string, };
export type v2_McpElicitationStringType = "string";
export type v2_McpElicitationMultiSelectEnumSchema = v2_McpElicitationUntitledMultiSelectEnumSchema | v2_McpElicitationTitledMultiSelectEnumSchema;
export type v2_McpElicitationTitledMultiSelectEnumSchema = { type: v2_McpElicitationArrayType, title?: string, description?: string, minItems?: bigint, maxItems?: bigint, items: v2_McpElicitationTitledEnumItems, default?: Array<string>, };
export type v2_McpElicitationArrayType = "array";
export type v2_McpElicitationTitledEnumItems = { anyOf: Array<v2_McpElicitationConstOption>, };
export type v2_McpElicitationConstOption = { const: string, title: string, };
export type v2_McpElicitationUntitledMultiSelectEnumSchema = { type: v2_McpElicitationArrayType, title?: string, description?: string, minItems?: bigint, maxItems?: bigint, items: v2_McpElicitationUntitledEnumItems, default?: Array<string>, };
export type v2_McpElicitationUntitledEnumItems = { type: v2_McpElicitationStringType, enum: Array<string>, };
export type v2_McpElicitationSingleSelectEnumSchema = v2_McpElicitationUntitledSingleSelectEnumSchema | v2_McpElicitationTitledSingleSelectEnumSchema;
export type v2_McpElicitationTitledSingleSelectEnumSchema = { type: v2_McpElicitationStringType, title?: string, description?: string, oneOf: Array<v2_McpElicitationConstOption>, default?: string, };
export type v2_McpElicitationUntitledSingleSelectEnumSchema = { type: v2_McpElicitationStringType, title?: string, description?: string, enum: Array<string>, default?: string, };
export type v2_McpElicitationNumberSchema = { type: v2_McpElicitationNumberType, title?: string, description?: string, minimum?: number, maximum?: number, default?: number, };
export type v2_McpElicitationNumberType = "number" | "integer";
export type v2_McpElicitationStringSchema = { type: v2_McpElicitationStringType, title?: string, description?: string, minLength?: number, maxLength?: number, format?: v2_McpElicitationStringFormat, default?: string, };
export type v2_McpElicitationStringFormat = "email" | "uri" | "date" | "date-time";
export type v2_PermissionsRequestApprovalParams = { threadId: string, turnId: string, itemId: string, environmentId: string | null,
startedAtMs: number, cwd: AbsolutePathBuf, reason: string | null, permissions: v2_RequestPermissionProfile, };
export type v2_RequestPermissionProfile = { network: v2_AdditionalNetworkPermissions | null, fileSystem: v2_AdditionalFileSystemPermissions | null, };
export type v2_ToolRequestUserInputParams = { threadId: string, turnId: string, itemId: string, questions: Array<v2_ToolRequestUserInputQuestion>, isBlocking: boolean,
autoResolutionMs: number | null, };
export type v2_ToolRequestUserInputQuestion = { id: string, header: string, question: string, isOther: boolean, isSecret: boolean, options: Array<v2_ToolRequestUserInputOption> | null, };
export type v2_ToolRequestUserInputOption = { label: string, description: string, };
export type ServerNotification = { "method": "error", "params": v2_ErrorNotification } | { "method": "thread/started", "params": v2_ThreadStartedNotification } | { "method": "thread/status/changed", "params": v2_ThreadStatusChangedNotification } | { "method": "thread/archived", "params": v2_ThreadArchivedNotification } | { "method": "thread/deleted", "params": v2_ThreadDeletedNotification } | { "method": "thread/unarchived", "params": v2_ThreadUnarchivedNotification } | { "method": "thread/closed", "params": v2_ThreadClosedNotification } | { "method": "thread/reverted", "params": v2_ThreadRevertedNotification } | { "method": "skills/changed", "params": v2_SkillsChangedNotification } | { "method": "thread/name/updated", "params": v2_ThreadNameUpdatedNotification } | { "method": "thread/goal/updated", "params": v2_ThreadGoalUpdatedNotification } | { "method": "thread/goal/cleared", "params": v2_ThreadGoalClearedNotification } | { "method": "thread/queue/changed", "params": v2_ThreadQueueChangedNotification } | { "method": "project/changed", "params": v2_ProjectChangedNotification } | { "method": "thread/project/updated", "params": v2_ThreadProjectUpdatedNotification } | { "method": "thread/environment/connected", "params": v2_EnvironmentConnectionNotification } | { "method": "thread/environment/disconnected", "params": v2_EnvironmentConnectionNotification } | { "method": "thread/settings/updated", "params": v2_ThreadSettingsUpdatedNotification } | { "method": "thread/tokenUsage/updated", "params": v2_ThreadTokenUsageUpdatedNotification } | { "method": "turn/started", "params": v2_TurnStartedNotification } | { "method": "hook/started", "params": v2_HookStartedNotification } | { "method": "turn/completed", "params": v2_TurnCompletedNotification } | { "method": "hook/completed", "params": v2_HookCompletedNotification } | { "method": "turn/diff/updated", "params": v2_TurnDiffUpdatedNotification } | { "method": "turn/plan/updated", "params": v2_TurnPlanUpdatedNotification } | { "method": "item/started", "params": v2_ItemStartedNotification } | { "method": "item/autoApprovalReview/started", "params": v2_ItemGuardianApprovalReviewStartedNotification } | { "method": "item/autoApprovalReview/completed", "params": v2_ItemGuardianApprovalReviewCompletedNotification } | { "method": "autoApprovalReview/strictReviewRequired", "params": v2_StrictReviewRequiredNotification } | { "method": "item/completed", "params": v2_ItemCompletedNotification } | { "method": "rawResponseItem/completed", "params": v2_RawResponseItemCompletedNotification } | { "method": "rawResponse/completed", "params": v2_RawResponseCompletedNotification } | { "method": "item/agentMessage/delta", "params": v2_AgentMessageDeltaNotification } | { "method": "item/plan/delta", "params": v2_PlanDeltaNotification } | { "method": "command/exec/outputDelta", "params": v2_CommandExecOutputDeltaNotification } | { "method": "process/outputDelta", "params": v2_ProcessOutputDeltaNotification } | { "method": "process/exited", "params": v2_ProcessExitedNotification } | { "method": "item/commandExecution/outputDelta", "params": v2_CommandExecutionOutputDeltaNotification } | { "method": "item/commandExecution/terminalInteraction", "params": v2_TerminalInteractionNotification } | { "method": "item/fileChange/outputDelta", "params": v2_FileChangeOutputDeltaNotification } | { "method": "item/fileChange/patchUpdated", "params": v2_FileChangePatchUpdatedNotification } | { "method": "serverRequest/resolved", "params": v2_ServerRequestResolvedNotification } | { "method": "item/mcpToolCall/progress", "params": v2_McpToolCallProgressNotification } | { "method": "mcpServer/oauthLogin/completed", "params": v2_McpServerOauthLoginCompletedNotification } | { "method": "mcpServer/startupStatus/updated", "params": v2_McpServerStatusUpdatedNotification } | { "method": "mcpServer/event/stream/notification", "params": v2_McpServerEventStreamNotification } | { "method": "account/updated", "params": v2_AccountUpdatedNotification } | { "method": "account/rateLimits/updated", "params": v2_AccountRateLimitsUpdatedNotification } | { "method": "app/list/updated", "params": v2_AppListUpdatedNotification } | { "method": "remoteControl/status/changed", "params": v2_RemoteControlStatusChangedNotification } | { "method": "externalAgentConfig/import/progress", "params": v2_ExternalAgentConfigImportProgressNotification } | { "method": "externalAgentConfig/import/completed", "params": v2_ExternalAgentConfigImportCompletedNotification } | { "method": "fs/changed", "params": v2_FsChangedNotification } | { "method": "item/reasoning/summaryTextDelta", "params": v2_ReasoningSummaryTextDeltaNotification } | { "method": "item/reasoning/summaryPartAdded", "params": v2_ReasoningSummaryPartAddedNotification } | { "method": "item/reasoning/textDelta", "params": v2_ReasoningTextDeltaNotification } | { "method": "thread/compacted", "params": v2_ContextCompactedNotification } | { "method": "model/rerouted", "params": v2_ModelReroutedNotification } | { "method": "model/verification", "params": v2_ModelVerificationNotification } | { "method": "modelProvider/authRecoveryStarted", "params": v2_AuthRecoveryNotification } | { "method": "modelProvider/authRecoveryCompleted", "params": v2_AuthRecoveryNotification } | { "method": "turn/moderationMetadata", "params": v2_TurnModerationMetadataNotification } | { "method": "model/safetyBuffering/updated", "params": v2_ModelSafetyBufferingUpdatedNotification } | { "method": "warning", "params": v2_WarningNotification } | { "method": "guardianWarning", "params": v2_GuardianWarningNotification } | { "method": "deprecationNotice", "params": v2_DeprecationNoticeNotification } | { "method": "configWarning", "params": v2_ConfigWarningNotification } | { "method": "fuzzyFileSearch/sessionUpdated", "params": FuzzyFileSearchSessionUpdatedNotification } | { "method": "fuzzyFileSearch/sessionCompleted", "params": FuzzyFileSearchSessionCompletedNotification } | { "method": "thread/realtime/started", "params": v2_ThreadRealtimeStartedNotification } | { "method": "thread/realtime/itemAdded", "params": v2_ThreadRealtimeItemAddedNotification } | { "method": "thread/realtime/item/started", "params": v2_ThreadRealtimeItemStartedNotification } | { "method": "thread/realtime/item/transcript/delta", "params": v2_ThreadRealtimeItemTranscriptDeltaNotification } | { "method": "thread/realtime/item/completed", "params": v2_ThreadRealtimeItemCompletedNotification } | { "method": "thread/realtime/transcript/delta", "params": v2_ThreadRealtimeTranscriptDeltaNotification } | { "method": "thread/realtime/transcript/done", "params": v2_ThreadRealtimeTranscriptDoneNotification } | { "method": "thread/realtime/outputAudio/delta", "params": v2_ThreadRealtimeOutputAudioDeltaNotification } | { "method": "thread/realtime/sdp", "params": v2_ThreadRealtimeSdpNotification } | { "method": "thread/realtime/error", "params": v2_ThreadRealtimeErrorNotification } | { "method": "thread/realtime/closed", "params": v2_ThreadRealtimeClosedNotification } | { "method": "windows/worldWritableWarning", "params": v2_WindowsWorldWritableWarningNotification } | { "method": "windowsSandbox/setupCompleted", "params": v2_WindowsSandboxSetupCompletedNotification } | { "method": "account/login/completed", "params": v2_AccountLoginCompletedNotification };
export type FuzzyFileSearchSessionCompletedNotification = { sessionId: string, };
export type FuzzyFileSearchSessionUpdatedNotification = { sessionId: string, query: string, files: Array<FuzzyFileSearchResult>, };
export type FuzzyFileSearchResult = { root: string, path: string, match_type: FuzzyFileSearchMatchType, file_name: string, score: number, indices: Array<number> | null, };
export type FuzzyFileSearchMatchType = "file" | "directory";
export type v2_AccountLoginCompletedNotification = { loginId: string | null, success: boolean, error: string | null, onboardingEntrypoint: v2_DesktopOnboardingEntrypoint | null, };
export type v2_DesktopOnboardingEntrypoint = "life_sciences";
export type v2_AccountRateLimitsUpdatedNotification = { rateLimits: v2_RateLimitSnapshot, };
export type v2_RateLimitSnapshot = { limitId: string | null, limitName: string | null, primary: v2_RateLimitWindow | null, secondary: v2_RateLimitWindow | null, credits: v2_CreditsSnapshot | null, individualLimit: v2_SpendControlLimitSnapshot | null,
spendControlReached: boolean | null, planType: PlanType | null, rateLimitReachedType: v2_RateLimitReachedType | null, };
export type v2_CreditsSnapshot = { hasCredits: boolean, unlimited: boolean, balance: string | null, };
export type v2_RateLimitReachedType = "rate_limit_reached" | "workspace_owner_credits_depleted" | "workspace_member_credits_depleted" | "workspace_owner_usage_limit_reached" | "workspace_member_usage_limit_reached";
export type v2_RateLimitWindow = { usedPercent: number, windowDurationMins: number | null, resetsAt: number | null, };
export type v2_SpendControlLimitSnapshot = { limit: string, used: string, remainingPercent: number, resetsAt: number, };
export type v2_AccountUpdatedNotification = { authMode: AuthMode | null, planType: PlanType | null, };
export type AuthMode = "apikey" | "chatgpt" | "chatgptAuthTokens" | "headers" | "agentIdentity" | "personalAccessToken" | "bedrockApiKey" | "bedrockAccessKeys";
export type v2_AgentMessageDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };
export type v2_AppListUpdatedNotification = { data: Array<v2_AppInfo>, };
export type v2_AppInfo = { id: string, name: string, description: string | null, logoUrl: string | null, logoUrlDark: string | null, iconAssets: { [key in string]?: string } | null, iconDarkAssets: { [key in string]?: string } | null, distributionChannel: string | null, branding: v2_AppBranding | null, appMetadata: v2_AppMetadata | null, labels: { [key in string]?: string } | null, installUrl: string | null, isAccessible: boolean,
isEnabled: boolean, pluginDisplayNames: Array<string>, };
export type v2_AppBranding = { category: string | null, developer: string | null, website: string | null, privacyPolicy: string | null, termsOfService: string | null, isDiscoverableApp: boolean, };
export type v2_AppMetadata = { review: v2_AppReview | null, categories: Array<string> | null, subCategories: Array<string> | null, seoDescription: string | null, screenshots: Array<v2_AppScreenshot> | null, developer: string | null, version: string | null, versionId: string | null, versionNotes: string | null, firstPartyRequiresInstall: boolean | null, showInComposerWhenUnlinked: boolean | null, };
export type v2_AppReview = { status: string, };
export type v2_AppScreenshot = { url: string | null, fileId: string | null, userPrompt: string, };
export type v2_AuthRecoveryNotification = { threadId: string, turnId: string, provider: string, message: string, };
export type v2_CommandExecOutputDeltaNotification = {
processId: string,
stream: v2_CommandExecOutputStream,
deltaBase64: string,
capReached: boolean, };
export type v2_CommandExecOutputStream = "stdout" | "stderr";
export type v2_CommandExecutionOutputDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };
export type v2_ConfigWarningNotification = {
summary: string,
details: string | null,
path?: string,
range?: v2_TextRange, };
export type v2_TextRange = { start: v2_TextPosition, end: v2_TextPosition, };
export type v2_TextPosition = {
line: number,
column: number, };
export type v2_ContextCompactedNotification = { threadId: string, turnId: string, };
export type v2_DeprecationNoticeNotification = {
summary: string,
details: string | null, };
export type v2_EnvironmentConnectionNotification = { threadId: string, environmentId: string, };
export type v2_ErrorNotification = { error: v2_TurnError, willRetry: boolean, threadId: string, turnId: string, };
export type v2_ExternalAgentConfigImportCompletedNotification = { importId: string, itemTypeResults: Array<v2_ExternalAgentConfigImportTypeResult>, };
export type v2_ExternalAgentConfigImportTypeResult = { itemType: v2_ExternalAgentConfigMigrationItemType, successes: Array<v2_ExternalAgentConfigImportItemTypeSuccess>, failures: Array<v2_ExternalAgentConfigImportItemTypeFailure>, };
export type v2_ExternalAgentConfigImportItemTypeFailure = { itemType: v2_ExternalAgentConfigMigrationItemType, errorType: string | null, subErrorType: string | null, failureStage: string, message: string, cwd: string | null, source: string | null, };
export type v2_ExternalAgentConfigMigrationItemType = "AGENTS_MD" | "CONFIG" | "SKILLS" | "PLUGINS" | "MCP_SERVER_CONFIG" | "SUBAGENTS" | "HOOKS" | "COMMANDS" | "MEMORY" | "SESSIONS";
export type v2_ExternalAgentConfigImportItemTypeSuccess = { itemType: v2_ExternalAgentConfigMigrationItemType, cwd: string | null, source: string | null, target: string | null,
title: string | null, };
export type v2_ExternalAgentConfigImportProgressNotification = { importId: string, itemTypeResults: Array<v2_ExternalAgentConfigImportTypeResult>, };
export type v2_FileChangeOutputDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };
export type v2_FileChangePatchUpdatedNotification = { threadId: string, turnId: string, itemId: string, changes: Array<v2_FileUpdateChange>, };
export type v2_FsChangedNotification = {
watchId: string,
changedPaths: Array<AbsolutePathBuf>, };
export type v2_GuardianWarningNotification = {
threadId: string,
message: string, };
export type v2_HookCompletedNotification = { threadId: string, turnId: string | null, run: v2_HookRunSummary, };
export type v2_HookRunSummary = { id: string, eventName: v2_HookEventName, handlerType: v2_HookHandlerType, executionMode: v2_HookExecutionMode, scope: v2_HookScope, sourcePath: AbsolutePathBuf, source: v2_HookSource, displayOrder: bigint, status: v2_HookRunStatus, statusMessage: string | null, startedAt: bigint, completedAt: bigint | null, durationMs: bigint | null, entries: Array<v2_HookOutputEntry>, };
export type v2_HookEventName = "preToolUse" | "permissionRequest" | "postToolUse" | "preCompact" | "postCompact" | "sessionStart" | "sessionEnd" | "userPromptSubmit" | "subagentStart" | "subagentStop" | "stop" | "interrupt";
export type v2_HookExecutionMode = "sync" | "async";
export type v2_HookHandlerType = "command" | "mcpTool" | "prompt" | "agent";
export type v2_HookOutputEntry = { kind: v2_HookOutputEntryKind, text: string, };
export type v2_HookOutputEntryKind = "warning" | "stop" | "feedback" | "context" | "error";
export type v2_HookRunStatus = "running" | "completed" | "failed" | "blocked" | "stopped";
export type v2_HookScope = "thread" | "turn";
export type v2_HookSource = "system" | "user" | "project" | "mdm" | "sessionFlags" | "plugin" | "cloudRequirements" | "cloudManagedConfig" | "legacyManagedConfigFile" | "legacyManagedConfigMdm" | "unknown";
export type v2_HookStartedNotification = { threadId: string, turnId: string | null, run: v2_HookRunSummary, };
export type v2_ItemCompletedNotification = { item: v2_ThreadItem, threadId: string, turnId: string,
completedAtMs: number, };
export type v2_ItemGuardianApprovalReviewCompletedNotification = { threadId: string, turnId: string,
startedAtMs: number,
completedAtMs: number,
reviewId: string,
targetItemId: string | null, decisionSource: v2_AutoReviewDecisionSource, review: v2_GuardianApprovalReview, action: v2_GuardianApprovalReviewAction, };
export type v2_AutoReviewDecisionSource = "agent";
export type v2_GuardianApprovalReview = { status: v2_GuardianApprovalReviewStatus, riskLevel: v2_GuardianRiskLevel | null, userAuthorization: v2_GuardianUserAuthorization | null, rationale: string | null, };
export type v2_GuardianApprovalReviewStatus = "inProgress" | "approved" | "denied" | "timedOut" | "aborted";
export type v2_GuardianRiskLevel = "low" | "medium" | "high" | "critical";
export type v2_GuardianUserAuthorization = "unknown" | "low" | "medium" | "high";
export type v2_GuardianApprovalReviewAction = { "type": "command", source: v2_GuardianCommandSource, command: string, cwd: AbsolutePathBuf, } | { "type": "execve", source: v2_GuardianCommandSource, program: string, argv: Array<string>, cwd: AbsolutePathBuf, } | { "type": "writeStdin", approvalId: string, processId: string, stdin: string, cwd: LegacyAppPathString, } | { "type": "applyPatch", cwd: AbsolutePathBuf, files: Array<AbsolutePathBuf>, } | { "type": "networkAccess", target: string, host: string, protocol: v2_NetworkApprovalProtocol, port: number, } | { "type": "mcpToolCall", server: string, toolName: string, connectorId: string | null, connectorName: string | null, toolTitle: string | null, } | { "type": "requestPermissions", reason: string | null, permissions: v2_RequestPermissionProfile, };
export type v2_GuardianCommandSource = "shell" | "unifiedExec";
export type v2_ItemGuardianApprovalReviewStartedNotification = { threadId: string, turnId: string,
startedAtMs: number,
reviewId: string,
targetItemId: string | null, review: v2_GuardianApprovalReview, action: v2_GuardianApprovalReviewAction, };
export type v2_ItemStartedNotification = { item: v2_ThreadItem, threadId: string, turnId: string,
startedAtMs: number, };
export type v2_McpServerEventStreamNotification = { subscriptionId: string, notification: v2_McpServerEventNotification, };
export type v2_McpServerEventNotification = { method: string, params: serde_json_JsonValue, };
export type v2_McpServerOauthLoginCompletedNotification = { name: string, threadId: string | null, success: boolean, error?: string, };
export type v2_McpServerStatusUpdatedNotification = { threadId: string | null, name: string, status: v2_McpServerStartupState, error: string | null, failureReason: v2_McpServerStartupFailureReason | null, };
export type v2_McpServerStartupFailureReason = "reauthenticationRequired";
export type v2_McpServerStartupState = "starting" | "ready" | "failed" | "cancelled";
export type v2_McpToolCallProgressNotification = { threadId: string, turnId: string, itemId: string, message: string, };
export type v2_ModelReroutedNotification = { threadId: string, turnId: string, fromModel: string, toModel: string, reason: v2_ModelRerouteReason, };
export type v2_ModelRerouteReason = "highRiskCyberActivity";
export type v2_ModelSafetyBufferingUpdatedNotification = { threadId: string, turnId: string, model: string, useCases: Array<string>, reasons: Array<string>, showBufferingUi: boolean, fasterModel: string | null, };
export type v2_ModelVerificationNotification = { threadId: string, turnId: string, verifications: Array<v2_ModelVerification>, };
export type v2_ModelVerification = "trustedAccessForCyber";
export type v2_PlanDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };
export type v2_ProcessExitedNotification = {
processHandle: string,
exitCode: number,
stdout: string,
stdoutCapReached: boolean,
stderr: string,
stderrCapReached: boolean, };
export type v2_ProcessOutputDeltaNotification = {
processHandle: string,
stream: v2_ProcessOutputStream,
deltaBase64: string,
capReached: boolean, };
export type v2_ProcessOutputStream = "stdout" | "stderr";
export type v2_ProjectChangedNotification = { projectId: string, changeType: v2_ProjectChangeType, };
export type v2_ProjectChangeType = "created" | "updated" | "deleted";
export type v2_RawResponseCompletedNotification = { threadId: string, turnId: string, responseId: string, usage: v2_TokenUsageBreakdown | null, usageMetadata: v2_ResponseUsageMetadata | null, };
export type v2_ResponseUsageMetadata = { amount: string | null, metadata: serde_json_JsonValue | null, };
export type v2_TokenUsageBreakdown = { totalTokens: number, inputTokens: number, cachedInputTokens: number, cacheWriteInputTokens: number, outputTokens: number, reasoningOutputTokens: number, };
export type v2_RawResponseItemCompletedNotification = { threadId: string, turnId: string, item: ResponseItem, };
export type v2_ReasoningSummaryPartAddedNotification = { threadId: string, turnId: string, itemId: string, summaryIndex: number, };
export type v2_ReasoningSummaryTextDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, summaryIndex: number, };
export type v2_ReasoningTextDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, contentIndex: number, };
export type v2_RemoteControlStatusChangedNotification = { status: v2_RemoteControlConnectionStatus, serverName: string, installationId: string, environmentId: string | null, };
export type v2_RemoteControlConnectionStatus = "disabled" | "connecting" | "connected" | "errored";
export type v2_ServerRequestResolvedNotification = { threadId: string, requestId: RequestId, };
export type v2_SkillsChangedNotification = Record<string, never>;
export type v2_StrictReviewRequiredNotification = { threadId: string, turnId: string,
startedAtMs: number, };
export type v2_TerminalInteractionNotification = { threadId: string, turnId: string, itemId: string, processId: string, stdin: string, };
export type v2_ThreadArchivedNotification = { threadId: string, };
export type v2_ThreadClosedNotification = { threadId: string, };
export type v2_ThreadDeletedNotification = { threadId: string, };
export type v2_ThreadGoalClearedNotification = { threadId: string, };
export type v2_ThreadGoalUpdatedNotification = { threadId: string, turnId: string | null, goal: v2_ThreadGoal, };
export type v2_ThreadGoal = { threadId: string, objective: string, status: v2_ThreadGoalStatus, tokenBudget: number | null, tokensUsed: number, timeUsedSeconds: number, createdAt: number, updatedAt: number, };
export type v2_ThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
export type v2_ThreadNameUpdatedNotification = { threadId: string, threadName?: string, };
export type v2_ThreadProjectUpdatedNotification = { threadId: string, projectId: string | null, };
export type v2_ThreadQueueChangedNotification = { threadId: string, };
export type v2_ThreadRealtimeClosedNotification = { threadId: string, reason: string | null, };
export type v2_ThreadRealtimeErrorNotification = { threadId: string, message: string, };
export type v2_ThreadRealtimeItemAddedNotification = { threadId: string, item: serde_json_JsonValue, };
export type v2_ThreadRealtimeItemCompletedNotification = { threadId: string, item: v2_ThreadRealtimeItem, };
export type v2_ThreadRealtimeItem = { id: string, realtimeSessionId: string, } & ({ "type": "realtimeSessionStarted" } | { "type": "transcriptSegment", role: v2_ThreadRealtimeTranscriptRole, text: string, } | { "type": "bemItemPromoted", turnId: string, itemId: string, presentation: v2_ThreadRealtimeBemItemPresentation, } | { "type": "realtimeSessionClosed", outcome: v2_ThreadRealtimeSessionOutcome, });
export type v2_ThreadRealtimeBemItemPresentation = { "type": "wholeItem" } | { "type": "inlineMarkdown" } | { "type": "inlineVisualization", index: number, };
export type v2_ThreadRealtimeSessionOutcome = "ended" | "failed";
export type v2_ThreadRealtimeTranscriptRole = "user" | "assistant";
export type v2_ThreadRealtimeItemStartedNotification = { threadId: string, item: v2_ThreadRealtimeItem, };
export type v2_ThreadRealtimeItemTranscriptDeltaNotification = { threadId: string, itemId: string, delta: string, };
export type v2_ThreadRealtimeOutputAudioDeltaNotification = { threadId: string, audio: v2_ThreadRealtimeAudioChunk, };
export type v2_ThreadRealtimeAudioChunk = { data: string, sampleRate: number, numChannels: number, samplesPerChannel: number | null, itemId: string | null, };
export type v2_ThreadRealtimeSdpNotification = { threadId: string, sdp: string, };
export type v2_ThreadRealtimeStartedNotification = { threadId: string, realtimeSessionId: string | null, version: RealtimeConversationVersion, };
export type RealtimeConversationVersion = "v1" | "v2" | "v3";
export type v2_ThreadRealtimeTranscriptDeltaNotification = { threadId: string, role: string,
delta: string, };
export type v2_ThreadRealtimeTranscriptDoneNotification = { threadId: string, role: string,
text: string, };
export type v2_ThreadRevertedNotification = { threadId: string, };
export type v2_ThreadSettingsUpdatedNotification = { threadId: string, threadSettings: v2_ThreadSettings, };
export type v2_ThreadSettings = { cwd: AbsolutePathBuf, approvalPolicy: v2_AskForApproval, approvalsReviewer: v2_ApprovalsReviewer, sandboxPolicy: v2_SandboxPolicy, activePermissionProfile: v2_ActivePermissionProfile | null, model: string, modelProvider: string, serviceTier: string | null, effort: ReasoningEffort | null, summary: ReasoningSummary | null, collaborationMode: CollaborationMode,
multiAgentMode: MultiAgentMode, personality: Personality | null, };
export type v2_ThreadStartedNotification = { thread: v2_Thread, };
export type v2_ThreadStatusChangedNotification = { threadId: string, status: v2_ThreadStatus, };
export type v2_ThreadTokenUsageUpdatedNotification = { threadId: string, turnId: string, tokenUsage: v2_ThreadTokenUsage, };
export type v2_ThreadTokenUsage = { total: v2_TokenUsageBreakdown, last: v2_TokenUsageBreakdown, modelContextWindow: number | null, };
export type v2_ThreadUnarchivedNotification = { threadId: string, };
export type v2_TurnCompletedNotification = { threadId: string, turn: v2_Turn, };
export type v2_TurnDiffUpdatedNotification = { threadId: string, turnId: string, diff: string, };
export type v2_TurnModerationMetadataNotification = { threadId: string, turnId: string, metadata: serde_json_JsonValue, };
export type v2_TurnPlanUpdatedNotification = { threadId: string, turnId: string, explanation: string | null, plan: Array<v2_TurnPlanStep>, };
export type v2_TurnPlanStep = { step: string, status: v2_TurnPlanStepStatus, };
export type v2_TurnPlanStepStatus = "pending" | "inProgress" | "completed";
export type v2_TurnStartedNotification = { threadId: string, turn: v2_Turn, };
export type v2_WarningNotification = {
threadId: string | null,
message: string, };
export type v2_WindowsSandboxSetupCompletedNotification = { mode: v2_WindowsSandboxSetupMode, success: boolean, error: string | null, };
export type v2_WindowsSandboxSetupMode = "elevated" | "unelevated";
export type v2_WindowsWorldWritableWarningNotification = { samplePaths: Array<string>, extraCount: number, failedScan: boolean, };
export type NativeMethods = {
  "initialize": { params: InitializeParams; result: InitializeResponse };
  "thread/start": { params: v2_ThreadStartParams; result: v2_ThreadStartResponse };
  "thread/resume": { params: v2_ThreadResumeParams; result: v2_ThreadResumeResponse };
  "thread/read": { params: v2_ThreadReadParams; result: v2_ThreadReadResponse };
  "thread/list": { params: v2_ThreadListParams; result: v2_ThreadListResponse };
  "thread/turns/list": { params: v2_ThreadTurnsListParams; result: v2_ThreadTurnsListResponse };
  "thread/items/list": { params: v2_ThreadItemsListParams; result: v2_ThreadItemsListResponse };
  "turn/start": { params: v2_TurnStartParams; result: v2_TurnStartResponse };
  "turn/steer": { params: v2_TurnSteerParams; result: v2_TurnSteerResponse };
  "turn/interrupt": { params: v2_TurnInterruptParams; result: v2_TurnInterruptResponse };
  "review/start": { params: v2_ReviewStartParams; result: v2_ReviewStartResponse };
  "config/read": { params: v2_ConfigReadParams; result: v2_ConfigReadResponse };
  "account/read": { params: v2_GetAccountParams; result: v2_GetAccountResponse };
  "mcpServerStatus/list": { params: v2_ListMcpServerStatusParams; result: v2_ListMcpServerStatusResponse };
  "skills/list": { params: v2_SkillsListParams; result: v2_SkillsListResponse };
  "skills/extraRoots/set": { params: v2_SkillsExtraRootsSetParams; result: v2_SkillsExtraRootsSetResponse };
};
export type NativeReplies = {
  "item/commandExecution/requestApproval": v2_CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": v2_FileChangeRequestApprovalResponse;
  "item/tool/requestUserInput": v2_ToolRequestUserInputResponse;
  "mcpServer/elicitation/request": v2_McpServerElicitationRequestResponse;
  "item/permissions/requestApproval": v2_PermissionsRequestApprovalResponse;
  "item/tool/call": v2_DynamicToolCallResponse;
  "account/chatgptAuthTokens/refresh": v2_ChatgptAuthTokensRefreshResponse;
  "attestation/generate": v2_AttestationGenerateResponse;
  "currentTime/read": v2_CurrentTimeReadResponse;
  "applyPatchApproval": ApplyPatchApprovalResponse;
  "execCommandApproval": ExecCommandApprovalResponse;
};
