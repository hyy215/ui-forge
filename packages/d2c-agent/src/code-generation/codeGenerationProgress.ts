/** 定义代码生成阶段可向宿主报告的有限进度与模型指标事件。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { CodeGenerationOutcome } from "./codePatch.js";

/** 代码生成阶段允许对外投影的领域进度事件。 */
export type CodeGenerationProgressEvent =
  | { type: "code-context-start"; fileCount: number }
  | { type: "code-context-complete"; fileCount: number; warningCount: number; durationMs: number }
  | { type: "code-generation-start"; stepCount: number }
  | {
      type: "code-generation-complete";
      outcome: CodeGenerationOutcome;
      durationMs: number;
      tokenUsage?: AgentCore.AgentTokenUsage;
    };

/** 单次代码生成运行使用的进度接收器。 */
export type CodeGenerationProgressReporter = (
  event: CodeGenerationProgressEvent,
) => void | Promise<void>;
