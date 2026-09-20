/** 新建与后续对话共用的浏览器图片读取，文件仅在用户发送时上传。 */
import type { CreateSessionInput } from "@ui-forge/shared-protocol";

/** 仅读取用户选择的 PNG、JPEG、WebP；读取失败或超限时拒绝整个文件。 */
export async function readImage(file: File): Promise<CreateSessionInput["images"][number]> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error("请使用不超过 5 MiB 的 PNG、JPEG 或 WebP 图片。");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.onabort = () => reject(new Error("图片读取已取消。"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve({ name: file.name, dataUrl: reader.result })
        : reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}
