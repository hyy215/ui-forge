/** 定义持久化设计确认命令的精确协议。 */
import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";

export const confirmD2CDesignInputSchema = d2cTaskCommandInputSchema.extend({
  confirmation: z.literal("确认设计"),
});

export type ConfirmD2CDesignInput = z.infer<typeof confirmD2CDesignInputSchema>;
