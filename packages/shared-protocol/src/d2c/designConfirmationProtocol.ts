/** 定义持久化设计确认命令的数据形状，精确口令由领域层校验。 */
import { z } from "zod";
import { d2cTaskCommandInputSchema } from "./commonProtocol.js";

export const confirmD2CDesignInputSchema = d2cTaskCommandInputSchema.extend({
  confirmation: z.string().min(1),
});

export type ConfirmD2CDesignInput = z.infer<typeof confirmD2CDesignInputSchema>;
