/** 在固定 Artifact 根目录安全保存并按任务所有权读取交付验收 PNG 证据。 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { z } from "zod";

const maximumEvidenceBytes = 5 * 1024 * 1024;
const maximumMetadataBytes = 16 * 1024;
const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const storedReferenceSchema = z.object({
  taskId: uuidSchema,
  patchSetHash: sha256Schema,
  reference: z.object({
    evidenceId: uuidSchema,
    kind: z.enum(["actual", "difference"]),
    mimeType: z.literal("image/png"),
    byteSize: z.number().int().positive().max(maximumEvidenceBytes),
    sha256: sha256Schema,
    width: z.number().int().positive().max(1920),
    height: z.number().int().positive().max(1200),
  }),
});

/** 使用 UUID 文件名、哈希和 no-follow 读取保护交付验收图片。 */
export class FileDeliveryEvidenceStore implements D2CAgent.DeliveryEvidenceStore {
  private readonly artifactRootDirectory: string;
  private readonly rootDirectory: string;

  /** 将所有证据限定在宿主配置的 Artifact 根目录子目录。 */
  constructor(artifactRoot: string) {
    this.artifactRootDirectory = resolve(artifactRoot);
    this.rootDirectory = join(this.artifactRootDirectory, "delivery-evidence");
  }

  /** 原子保存一张不超过 5 MiB 的真实 PNG 和对应所有权元数据。 */
  async write(input: D2CAgent.DeliveryEvidenceWriteInput): Promise<D2CAgent.DeliveryEvidenceReference> {
    const taskId = uuidSchema.parse(input.taskId);
    const patchSetHash = sha256Schema.parse(input.patchSetHash);
    validateDimensions(input.width, input.height);
    const data = Buffer.from(input.data);
    if (data.length === 0 || data.length > maximumEvidenceBytes) {
      throw new Error("交付验收图片必须位于 1 Byte 到 5 MiB 之间。");
    }
    if (!data.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error("交付验收证据不是有效 PNG 文件。");
    }
    const evidenceId = randomUUID();
    const reference: D2CAgent.DeliveryEvidenceReference = {
      evidenceId,
      kind: input.kind,
      mimeType: "image/png",
      byteSize: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      width: input.width,
      height: input.height,
    };
    const taskDirectory = await this.ensureTaskDirectory(taskId);
    const imagePath = join(taskDirectory, `${evidenceId}.png`);
    const metadataPath = join(taskDirectory, `${evidenceId}.json`);
    const temporaryImage = join(taskDirectory, `.${evidenceId}.png.tmp`);
    const temporaryMetadata = join(taskDirectory, `.${evidenceId}.json.tmp`);
    await writeFile(temporaryImage, data, { flag: "wx", mode: 0o600 });
    try {
      await writeFile(temporaryMetadata, JSON.stringify({
        taskId,
        patchSetHash,
        reference,
      }), { flag: "wx", mode: 0o600 });
      await rename(temporaryImage, imagePath);
      await rename(temporaryMetadata, metadataPath);
    } catch (error: unknown) {
      await rm(temporaryImage, { force: true });
      await rm(temporaryMetadata, { force: true });
      await rm(imagePath, { force: true });
      throw error;
    }
    return structuredClone(reference);
  }

  /** 校验任务所有权、普通文件、大小和哈希后读取一张证据。 */
  async read(taskIdInput: string, evidenceIdInput: string): Promise<D2CAgent.DeliveryEvidenceReadResult> {
    const taskId = uuidSchema.parse(taskIdInput);
    const evidenceId = uuidSchema.parse(evidenceIdInput);
    const taskDirectory = await this.requireTaskDirectory(taskId);
    const metadataPath = join(taskDirectory, `${evidenceId}.json`);
    const metadataHandle = await open(
      metadataPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let metadataText: string;
    try {
      const metadataStats = await metadataHandle.stat();
      if (!metadataStats.isFile() || metadataStats.size < 1
        || metadataStats.size > maximumMetadataBytes) {
        throw new Error("交付验收证据元数据必须是大小受限的普通文件。");
      }
      metadataText = await metadataHandle.readFile("utf8");
    } finally {
      await metadataHandle.close();
    }
    const metadata = storedReferenceSchema.parse(JSON.parse(metadataText));
    if (metadata.taskId !== taskId || metadata.reference.evidenceId !== evidenceId) {
      throw new Error("交付验收证据所有权或文件名不匹配。");
    }
    const handle = await open(join(taskDirectory, `${evidenceId}.png`), constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: Buffer;
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size !== metadata.reference.byteSize) {
        throw new Error("交付验收图片大小与元数据不一致。");
      }
      data = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (createHash("sha256").update(data).digest("hex") !== metadata.reference.sha256) {
      throw new Error("交付验收图片哈希与元数据不一致。");
    }
    return { reference: structuredClone(metadata.reference), data };
  }

  /** 删除一个精确 UUID 任务目录；任务不存在时保持幂等。 */
  async discardTask(taskIdInput: string): Promise<void> {
    const taskId = uuidSchema.parse(taskIdInput);
    await this.ensureRootDirectory();
    try {
      const taskDirectory = await this.requireTaskDirectory(taskId);
      await rm(taskDirectory, { recursive: true });
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  /** 创建并校验根目录和精确任务目录，不跟随预先放置的符号链接。 */
  private async ensureTaskDirectory(taskId: string): Promise<string> {
    await this.ensureRootDirectory();
    const taskDirectory = join(this.rootDirectory, taskId);
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 });
    return this.requireTaskDirectory(taskId);
  }

  /** 创建并校验 Artifact 根和证据子目录，拒绝根节点被符号链接替换。 */
  private async ensureRootDirectory(): Promise<string> {
    await mkdir(this.artifactRootDirectory, { recursive: true, mode: 0o700 });
    const artifactRoot = await this.requireSafeDirectory(this.artifactRootDirectory);
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const rootDirectory = await this.requireSafeDirectory(this.rootDirectory);
    if (rootDirectory !== join(artifactRoot, "delivery-evidence")) {
      throw new Error("交付验收证据根目录解析位置不安全。");
    }
    return rootDirectory;
  }

  /** 返回通过普通目录和规范路径校验的任务目录。 */
  private async requireTaskDirectory(taskId: string): Promise<string> {
    const rootDirectory = await this.requireRootDirectory();
    const taskDirectory = join(this.rootDirectory, taskId);
    const resolvedTaskDirectory = await this.requireSafeDirectory(taskDirectory);
    if (resolvedTaskDirectory !== join(rootDirectory, taskId)) {
      throw new Error("交付验收任务证据目录解析位置不安全。");
    }
    return resolvedTaskDirectory;
  }

  /** 校验已存在的 Artifact 根和证据子目录仍保持原始父子关系。 */
  private async requireRootDirectory(): Promise<string> {
    const artifactRoot = await this.requireSafeDirectory(this.artifactRootDirectory);
    const rootDirectory = await this.requireSafeDirectory(this.rootDirectory);
    if (rootDirectory !== join(artifactRoot, "delivery-evidence")) {
      throw new Error("交付验收证据根目录解析位置不安全。");
    }
    return rootDirectory;
  }

  /** 拒绝符号链接和非目录，并返回规范真实路径。 */
  private async requireSafeDirectory(path: string): Promise<string> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("交付验收证据目录不安全。");
    }
    return realpath(path);
  }
}

/** 校验图片视口不会突破公开协议和渲染上限。 */
function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width < 1 || width > 1920
    || !Number.isInteger(height) || height < 1 || height > 1200) {
    throw new Error("交付验收图片尺寸超出允许范围。");
  }
}

/** 判断未知异常是否为指定 Node.js 文件系统错误。 */
function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
