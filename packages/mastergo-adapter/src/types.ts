/** 定义并校验 MasterGo Adapter 保存的外部原始载荷，不向 D2C Agent 泄漏 MCP DSL。 */

import { z } from "zod";

/** 校验实时 MasterGo 或脱敏本地捕获样本的来源信息。 */
export const rawDesignSourceSchema = z.object({
  kind: z.enum(["fixture", "mastergo"]),
  reference: z.string().min(1),
});

/** 校验 MCP 分段目录和逐段 DSL 组成的原始设计载荷。 */
export const rawDesignPayloadSchema = z.object({
  source: rawDesignSourceSchema,
  sectionList: z.record(z.string(), z.unknown()),
  sections: z.array(z.record(z.string(), z.unknown())),
});

/** 标识原始载荷来自实时 MasterGo 或脱敏后的本地捕获样本。 */
export type RawDesignSource = z.infer<typeof rawDesignSourceSchema>;

/** 描述 MasterGo MCP 能够实时读取的设计引用。 */
export interface MasterGoDesignSource {
  kind: "mastergo";
  reference: string;
}

/** 保存 MCP 返回且已完成协议校验的原始设计分段。 */
export type RawDesignPayload = z.infer<typeof rawDesignPayloadSchema>;
