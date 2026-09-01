/** 从已审阅方案确定性提取代码阶段可版本化保护的稳定实现意图。 */

import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { PlanningIntent } from "./evolvingPlan.js";
import type { PlanningResult } from "./planningResult.js";

/** 将布局、组件和交互步骤转换为可锁定的稳定意图目标。 */
export function createPlanningIntent(
  plan: PlanningResult,
  recognition: DesignComponentRecognition,
): PlanningIntent {
  const targets = new Map<string, PlanningIntent["targets"][number]>();
  const layoutById = new Map(plan.designUnderstanding.layout.regions.map((region) => [region.id, region]));
  const interactionById = new Map(plan.designUnderstanding.interactions.map((interaction) => [interaction.id, interaction]));
  const componentTypeById = new Map(recognition.components.map((component) => [
    component.id,
    component.effectiveTypeId ?? component.typeHint?.typeId ?? "unresolved",
  ]));

  for (const step of plan.steps) {
    if (step.kind === "layout") {
      const region = layoutById.get(step.targetId);
      addUniqueTarget(targets, {
        id: step.targetId,
        kind: "layout",
        fields: {
          "layout.role": region?.role ?? step.title,
          "layout.relationship": region?.relationship ?? step.description,
          ...(region?.direction ? { "layout.direction": region.direction } : {}),
        },
      });
    } else if (step.kind === "component") {
      addUniqueTarget(targets, {
        id: step.targetId,
        kind: "component",
        fields: {
          "component.componentType": componentTypeById.get(step.targetId) ?? "unresolved",
          "component.responsibility": step.description,
        },
      });
    } else if (step.kind === "interaction") {
      const interaction = interactionById.get(step.targetId);
      if (!interaction) throw new Error(`交互步骤引用了未知意图目标：${step.targetId}`);
      addUniqueTarget(targets, {
        id: step.targetId,
        kind: "interaction",
        fields: {
          "interaction.trigger": interaction.trigger,
          "interaction.expectedEffect": interaction.expectedEffect,
        },
      });
    }
  }
  return { targets: [...targets.values()] };
}

/** 拒绝不同意图类型复用同一目标 ID，避免后续人工锁产生歧义。 */
function addUniqueTarget(
  targets: Map<string, PlanningIntent["targets"][number]>,
  target: PlanningIntent["targets"][number],
): void {
  const existing = targets.get(target.id);
  if (existing && existing.kind !== target.kind) {
    throw new Error(`计划意图目标 ID 在不同类型间重复：${target.id}`);
  }
  targets.set(target.id, target);
}
