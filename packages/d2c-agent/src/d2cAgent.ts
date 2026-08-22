/** 作为 d2c-agent 包唯一公共入口，暴露设计读取 Service 工厂与领域契约。 */

import type {
  D2CTaskCommand as D2CTaskCommandContract,
  InspectDesignCommand as InspectDesignCommandContract,
} from "./d2cCommand.js";
import {
  createD2CService,
  type D2CService as D2CServiceContract,
  type D2CServiceOptions as D2CServiceOptionsContract,
} from "./d2cService.js";
import type {
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

/** 仅通过一个静态工厂创建 D2C Service，隐藏内部 Resolver、Graph 和工具装配。 */
export class D2CAgent {
  /** 禁止实例化静态公共入口。 */
  private constructor() {}

  /** 创建设计检查与 SVG 预览确认 D2C Service。 */
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
  export type DesignVisualEvidence = DesignVisualEvidenceContract;
  export type DesignVisualImage = DesignVisualImageContract;
  export type DesignVisualEvidenceProvider = DesignVisualEvidenceProviderContract;
  /** 第二步节点内部可实时观察的进度事件。 */
  export type SecondStepProgressEvent = SecondStepProgressEventContract;
  /** 单次第二步执行使用的进度接收器。 */
  export type SecondStepProgressReporter = SecondStepProgressReporterContract;
}
