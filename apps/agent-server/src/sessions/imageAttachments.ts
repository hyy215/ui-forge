/** 将用户明确上传的设计图片保存为私有附件，文件名完全由服务生成。 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CreateSessionInput } from "@ui-forge/shared-protocol";

/** 校验图片编码、大小和文件签名后保存，原始名称不参与路径拼接。 */
export async function saveImageAttachments(
  root: string,
  images: CreateSessionInput["images"],
): Promise<string[]> {
  const decoded = images.map(({ dataUrl }) => {
    const comma = dataUrl.indexOf(",");
    const data = Buffer.from(dataUrl.slice(comma + 1), "base64");
    const mime = dataUrl.slice(11, dataUrl.indexOf(";"));
    const valid =
      mime === "png"
        ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "jpeg"
          ? data[0] === 255 && data[1] === 216 && data[2] === 255
          : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    if (!valid || data.length > 5 * 1024 * 1024) throw new Error("设计图片格式无效或超过 5 MiB。");
    return { data, mime };
  });
  if (!decoded.length) return [];
  const directory = join(root, "attachments");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return Promise.all(
    decoded.map(async ({ data, mime }) => {
      const path = join(directory, `${randomUUID()}.${mime}`);
      await writeFile(path, data, { flag: "wx", mode: 0o600 });
      return path;
    }),
  );
}
