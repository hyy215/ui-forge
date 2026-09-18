/** 浏览器只读预览任务文件；文本不作为 HTML 执行，文件流不进入会话消息。 */
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import type { FastifyInstance } from "fastify";
import { sessionFileInputSchema, sessionFileRoute } from "@ui-forge/shared-protocol";
import type { SessionFileService } from "../files/sessionFileService.js";

/** 图片直接预览，Markdown、代码及其他输出以原文打开。 */
export function registerSessionFileRoute(app: FastifyInstance, files: SessionFileService): void {
  app.get(sessionFileRoute, async (request, reply) => {
    reply.headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "referrer-policy": "no-referrer",
    });
    if (request.headers["sec-fetch-site"] === "cross-site")
      return reply.code(403).type("text/plain; charset=utf-8").send("仅允许本机页面打开任务文件。");
    const input = sessionFileInputSchema.safeParse(request.query);
    if (!input.success)
      return reply
        .code(400)
        .type("text/plain; charset=utf-8")
        .send("文件链接无效，缺少任务标识或路径。");
    try {
      const file = await files.resolve(input.data);
      const mediaTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };
      reply.type(mediaTypes[extname(file.path).toLowerCase()] ?? "text/plain; charset=utf-8");
      reply.header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(basename(file.path)).replaceAll("'", "%27")}`,
      );
      return reply.send(createReadStream(file.path));
    } catch (error) {
      return reply
        .code(404)
        .type("text/plain; charset=utf-8")
        .send(error instanceof Error ? error.message : "文件无法打开。");
    }
  });
}
