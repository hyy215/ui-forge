/** 从任务绑定 Artifact 生成确定性组件候选的独立 Graph 节点。 */

import type { AgentCore } from "@ui-forge/agent-core";
import type { DesignArtifactReader } from "../../../design-context/designArtifact.js";
import type { DesignComponentRecognizer } from "../../../design-components/designComponentRecognition.js";
import type { SecondStepProgressReporter } from "../../../second-step/secondStepProgress.js";
import type { D2CGraphState } from "../../d2cGraphState.js";

/** 确定性组件识别节点的稳定标识。 */
export const recognizeDesignComponentsNodeId = "recognizeDesignComponents";

/** 创建只消费平台无关结构证据的组件识别节点。 */
export function createRecognizeDesignComponentsNode(
  artifactReader: DesignArtifactReader | undefined,
  recognizer: DesignComponentRecognizer,
  resolveReporter: (taskId: string) => SecondStepProgressReporter | undefined,
): AgentCore.GraphNode<D2CGraphState> {
  return {
    id: recognizeDesignComponentsNodeId,
    execute: async (state) => {
      const inspection = state.execution?.inspection;
      const catalog = state.execution?.componentCatalog;
      if (!state.task || !inspection || !catalog) {
        throw new Error("组件识别节点缺少任务、设计检查结果或版本化组件目录。");
      }
      const reporter = resolveReporter(state.task.taskId);
      await reporter?.({ type: "component-recognition-start" });
      const startedAt = performance.now();
      const artifactId = inspection.artifact?.artifactId;
      let recognition;
      if (!artifactId || !artifactReader) {
        recognition = {
          status: "unavailable" as const,
          components: [],
          warnings: ["当前设计没有可供组件识别读取的结构 Artifact。"],
        };
      } else {
        const artifact = await artifactReader.read(artifactId);
        recognition = artifact.content.structure
          ? recognizer.recognize(
              structuredClone(artifact.content.structure),
              structuredClone(catalog),
            )
          : {
              status: "unavailable" as const,
              components: [],
              warnings: ["当前设计 Artifact 不包含平台无关结构证据。"],
            };
      }
      await reporter?.({
        type: "component-recognition-complete",
        recognition: structuredClone(recognition),
        unknownCount: recognition.components.filter((component) => !component.typeHint).length,
        durationMs: elapsedMilliseconds(startedAt),
      });
      return {
        execution: {
          ...state.execution,
          componentRecognition: recognition,
        },
      };
    },
  };
}

/** 计算识别节点的非负整数毫秒耗时。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
