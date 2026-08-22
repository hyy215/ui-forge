/** 定义第二步项目校验、组件识别、可审计过程和未来结构化方案协议。 */

import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";

/** 校验目标项目进入规划前的公开分类。 */
export const projectValidationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("empty"),
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal("react_antd"),
    message: z.string().min(1),
    reactVersion: z.string().optional(),
    antdVersion: z.string().optional(),
  }),
  z.object({
    kind: z.literal("unsupported"),
    message: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1),
  }),
]);

/** 校验可配置目录使用的开放组件类型 ID。 */
export const designComponentTypeIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

/** 校验规则层产生的非权威目录命中提示。 */
export const componentTypeHintSchema = z.object({
  typeId: designComponentTypeIdSchema,
  matchedAlias: z.string().min(1),
});

/** 校验独立视觉 Subagent 的建议。 */
export const visualComponentSuggestionSchema = z.object({
  suggestedTypeId: designComponentTypeIdSchema.optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).min(1),
});

/** 校验一个可审计且不包含原始设计载荷的组件识别结果。 */
export const recognizedDesignComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  instanceCount: z.number().int().nonnegative(),
  evidence: z.array(z.string().min(1)).min(1),
  evidenceStrength: z.enum(["explicit", "structural", "weak"]),
  typeHint: componentTypeHintSchema.optional(),
  visualSuggestion: visualComponentSuggestionSchema.optional(),
  effectiveTypeId: designComponentTypeIdSchema.optional(),
  resolvedBy: z.enum(["catalog", "model", "unresolved"]).optional(),
  resolutionReason: z.string().min(1).optional(),
}).superRefine((component, context) => {
  if (component.resolvedBy === "unresolved" && component.effectiveTypeId) {
    context.addIssue({ code: "custom", path: ["effectiveTypeId"], message: "未解决候选不能包含最终类型。" });
  }
  if (component.resolvedBy && component.resolvedBy !== "unresolved" && !component.effectiveTypeId) {
    context.addIssue({ code: "custom", path: ["effectiveTypeId"], message: "已解决候选必须包含最终类型。" });
  }
  if (component.resolvedBy && !component.resolutionReason) {
    context.addIssue({ code: "custom", path: ["resolutionReason"], message: "最终判断必须包含原因。" });
  }
});

/** 校验第二步 DeepAgent 组件分析的完整公开结果。 */
export const designComponentRecognitionSchema = z.object({
  status: z.enum(["recognized", "unavailable"]),
  components: z.array(recognizedDesignComponentSchema),
  warnings: z.array(z.string().min(1)),
});

/** 校验未来真实方案中的组件复用或新增项。 */
export const planningComponentSchema = z.object({
  typeId: designComponentTypeIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
});

/** 校验静态设计中可审计的页面布局理解。 */
export const designLayoutUnderstandingSchema = z.object({
  summary: z.string().min(1),
  regions: z.array(z.object({
    id: z.string().min(1),
    sourceNodeIds: z.array(z.string().min(1)).min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    relationship: z.string().min(1),
    parentRegionId: z.string().min(1).optional(),
    direction: z.enum(["row", "column", "overlay", "unknown"]).optional(),
    bounds: z.object({
      x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative(),
    }).optional(),
    evidence: z.array(z.string().min(1)).min(1),
  })),
  evidence: z.array(z.string().min(1)).min(1),
  warnings: z.array(z.string().min(1)),
});

/** 校验设计图中影响编码的可见元素、文本与静态状态。 */
export const designVisualElementSchema = z.object({
  id: z.string().min(1),
  sourceNodeIds: z.array(z.string().min(1)).min(1),
  regionId: z.string().min(1),
  kind: z.enum(["text", "input", "select", "button", "icon", "tree", "table", "tabs", "feedback", "other"]),
  name: z.string().min(1),
  text: z.string().min(1).optional(),
  textStatus: z.enum(["exact", "uncertain", "none"]),
  states: z.array(z.enum(["selected", "active", "expanded", "collapsed", "warning", "error", "disabled", "default"])),
  implementation: z.enum(["required", "reference-only"]),
  componentCandidateId: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)).min(1),
});

/** 校验静态设计中只能视为推断或未解决的交互候选。 */
export const designInteractionCandidateSchema = z.object({
  id: z.string().min(1),
  triggerNodeIds: z.array(z.string().min(1)).min(1),
  trigger: z.enum(["click", "change", "submit", "hover"]),
  expectedEffect: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).min(1),
  status: z.enum(["inferred", "unresolved"]),
});

/** 校验主 Agent 对一个设计组件的实现来源与复用策略。 */
export const planningComponentDecisionSchema = z.object({
  candidateId: z.string().min(1),
  action: z.enum(["reuse-directly", "reuse-configured", "reuse-with-wrapper", "extend-existing", "create-new", "unresolved"]),
  source: z.enum(["catalog", "repository", "new", "unresolved"]),
  catalogComponentId: z.string().min(1).optional(),
  repositoryComponentId: z.string().min(1).optional(),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
}).superRefine((decision, context) => {
  const reusableActions = ["reuse-directly", "reuse-configured", "reuse-with-wrapper"];
  if (decision.source === "catalog") {
    if (!decision.catalogComponentId || decision.repositoryComponentId) {
      context.addIssue({ code: "custom", message: "目录复用决策必须且只能包含 catalogComponentId。" });
    }
    if (!reusableActions.includes(decision.action)) {
      context.addIssue({ code: "custom", message: "目录组件只支持直接、配置或包装复用。" });
    }
  }
  if (decision.source === "repository") {
    if (!decision.repositoryComponentId || decision.catalogComponentId) {
      context.addIssue({ code: "custom", message: "仓库复用决策必须且只能包含 repositoryComponentId。" });
    }
    if (![...reusableActions, "extend-existing"].includes(decision.action)) {
      context.addIssue({ code: "custom", message: "仓库来源必须采用复用或扩展策略。" });
    }
  }
  if (decision.source === "new"
    && (decision.action !== "create-new" || decision.catalogComponentId || decision.repositoryComponentId)) {
    context.addIssue({ code: "custom", message: "新建决策必须使用 create-new 且不能绑定复用组件。" });
  }
  if (decision.source === "unresolved"
    && (decision.action !== "unresolved" || decision.catalogComponentId || decision.repositoryComponentId)) {
    context.addIssue({ code: "custom", message: "未解决决策必须使用 unresolved 且不能绑定复用组件。" });
  }
});

/** 校验一个文件的预计操作、消费者和风险。 */
export const planningFileImpactSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["create", "modify", "delete"]),
  reason: z.string().min(1),
  affectedSymbols: z.array(z.string().min(1)),
  downstreamConsumers: z.array(z.string().min(1)),
  risk: z.enum(["low", "medium", "high"]),
  evidence: z.array(z.string().min(1)).min(1),
});

/** 校验未来真实方案中的单个实施步骤。 */
export const planningStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["initialize", "layout", "component", "interaction", "cross-cutting", "validation"]),
  targetId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  decision: z.enum(["create", "reuse", "configure", "wrap", "extend", "modify", "validate"]),
  dependsOn: z.array(z.string().min(1)),
  files: z.array(z.object({ path: z.string().min(1), action: z.enum(["create", "modify", "delete"]) })),
  designElementIds: z.array(z.string().min(1)).optional(),
  evidence: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)),
});

/** 校验 Planning Agent 最终返回的可审批结构化方案。 */
export const planningResultSchema = z.object({
  status: z.enum(["reviewable", "blocked"]),
  summary: z.string().min(1),
  designUnderstanding: z.object({
    layout: designLayoutUnderstandingSchema,
    interactions: z.array(designInteractionCandidateSchema),
    elements: z.array(designVisualElementSchema).optional(),
  }),
  reusableComponents: z.array(planningComponentSchema),
  newComponents: z.array(planningComponentSchema),
  componentDecisions: z.array(planningComponentDecisionSchema),
  fileImpacts: z.array(planningFileImpactSchema),
  steps: z.array(planningStepSchema).min(1),
  files: z.array(z.string().min(1)),
  contextGaps: z.array(z.string().min(1)),
  stopConditions: z.array(z.string().min(1)).min(1),
});

/** 校验第二步方案区域的真实生命周期状态。 */
export const conversationPlanStatusSchema = z.enum([
  "idle",
  "validating_project",
  "analyzing_design",
  "validated",
  "planning",
  "ready",
  "unsupported",
  "error",
  "stopped",
]);

/** 校验模型供应商实际返回的 Token 使用量。 */
export const agentTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

/** 校验工具完成时可展示的耗时和可选 Token 指标。 */
export const toolExecutionMetricsSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  tokenUsage: agentTokenUsageSchema.optional(),
});

/** 校验用户主动终止当前对话流所需的任务标识。 */
export const cancelD2CConversationInputSchema = z.object({
  taskId: z.string().uuid(),
});

/** 校验 Server 是否找到并取消了当前任务运行。 */
export const cancelD2CConversationResultSchema = z.object({
  cancelled: z.boolean(),
});

/** 校验第二步快照中可恢复的展示数据。 */
export const conversationViewModelSchema = z.object({
  initialUserMessage: z.string().min(1),
  planStatus: conversationPlanStatusSchema,
  projectValidation: projectValidationSchema.nullable(),
  designComponentRecognition: designComponentRecognitionSchema.nullable(),
  plan: planningResultSchema.nullable(),
});

/** 校验开始第二步流式输出时携带的乐观并发参数。 */
export const streamD2CConversationInputSchema = d2cTaskCommandInputSchema;

const messageEventBaseSchema = z.object({
  messageId: z.string().min(1),
});

/** 校验第二步流中安全、可审计且不包含隐藏思维链的领域事件。 */
export const conversationStreamEventSchema = z.discriminatedUnion("type", [
  messageEventBaseSchema.extend({ type: z.literal("message-start") }),
  messageEventBaseSchema.extend({
    type: z.literal("agent-progress"),
    phase: z.enum([
      "project-validation",
      "project-analysis",
      "design-analysis",
      "planning",
    ]),
    title: z.string().min(1),
    summary: z.string().min(1),
  }),
  messageEventBaseSchema.extend({
    type: z.literal("tool-start"),
    toolCallId: z.string().min(1),
    parentToolCallId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    summary: z.string().min(1),
  }),
  messageEventBaseSchema.extend({
    type: z.literal("tool-complete"),
    toolCallId: z.string().min(1),
    summary: z.string().min(1),
    outcome: z.enum(["success", "warning", "error"]),
    metrics: toolExecutionMetricsSchema.optional(),
  }),
  messageEventBaseSchema.extend({
    type: z.literal("project-validation"),
    result: projectValidationSchema,
  }),
  messageEventBaseSchema.extend({
    type: z.literal("design-component-result"),
    result: designComponentRecognitionSchema,
  }),
  messageEventBaseSchema.extend({ type: z.literal("plan-start") }),
  messageEventBaseSchema.extend({
    type: z.literal("plan-result"),
    plan: planningResultSchema,
  }),
  messageEventBaseSchema.extend({ type: z.literal("message-complete") }),
  messageEventBaseSchema.extend({ type: z.literal("message-stopped") }),
]);

/** 客户端展示的目标项目校验结果。 */
export type ProjectValidation = z.infer<typeof projectValidationSchema>;

/** 第二步公开的设计组件分析结果。 */
export type DesignComponentRecognition = z.infer<typeof designComponentRecognitionSchema>;

/** Planning Agent 最终返回的结构化方案。 */
export type PlanningResult = z.infer<typeof planningResultSchema>;

/** 第二步方案区域的真实生命周期状态。 */
export type ConversationPlanStatus = z.infer<typeof conversationPlanStatusSchema>;
/** 模型供应商实际返回的 Token 使用量。 */
export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;
/** 工具完成时公开的运行指标。 */
export type ToolExecutionMetrics = z.infer<typeof toolExecutionMetricsSchema>;
/** 主动终止第二步对话流的输入。 */
export type CancelD2CConversationInput = z.infer<typeof cancelD2CConversationInputSchema>;
/** 主动终止请求的执行结果。 */
export type CancelD2CConversationResult = z.infer<typeof cancelD2CConversationResultSchema>;

/** 第二步快照中可恢复的展示数据。 */
export type ConversationViewModel = z.infer<typeof conversationViewModelSchema>;

/** 开始第二步流式输出所需参数。 */
export type StreamD2CConversationInput = z.infer<typeof streamD2CConversationInputSchema>;

/** 第二步流式输出允许发送的领域事件。 */
export type ConversationStreamEvent = z.infer<typeof conversationStreamEventSchema>;
