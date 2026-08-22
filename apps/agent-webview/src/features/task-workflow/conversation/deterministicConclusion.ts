/** 将公开的项目事实和主 Agent 最终组件判断压缩为展示结论。 */

import type { DesignComponentRecognition, ProjectValidation } from "@ui-forge/shared-protocol";

/** 当前公开证据支持的项目与组件结论。 */
export interface DeterministicConclusion {
  projectConclusion: string | null;
  componentTypes: string[];
  unresolvedComponents: string[];
  blocked: boolean;
}

/** 只消费 Server 已校验结果，不在客户端推导新类型或方案。 */
export function createDeterministicConclusion(
  validation: ProjectValidation | null,
  recognition: DesignComponentRecognition | null,
): DeterministicConclusion {
  const componentTypes = recognition
    ? [...new Set(recognition.components.flatMap(
        (component) => component.effectiveTypeId ? [formatDesignComponentType(component.effectiveTypeId)] : [],
      ))]
    : [];
  const unresolvedComponents = recognition
    ? recognition.components.filter((component) => !component.effectiveTypeId).map((component) => component.name)
    : [];
  if (!validation) return { projectConclusion: null, componentTypes, unresolvedComponents, blocked: false };
  switch (validation.kind) {
    case "empty":
      return {
        projectConclusion: "当前为空项目，实施前需要初始化 React + TypeScript + Ant Design 项目。",
        componentTypes,
        unresolvedComponents,
        blocked: false,
      };
    case "react_antd":
      return {
        projectConclusion: "当前为 React + Ant Design 项目，满足现阶段支持范围。",
        componentTypes,
        unresolvedComponents,
        blocked: false,
      };
    case "unsupported":
      return {
        projectConclusion: `当前项目不在支持范围：${validation.reasons.join("；")}。`,
        componentTypes,
        unresolvedComponents,
        blocked: true,
      };
  }
}

/** 将开放组件类型 ID 转换为紧凑界面名称。 */
export function formatDesignComponentType(typeId: string): string {
  return typeId.split("-").map((part) => part.length > 0
    ? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}`
    : part).join(" ");
}
