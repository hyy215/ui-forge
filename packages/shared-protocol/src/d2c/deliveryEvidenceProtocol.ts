/** 定义按任务所有权读取自动交付验收图片的通信协议。 */

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** 校验交付验收图片的轻量引用。 */
export const deliveryEvidenceReferenceSchema = z.object({
  evidenceId: z.string().uuid(),
  kind: z.enum(["actual", "difference"]),
  mimeType: z.literal("image/png"),
  byteSize: z.number().int().positive().max(5 * 1024 * 1024),
  sha256: sha256Schema,
  width: z.number().int().positive().max(1920),
  height: z.number().int().positive().max(1200),
});

/** 校验按任务与证据标识读取图片所需参数。 */
export const getDeliveryEvidenceInputSchema = z.object({
  taskId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  projectPath: z.string().optional(),
});

/** 校验 Server 返回的有大小上限 PNG Data URL。 */
export const deliveryEvidenceImageSchema = z.object({
  reference: deliveryEvidenceReferenceSchema,
  dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).max(7 * 1024 * 1024),
});

/** 读取一张交付验收图片所需参数。 */
export type GetDeliveryEvidenceInput = z.infer<typeof getDeliveryEvidenceInputSchema>;
/** Webview 可以安全展示的一张交付验收图片。 */
export type DeliveryEvidenceImage = z.infer<typeof deliveryEvidenceImageSchema>;
