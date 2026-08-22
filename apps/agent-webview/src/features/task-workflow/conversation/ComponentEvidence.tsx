/** 展示单个设计组件候选的完整审计依据。 */

import type { DesignComponentRecognition } from "@ui-forge/shared-protocol";
import { formatDesignComponentType } from "./deterministicConclusion";

/** 展示单个候选的完整审计依据，默认由所属折叠面板隐藏。 */
export function ComponentEvidence({
  component,
}: { component: DesignComponentRecognition["components"][number] }) {
  return <div className="component-recognition-evidence">
    {component.resolutionReason ? <p><strong>最终原因</strong>{component.resolutionReason}</p> : null}
    {component.typeHint ? <p><strong>目录弱提示</strong>
      {formatDesignComponentType(component.typeHint.typeId)}（命中“{component.typeHint.matchedAlias}”）
    </p> : null}
    <div><strong>Tool 客观证据 · {formatEvidenceStrength(component.evidenceStrength)}</strong>
      <ul>{component.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
    </div>
    {component.visualSuggestion ? <div><strong>视觉 Subagent 证据</strong>
      <ul>{component.visualSuggestion.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
    </div> : null}
  </div>;
}

/** 将候选证据等级转换为用户可读文字。 */
function formatEvidenceStrength(strength: "explicit" | "structural" | "weak"): string {
  switch (strength) {
    case "explicit": return "显式来源组件";
    case "structural": return "结构模式";
    case "weak": return "弱证据";
  }
}
