/** 定义 Patch 落盘后执行构建、页面渲染与视觉验收的领域端口和持久证据。 */

import type { DesignPreview } from "../design-context/designContext.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";
import type {
  ApprovableDeliveryCommandPlan,
  DeliveryCommandPlan,
} from "./deliveryCommand.js";

/** 用户批准的页面渲染入口；当前 MVP 只允许项目内同源绝对路径。 */
export interface DeliveryValidationTarget {
  previewPath: string;
}

/** 指向服务端受控存储中的一张交付验收 PNG 证据。 */
export interface DeliveryEvidenceReference {
  evidenceId: string;
  kind: "actual" | "difference";
  mimeType: "image/png";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
}

/** 保存交付验收图片时使用的受控二进制输入。 */
export interface DeliveryEvidenceWriteInput {
  taskId: string;
  patchSetHash: string;
  kind: DeliveryEvidenceReference["kind"];
  data: Uint8Array;
  width: number;
  height: number;
}

/** 交付证据存储的所有权校验读取结果。 */
export interface DeliveryEvidenceReadResult {
  reference: DeliveryEvidenceReference;
  data: Uint8Array;
}

/** 隔离验收流程与具体二进制证据存储方式。 */
export interface DeliveryEvidenceStore {
  /** 原子保存有大小上限的 PNG，并返回不含绝对路径的引用。 */
  write(input: DeliveryEvidenceWriteInput): Promise<DeliveryEvidenceReference>;
  /** 只允许按任务所有权读取已保存证据。 */
  read(taskId: string, evidenceId: string): Promise<DeliveryEvidenceReadResult>;
  /** 重置任务时尽力清除该任务产生的验收证据。 */
  discardTask(taskId: string): Promise<void>;
}

/** 单个自动验收阶段的有限执行结论。 */
export interface DeliveryValidationStageResult {
  status: "passed" | "blocked";
  durationMs: number;
  summary: string;
  reason?: string;
}

/** 项目构建阶段的命令标签和受限日志摘要。 */
export interface DeliveryBuildResult extends DeliveryValidationStageResult {
  command: string;
  outputSummary: string;
}

/** 页面渲染阶段的入口、视口和实际截图证据。 */
export interface DeliveryRenderResult extends DeliveryValidationStageResult {
  previewPath: string;
  viewport: { width: number; height: number };
  actualImage?: DeliveryEvidenceReference;
}

/** 视觉差异阶段的确定性像素门禁结果。 */
export interface DeliveryVisualResult extends DeliveryValidationStageResult {
  pixelDifferenceRatio: number;
  threshold: number;
  differenceImage?: DeliveryEvidenceReference;
}

/** 全部自动门禁通过后的权威交付结论。 */
export interface ProjectDeliveryValidationPassed {
  status: "passed";
  patchSetHash: string;
  summary: string;
  build: DeliveryBuildResult;
  render: DeliveryRenderResult;
  visual: DeliveryVisualResult;
  validatedAt: string;
}

/** 任一阶段停止后需要人工处理的权威交付结论。 */
export interface ProjectDeliveryValidationBlocked {
  status: "blocked";
  patchSetHash: string;
  summary: string;
  reasons: string[];
  manualActionRequired: true;
  build: DeliveryBuildResult;
  render?: DeliveryRenderResult;
  visual?: DeliveryVisualResult;
  blockedAt: string;
}

/** 持久化到 D2C 任务中的完整自动交付验收结果。 */
export type ProjectDeliveryValidationOutcome =
  | ProjectDeliveryValidationPassed
  | ProjectDeliveryValidationBlocked;

/** 交付验收阶段向宿主发送的有限进度事件。 */
export type DeliveryValidationProgressEvent =
  | { type: "delivery-command-start"; purpose: "install-dependencies"; command: string }
  | { type: "delivery-command-complete"; purpose: "install-dependencies"; durationMs: number }
  | { type: "delivery-command-blocked"; purpose: "install-dependencies"; durationMs: number }
  | { type: "delivery-build-start"; command: string }
  | { type: "delivery-build-complete"; durationMs: number }
  | { type: "delivery-build-blocked"; durationMs: number }
  | { type: "delivery-render-start"; previewPath: string }
  | { type: "delivery-render-complete"; durationMs: number }
  | { type: "delivery-render-blocked"; durationMs: number }
  | { type: "delivery-visual-start"; threshold: number }
  | { type: "delivery-visual-complete"; durationMs: number; pixelDifferenceRatio: number }
  | { type: "delivery-visual-blocked"; durationMs: number; pixelDifferenceRatio?: number };

/** 单次交付验收使用的进度接收器。 */
export type DeliveryValidationProgressReporter = (
  event: DeliveryValidationProgressEvent,
) => void | Promise<void>;

/** 隔离 D2C Service 与具体构建进程、浏览器和图像实现。 */
export interface ProjectDeliveryValidator {
  /** 只读检查已落盘项目，并生成尚未执行的精确命令计划。 */
  prepare(input: {
    taskId: string;
    workspaceRoot: string;
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    patchSetHash: string;
  }): Promise<DeliveryCommandPlan>;
  /** 只对哈希已批准的精确命令计划执行构建、页面渲染和视觉验收。 */
  validate(input: {
    taskId: string;
    workspaceRoot: string;
    inspection: Exclude<ProjectInspection, { kind: "unsupported" }>;
    designPreview: DesignPreview | undefined;
    target: DeliveryValidationTarget;
    patchSetHash: string;
    commandPlan: ApprovableDeliveryCommandPlan;
    approvedCommandPlanHash: string;
    reportProgress?: DeliveryValidationProgressReporter;
    signal?: AbortSignal;
  }): Promise<ProjectDeliveryValidationOutcome>;
}
