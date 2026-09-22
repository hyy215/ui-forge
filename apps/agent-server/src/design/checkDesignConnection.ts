/** 将平台连接检查收敛为公开的来源与目标身份，不创建任务或返回设计正文。 */
import {
  checkMagicConnection,
  checkVibeConnection,
  parseMasterGoTarget,
} from "@ui-forge/codex-client";
import {
  designConnectionCheckSchema,
  designSourceSchema,
  type DesignConnectionCheck,
  type DesignSource,
} from "@ui-forge/shared-protocol";

/** 检查显式选择的接入；local 完全不查询设计平台，Vibe 必须与 URL 文件和页面一致。 */
export async function checkDesignConnection(source: DesignSource): Promise<DesignConnectionCheck> {
  const selected = designSourceSchema.parse(source);
  if (selected.kind === "local") return { source: selected, tools: [] };
  if (selected.connection.kind === "magic") {
    const { tools, serverVersion } = await checkMagicConnection();
    let target: ReturnType<typeof parseMasterGoTarget> | undefined;
    try {
      target = parseMasterGoTarget(selected.url);
    } catch {
      // Magic 仍支持没有图层参数的文件链接；只有 Vibe 必须绑定具体节点。
    }
    return designConnectionCheckSchema.parse({
      source: selected,
      ...(target ? { target } : {}),
      tools,
      serverVersion,
    });
  }
  const target = parseMasterGoTarget(selected.url);
  const result = await checkVibeConnection(selected.connection);
  if (target.documentId !== result.documentId || (target.pageId && target.pageId !== result.pageId))
    throw new Error("Vibe 当前文件或页面与设计链接不一致，请先打开对应画布。");
  return designConnectionCheckSchema.parse({
    source: selected,
    target: { ...target, pageId: result.pageId },
    tools: result.tools,
    serverVersion: result.serverVersion,
  });
}
