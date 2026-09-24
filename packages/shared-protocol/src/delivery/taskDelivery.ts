/** 定义独立于任务执行状态的交付声明、证据核对与源码清单展示协议。 */
import { z } from "zod";
import { sessionIdSchema } from "../sessions/sessionProtocol.js";

/** 读取交付记录，不恢复线程或执行验收命令。 */
export const deliveryMethods = { read: "ui-forge.delivery.read" } as const;
/** 交付查询只接受已登记的任务标识。 */
export const readTaskDeliverySchema = sessionIdSchema;
const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const filePath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** 报告作者声明的结论，不代表服务端独立验收通过。 */
export const deliveryDeclaredStatusSchema = z.enum(["passed", "failed", "blocked", "not-verified"]);
/** 文件需附内容指纹；原生工具引用只在本任务主线程中核对。 */
const deliveryEvidenceObjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("file"), path: filePath, sha256 }),
  z.strictObject({ kind: z.literal("native"), turnId: identifier, itemId: identifier }),
  z.strictObject({
    kind: z.literal("legacy"),
    path: filePath,
  }),
]);
/** 兼容旧任务写入的裸路径，但这类证据只允许展示为未核验。 */
export const deliveryEvidenceSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") return { kind: "legacy", path: value };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      const description = record.description;
      if (
        keys.every((key) => key === "path" || key === "description") &&
        typeof record.path === "string" &&
        (description === undefined ||
          (typeof description === "string" && description.length <= 4000))
      ) {
        return { kind: "legacy", path: record.path };
      }
    }
    return value;
  },
  deliveryEvidenceObjectSchema,
);
/** Codex 可写入的任务专属报告；缺失的验证必须显式保留。 */
export const deliveryManifestSchema = z
  .strictObject({
    version: z.literal(1),
    taskId: identifier,
    generatedAt: z.iso.datetime(),
    summary: z.string().max(4000),
    sourceFiles: z.array(z.strictObject({ path: filePath, sha256 })).max(256),
    checks: z
      .array(
        z.strictObject({
          id: identifier,
          category: z.enum([
            "build",
            "interaction",
            "visual",
            "performance",
            "review",
            "other",
          ]),
          title: z.string().min(1).max(200),
          declaredStatus: deliveryDeclaredStatusSchema,
          details: z.string().max(4000),
          evidence: z.array(deliveryEvidenceSchema).max(16),
        }),
      )
      .min(1)
      .max(64),
  })
  .superRefine((report, context) => {
    if (new Set(report.checks.map((check) => check.id)).size !== report.checks.length) {
      context.addIssue({ code: "custom", message: "Duplicate check IDs", path: ["checks"] });
    }
    if (new Set(report.sourceFiles.map((file) => file.path)).size !== report.sourceFiles.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate source paths",
        path: ["sourceFiles"],
      });
    }
  });
/** 服务端仅报告文件与工具的实际可核对事实，不推导业务通过。 */
export const deliveryEvidenceResultSchema = z.strictObject({
  checkId: identifier,
  index: z.number().int().nonnegative(),
  state: z.enum([
    "matched",
    "changed",
    "missing",
    "outside-scope",
    "unavailable",
    "unsupported",
    "incomplete",
    "failed",
    "succeeded",
  ]),
  resolvedPath: filePath.nullable(),
  exitCode: z.number().int().nullable(),
});
/** 当前文件与报告清单的比较；空清单或读取失败不能推断一致。 */
export const deliverySourceResultSchema = z.strictObject({
  state: z.enum(["matches", "stale", "unverifiable"]),
  manifestFingerprint: sha256.nullable(),
  files: z
    .array(
      z.strictObject({
        path: filePath,
        state: z.enum(["matched", "changed", "missing", "outside-scope", "unavailable"]),
      }),
    )
    .max(256),
});
/** 每次只读查询重新核对文件；保留报告原结论且不输出整体通过字段。 */
export const taskDeliverySchema = z.strictObject({
  version: z.literal(1),
  taskId: identifier,
  checkedAt: z.iso.datetime(),
  availability: z.enum(["available", "missing", "invalid"]),
  issue: z
    .enum(["invalid-report", "identity-mismatch", "outside-scope", "unreadable", "too-large"])
    .nullable(),
  report: deliveryManifestSchema.nullable(),
  reportSha256: sha256.nullable(),
  source: deliverySourceResultSchema,
  evidence: z.array(deliveryEvidenceResultSchema).max(1024),
  history: z.enum(["not-requested", "available", "unavailable"]),
});
/** 任务专属磁盘报告，由运行时校验后再展示。 */
export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
/** 声明中的证据引用；legacy 仅表示兼容读取的未核验路径。 */
export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;
/** 只读交付查询结果。 */
export type TaskDelivery = z.infer<typeof taskDeliverySchema>;
/** 文件或原生工具证据的实际核对结果。 */
export type DeliveryEvidenceResult = z.infer<typeof deliveryEvidenceResultSchema>;
