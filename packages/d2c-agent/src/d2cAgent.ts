/** 作为 d2c-agent 包唯一公共入口，暴露完整 D2C Service 工厂与领域契约。 */

import type {
  ApprovePlanCommand as ApprovePlanCommandContract,
  ApproveDeliveryCommandsCommand as ApproveDeliveryCommandsCommandContract,
  ConfirmDesignCommand as ConfirmDesignCommandContract,
  D2CTaskCommand as D2CTaskCommandContract,
  InspectDesignCommand as InspectDesignCommandContract,
  RenameTaskCommand as RenameTaskCommandContract,
} from "./d2cCommand.js";
import {
  createD2CService,
  type D2CService as D2CServiceContract,
  type D2CServiceOptions as D2CServiceOptionsContract,
} from "./d2cService.js";
import type {
  PlanApproval as PlanApprovalContract,
  D2CTask as D2CTaskContract,
  D2CTaskStatus as D2CTaskStatusContract,
} from "./d2cTask.js";
import type {
  DesignArtifactContent as DesignArtifactContentContract,
  DesignArtifactLifecycle as DesignArtifactLifecycleContract,
  DesignArtifactReader as DesignArtifactReaderContract,
  DesignArtifactReference as DesignArtifactReferenceContract,
  DesignArtifactGarbageCollector as DesignArtifactGarbageCollectorContract,
  DesignArtifactSection as DesignArtifactSectionContract,
  DesignArtifactWriter as DesignArtifactWriterContract,
} from "./design-context/designArtifact.js";
import type {
  DesignNodeBounds as DesignNodeBoundsContract,
  DesignNodeEvidence as DesignNodeEvidenceContract,
  DesignNodeKind as DesignNodeKindContract,
  DesignStructureEvidence as DesignStructureEvidenceContract,
} from "./design-context/designStructure.js";
import type {
  DesignComponentRecognition as DesignComponentRecognitionContract,
  DesignComponentRecognizer as DesignComponentRecognizerContract,
  ComponentTypeHint as ComponentTypeHintContract,
  VisualComponentSuggestion as VisualComponentSuggestionContract,
  RecognizedDesignComponent as RecognizedDesignComponentContract,
} from "./design-components/designComponentRecognition.js";
import {
  type ComponentCatalog as ComponentCatalogContract,
  type ComponentCatalogEntry as ComponentCatalogEntryContract,
  type ComponentTypeId as ComponentTypeIdContract,
} from "./design-components/componentCatalog.js";
export { parseComponentCatalog } from "./design-components/componentCatalog.js";
export {
  assertDeliveryCommandPlanIntegrity,
  calculateDeliveryCommandPlanHash,
} from "./delivery-validation/deliveryCommand.js";
import type { PlanningResult as PlanningResultContract } from "./planning/planningResult.js";
import type {
  EvolvingPlanningResult as EvolvingPlanningResultContract,
  HumanPlanFieldLock as HumanPlanFieldLockContract,
  PlanDelta as PlanDeltaContract,
  PlanDeltaApplicationResult as PlanDeltaApplicationResultContract,
  PlanIntentField as PlanIntentFieldContract,
  PlanLockConflict as PlanLockConflictContract,
  PlanPatchBinding as PlanPatchBindingContract,
  PlanRevisionRecord as PlanRevisionRecordContract,
  PlanningIntent as PlanningIntentContract,
} from "./planning/evolvingPlan.js";
import type {
  PlanReviewInput as PlanReviewInputContract,
  PlanReviewLoopDecision as PlanReviewLoopDecisionContract,
  PlanReviewResult as PlanReviewResultContract,
  PlanReviewSubagent as PlanReviewSubagentContract,
} from "./planning/planReview.js";
import type {
  DesignContext as DesignContextContract,
  DesignPreview as DesignPreviewContract,
  DesignRegion as DesignRegionContract,
  DesignStructurePreview as DesignStructurePreviewContract,
  DesignStructureRegion as DesignStructureRegionContract,
} from "./design-context/designContext.js";
import type {
  DesignInspection as DesignInspectionContract,
  DesignProvenance as DesignProvenanceContract,
} from "./design-context/designInspection.js";
import type { DesignSource as DesignSourceContract } from "./design-context/designSource.js";
import type { DesignSourceAdapter as DesignSourceAdapterContract } from "./design-context/designSourceAdapter.js";
import type { ProjectInspection as ProjectInspectionContract } from "./project-context/projectInspection.js";
import type { ProjectInspector as ProjectInspectorContract } from "./project-context/projectInspector.js";
import type {
  ProjectContextAnalysis as ProjectContextAnalysisContract,
  ProjectContextAnalyzer as ProjectContextAnalyzerContract,
  RepositoryComponentEvidence as RepositoryComponentEvidenceContract,
  RepositoryComponentMatch as RepositoryComponentMatchContract,
} from "./project-context/projectContextAnalysis.js";
import type {
  DesignInteractionCandidate as DesignInteractionCandidateContract,
  DesignLayoutRegion as DesignLayoutRegionContract,
  DesignLayoutUnderstanding as DesignLayoutUnderstandingContract,
  DesignUnderstanding as DesignUnderstandingContract,
  DesignVisualElement as DesignVisualElementContract,
} from "./design-understanding/designUnderstanding.js";
import type {
  PlanDeepAgent as PlanDeepAgentContract,
  PlanDeepAgentInput as PlanDeepAgentInputContract,
  PlanDeepAgentModelOptions as PlanDeepAgentModelOptionsContract,
  PlanDeepAgentResult as PlanDeepAgentResultContract,
} from "./second-step/planDeepAgent.js";
import type {
  DesignVisualEvidence as DesignVisualEvidenceContract,
  DesignVisualEvidenceProvider as DesignVisualEvidenceProviderContract,
  DesignVisualImage as DesignVisualImageContract,
} from "./second-step/designVisualEvidence.js";
import type {
  SecondStepProgressEvent as SecondStepProgressEventContract,
  SecondStepProgressReporter as SecondStepProgressReporterContract,
} from "./second-step/secondStepProgress.js";
import type {
  DesignSystemCatalogResolution as DesignSystemCatalogResolutionContract,
  DesignSystemKnowledgeProvider as DesignSystemKnowledgeProviderContract,
  DesignSystemKnowledgeRecord as DesignSystemKnowledgeRecordContract,
  DesignSystemKnowledgeSection as DesignSystemKnowledgeSectionContract,
} from "./design-system/designSystemKnowledge.js";
import type {
  CodeGenerationAgent as CodeGenerationAgentContract,
  CodeGenerationAgentInput as CodeGenerationAgentInputContract,
  CodeGenerationAgentModelOptions as CodeGenerationAgentModelOptionsContract,
  CodeGenerationAgentResult as CodeGenerationAgentResultContract,
} from "./code-generation/codeGenerationAgent.js";
import type {
  CodeGenerationOutcome as CodeGenerationOutcomeContract,
  CodePatchOperation as CodePatchOperationContract,
  CodePatchSet as CodePatchSetContract,
  CodeStepPatch as CodeStepPatchContract,
} from "./code-generation/codePatch.js";
import type {
  ProjectCodeContext as ProjectCodeContextContract,
  ProjectCodeContextReader as ProjectCodeContextReaderContract,
  ProjectCodeFileSnapshot as ProjectCodeFileSnapshotContract,
} from "./code-generation/projectCodeContext.js";
import type {
  CodeGenerationProgressEvent as CodeGenerationProgressEventContract,
  CodeGenerationProgressReporter as CodeGenerationProgressReporterContract,
} from "./code-generation/codeGenerationProgress.js";
import type {
  AppliedPatchFile as AppliedPatchFileContract,
  PatchApplicationOutcome as PatchApplicationOutcomeContract,
  ProjectPatchApplier as ProjectPatchApplierContract,
  ProjectPatchApplyResult as ProjectPatchApplyResultContract,
} from "./code-application/projectPatchApplier.js";
import type {
  DeliveryBuildResult as DeliveryBuildResultContract,
  DeliveryEvidenceReadResult as DeliveryEvidenceReadResultContract,
  DeliveryEvidenceReference as DeliveryEvidenceReferenceContract,
  DeliveryEvidenceStore as DeliveryEvidenceStoreContract,
  DeliveryEvidenceWriteInput as DeliveryEvidenceWriteInputContract,
  DeliveryRenderResult as DeliveryRenderResultContract,
  DeliveryValidationProgressEvent as DeliveryValidationProgressEventContract,
  DeliveryValidationProgressReporter as DeliveryValidationProgressReporterContract,
  DeliveryValidationTarget as DeliveryValidationTargetContract,
  DeliveryVisualResult as DeliveryVisualResultContract,
  ProjectDeliveryValidationOutcome as ProjectDeliveryValidationOutcomeContract,
  ProjectDeliveryValidator as ProjectDeliveryValidatorContract,
} from "./delivery-validation/projectDeliveryValidator.js";
import type {
  ApprovableDeliveryCommandPlan as ApprovableDeliveryCommandPlanContract,
  DeliveryCommand as DeliveryCommandContract,
  DeliveryCommandApproval as DeliveryCommandApprovalContract,
  DeliveryCommandAuditEvent as DeliveryCommandAuditEventContract,
  DeliveryCommandPlan as DeliveryCommandPlanContract,
  ManualDeliveryCommandPlan as ManualDeliveryCommandPlanContract,
} from "./delivery-validation/deliveryCommand.js";

/** 仅通过一个静态工厂创建 D2C Service，隐藏内部 Resolver、Graph 和工具装配。 */
export class D2CAgent {
  /** 禁止实例化静态公共入口。 */
  private constructor() {}

  /** 创建设计读取、规划、代码生成与受控应用 D2C Service。 */
  static createService(options: D2CAgent.ServiceOptions): D2CAgent.Service {
    return createD2CService(options);
  }
}

/** 汇总创建 Service 和实现 D2C 外部端口所需的公共领域类型。 */
export namespace D2CAgent {
  export type Service = D2CServiceContract;
  export type ServiceOptions = D2CServiceOptionsContract;
  export type Task = D2CTaskContract;
  export type TaskStatus = D2CTaskStatusContract;
  export type TaskCommand = D2CTaskCommandContract;
  export type InspectDesignCommand = InspectDesignCommandContract;
  export type ConfirmDesignCommand = ConfirmDesignCommandContract;
  export type ApprovePlanCommand = ApprovePlanCommandContract;
  export type ApproveDeliveryCommandsCommand = ApproveDeliveryCommandsCommandContract;
  export type RenameTaskCommand = RenameTaskCommandContract;
  export type PlanApproval = PlanApprovalContract;
  export type DesignSource = DesignSourceContract;
  export type DesignContext = DesignContextContract;
  export type DesignRegion = DesignRegionContract;
  export type DesignPreview = DesignPreviewContract;
  export type DesignStructureRegion = DesignStructureRegionContract;
  export type DesignStructurePreview = DesignStructurePreviewContract;
  export type DesignInspection = DesignInspectionContract;
  export type DesignProvenance = DesignProvenanceContract;
  export type DesignArtifactContent = DesignArtifactContentContract;
  export type DesignArtifactSection = DesignArtifactSectionContract;
  export type DesignArtifactReference = DesignArtifactReferenceContract;
  export type DesignArtifactReader = DesignArtifactReaderContract;
  export type DesignArtifactWriter = DesignArtifactWriterContract;
  export type DesignArtifactLifecycle = DesignArtifactLifecycleContract;
  export type DesignArtifactGarbageCollector = DesignArtifactGarbageCollectorContract;
  export type DesignNodeKind = DesignNodeKindContract;
  export type DesignNodeBounds = DesignNodeBoundsContract;
  export type DesignNodeEvidence = DesignNodeEvidenceContract;
  export type DesignStructureEvidence = DesignStructureEvidenceContract;
  export type ComponentTypeId = ComponentTypeIdContract;
  export type ComponentCatalogEntry = ComponentCatalogEntryContract;
  export type ComponentCatalog = ComponentCatalogContract;
  export type ComponentTypeHint = ComponentTypeHintContract;
  export type RecognizedDesignComponent = RecognizedDesignComponentContract;
  export type DesignComponentRecognition = DesignComponentRecognitionContract;
  export type VisualComponentSuggestion = VisualComponentSuggestionContract;
  export type DesignComponentRecognizer = DesignComponentRecognizerContract;
  export type DesignSystemKnowledgeProvider = DesignSystemKnowledgeProviderContract;
  export type DesignSystemCatalogResolution = DesignSystemCatalogResolutionContract;
  export type DesignSystemKnowledgeRecord = DesignSystemKnowledgeRecordContract;
  export type DesignSystemKnowledgeSection = DesignSystemKnowledgeSectionContract;
  export type PlanningResult = PlanningResultContract;
  export type EvolvingPlanningResult = EvolvingPlanningResultContract;
  export type PlanningIntent = PlanningIntentContract;
  export type PlanIntentField = PlanIntentFieldContract;
  export type HumanPlanFieldLock = HumanPlanFieldLockContract;
  export type PlanDelta = PlanDeltaContract;
  export type PlanDeltaApplicationResult = PlanDeltaApplicationResultContract;
  export type PlanLockConflict = PlanLockConflictContract;
  export type PlanPatchBinding = PlanPatchBindingContract;
  export type PlanRevisionRecord = PlanRevisionRecordContract;
  export type PlanReviewResult = PlanReviewResultContract;
  export type PlanReviewInput = PlanReviewInputContract;
  export type PlanReviewSubagent = PlanReviewSubagentContract;
  export type PlanReviewLoopDecision = PlanReviewLoopDecisionContract;
  export type DesignSourceAdapter = DesignSourceAdapterContract;
  /** 目标项目进入规划前的确定性支持状态。 */
  export type ProjectInspection = ProjectInspectionContract;
  /** 由仓库扫描 Adapter 实现的目标项目检查端口。 */
  export type ProjectInspector = ProjectInspectorContract;
  export type ProjectContextAnalysis = ProjectContextAnalysisContract;
  export type ProjectContextAnalyzer = ProjectContextAnalyzerContract;
  export type RepositoryComponentEvidence = RepositoryComponentEvidenceContract;
  export type RepositoryComponentMatch = RepositoryComponentMatchContract;
  export type DesignLayoutRegion = DesignLayoutRegionContract;
  export type DesignLayoutUnderstanding = DesignLayoutUnderstandingContract;
  export type DesignInteractionCandidate = DesignInteractionCandidateContract;
  export type DesignVisualElement = DesignVisualElementContract;
  export type DesignUnderstanding = DesignUnderstandingContract;
  /** Plan DeepAgent 多模态视觉复核端口。 */
  export type PlanDeepAgent = PlanDeepAgentContract;
  export type PlanDeepAgentInput = PlanDeepAgentInputContract;
  export type PlanDeepAgentResult = PlanDeepAgentResultContract;
  export type PlanDeepAgentModelOptions = PlanDeepAgentModelOptionsContract;
  /** 按版本化 Plan 生成候选 Patch 的受限 Agent 端口。 */
  export type CodeGenerationAgent = CodeGenerationAgentContract;
  /** Code Agent 单次调用的权威输入。 */
  export type CodeGenerationAgentInput = CodeGenerationAgentInputContract;
  /** Code Agent 返回的候选 Patch 与新 Plan 绑定。 */
  export type CodeGenerationAgentResult = CodeGenerationAgentResultContract;
  /** 代码阶段允许由组合入口提供的模型参数。 */
  export type CodeGenerationAgentModelOptions = CodeGenerationAgentModelOptionsContract;
  /** 代码生成成功或明确阻塞的持久业务结论。 */
  export type CodeGenerationOutcome = CodeGenerationOutcomeContract;
  /** 绑定单一 Plan 版本的候选 Patch 集合。 */
  export type CodePatchSet = CodePatchSetContract;
  /** 绑定单个 Plan 步骤的候选 Patch。 */
  export type CodeStepPatch = CodeStepPatchContract;
  /** 单个文件的结构化内容变换。 */
  export type CodePatchOperation = CodePatchOperationContract;
  /** Code Agent 可见的受控仓库文本上下文。 */
  export type ProjectCodeContext = ProjectCodeContextContract;
  /** 单个计划或参考文件的生成前快照。 */
  export type ProjectCodeFileSnapshot = ProjectCodeFileSnapshotContract;
  /** 由文件系统 Adapter 实现的代码上下文读取端口。 */
  export type ProjectCodeContextReader = ProjectCodeContextReaderContract;
  /** 代码生成阶段允许报告的有限进度事件。 */
  export type CodeGenerationProgressEvent = CodeGenerationProgressEventContract;
  /** 单次代码生成运行使用的进度接收器。 */
  export type CodeGenerationProgressReporter = CodeGenerationProgressReporterContract;
  /** Patch 应用后单个文件的最终动作。 */
  export type AppliedPatchFile = AppliedPatchFileContract;
  /** 权威任务持久化的 Patch 应用或人工介入结果。 */
  export type PatchApplicationOutcome = PatchApplicationOutcomeContract;
  /** 由受控 Workspace Adapter 实现的 Patch 应用端口。 */
  export type ProjectPatchApplier = ProjectPatchApplierContract;
  /** 受控 Patch 应用器的确定性结果。 */
  export type ProjectPatchApplyResult = ProjectPatchApplyResultContract;
  /** 当前 Plan 绑定的同源页面渲染入口。 */
  export type DeliveryValidationTarget = DeliveryValidationTargetContract;
  /** 交付验收图片在受控存储中的轻量引用。 */
  export type DeliveryEvidenceReference = DeliveryEvidenceReferenceContract;
  /** 按任务所有权读取的一张交付验收图片。 */
  export type DeliveryEvidenceReadResult = DeliveryEvidenceReadResultContract;
  /** 交付验收二进制证据存储端口。 */
  export type DeliveryEvidenceStore = DeliveryEvidenceStoreContract;
  /** 保存一张交付验收图片时使用的受控输入。 */
  export type DeliveryEvidenceWriteInput = DeliveryEvidenceWriteInputContract;
  /** 项目构建门禁的持久结果。 */
  export type DeliveryBuildResult = DeliveryBuildResultContract;
  /** 页面渲染门禁的持久结果。 */
  export type DeliveryRenderResult = DeliveryRenderResultContract;
  /** 视觉差异门禁的持久结果。 */
  export type DeliveryVisualResult = DeliveryVisualResultContract;
  /** 自动交付验收的权威结论。 */
  export type ProjectDeliveryValidationOutcome = ProjectDeliveryValidationOutcomeContract;
  /** 交付验收阶段允许报告的有限进度事件。 */
  export type DeliveryValidationProgressEvent = DeliveryValidationProgressEventContract;
  /** 单次交付验收使用的进度接收器。 */
  export type DeliveryValidationProgressReporter = DeliveryValidationProgressReporterContract;
  /** 由运行时 Adapter 实现的构建、渲染和视觉验收端口。 */
  export type ProjectDeliveryValidator = ProjectDeliveryValidatorContract;
  /** 一条等待人工审阅的真实 Workspace 命令。 */
  export type DeliveryCommand = DeliveryCommandContract;
  /** 自动执行前持久化的命令准备结果。 */
  export type DeliveryCommandPlan = DeliveryCommandPlanContract;
  /** 允许由系统执行的 Workspace 内命令计划。 */
  export type ApprovableDeliveryCommandPlan = ApprovableDeliveryCommandPlanContract;
  /** 只能复制后由用户手工执行的命令计划。 */
  export type ManualDeliveryCommandPlan = ManualDeliveryCommandPlanContract;
  /** 用户对精确命令计划的批准记录。 */
  export type DeliveryCommandApproval = DeliveryCommandApprovalContract;
  /** 命令生命周期允许写入安全日志的有限事件。 */
  export type DeliveryCommandAuditEvent = DeliveryCommandAuditEventContract;
  export type DesignVisualEvidence = DesignVisualEvidenceContract;
  export type DesignVisualImage = DesignVisualImageContract;
  export type DesignVisualEvidenceProvider = DesignVisualEvidenceProviderContract;
  /** 第二步节点内部可实时观察的进度事件。 */
  export type SecondStepProgressEvent = SecondStepProgressEventContract;
  /** 单次第二步执行使用的进度接收器。 */
  export type SecondStepProgressReporter = SecondStepProgressReporterContract;
}
