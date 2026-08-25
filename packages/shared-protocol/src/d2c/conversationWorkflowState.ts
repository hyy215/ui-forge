/** 定义 Conversation 页面可从权威任务恢复的持久状态。 */
import { z } from "zod";

export const conversationD2CWorkflowStateSchema = z.object({
  phase: z.literal("conversation"),
  status: z.enum(["design_confirmed", "analysis_ready"]),
});

export type ConversationD2CWorkflowState = z.infer<typeof conversationD2CWorkflowStateSchema>;
