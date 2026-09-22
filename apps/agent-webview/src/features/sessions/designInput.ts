/** 将表单草稿转换为显式设计来源；不检查网络，也不启动任务。 */
import { designSourceSchema, type DesignSource } from "@ui-forge/shared-protocol";

/** MasterGo 草稿保留未选择接入的状态，禁止隐式使用 Vibe 或 Magic。 */
export interface MasterGoDraft {
  url: string;
  connection: "magic" | "vibe" | null;
  endpoint: string;
  statusEndpoint: string;
}

/** 仅校验用户明确选择的来源，返回可发送到服务端的白名单结构。 */
export function readDesignSource(kind: DesignSource["kind"], draft: MasterGoDraft): DesignSource {
  if (kind === "local") return { kind: "local" };
  if (!draft.connection) throw new Error("请选择 MasterGo 接入方式。");
  const result = designSourceSchema.safeParse({
    kind,
    url: draft.url.trim(),
    connection:
      draft.connection === "magic"
        ? { kind: "magic" }
        : {
            kind: "vibe",
            endpoint: draft.endpoint.trim(),
            statusEndpoint: draft.statusEndpoint.trim(),
          },
  });
  if (!result.success) {
    const endpointIssue = result.error.issues.some((issue) => issue.path.includes("connection"));
    throw new Error(
      endpointIssue
        ? "Vibe 地址须为无凭据、无查询参数的本机 HTTP 地址。"
        : "请输入完整的 MasterGo HTTPS 文件或图层链接。",
    );
  }
  return result.data;
}
