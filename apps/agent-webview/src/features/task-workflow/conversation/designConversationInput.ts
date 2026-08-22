/** 对单视图对话输入做确定性分类，避免用模型猜测设计确认意图。 */

/** 用户确认右侧设计预览时必须输入的唯一口令。 */
export const designConfirmationCommand = "确认设计";

/** 对话输入在当前设计阶段中的确定性含义。 */
export type DesignConversationSubmission =
  | { kind: "empty" }
  | { kind: "inspect-design"; reference: string }
  | { kind: "confirm-design" }
  | { kind: "invalid-confirmation" };

/** 根据设计是否就绪分类输入，仅允许精确口令触发后续分析。 */
export function classifyDesignConversationSubmission(
  designReady: boolean,
  input: string,
): DesignConversationSubmission {
  const normalizedInput = input.trim();
  if (!normalizedInput) return { kind: "empty" };
  if (!designReady) return { kind: "inspect-design", reference: normalizedInput };
  if (normalizedInput === designConfirmationCommand) return { kind: "confirm-design" };
  return { kind: "invalid-confirmation" };
}
