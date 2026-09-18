/** 通过 codex-client 读取与保存真实规则文件，串行保存并检测编辑冲突。 */
import { createHash } from "node:crypto";
import { instructionPath, readInstructions, saveInstructions } from "@ui-forge/codex-client";
import type { InstructionDocument, InstructionKind } from "@ui-forge/shared-protocol";

/** 两份文件的可注入读写边界；生产默认使用包内文件。 */
export interface InstructionFiles {
  path(kind: InstructionKind): string;
  read(kind: InstructionKind): Promise<string>;
  save(kind: InstructionKind, content: string): Promise<void>;
}
/** 配置服务只操作固定文件，不改变 Codex 权限。 */
export class InstructionService {
  private writing: Promise<unknown> = Promise.resolve();
  /** 测试可注入临时文件，生产直接调用 codex-client。 */
  constructor(
    private readonly files: InstructionFiles = {
      path: instructionPath,
      read: readInstructions,
      save: saveInstructions,
    },
  ) {}
  /** 每次从磁盘读取最新内容。 */
  async read(kind: InstructionKind): Promise<InstructionDocument> {
    const content = await this.files.read(kind);
    return {
      kind,
      content,
      path: this.files.path(kind),
      revision: createHash("sha256").update(content).digest("hex"),
    };
  }
  /** 旧版本保存被拒绝，调用方应保留编辑并重新加载。 */
  save(kind: InstructionKind, content: string, revision: string): Promise<InstructionDocument> {
    const operation = this.writing.then(async () => {
      if ((await this.read(kind)).revision !== revision)
        throw new Error("文件已被其他页面或编辑器修改，请保留当前编辑并重新加载后合并。");
      await this.files.save(kind, content);
      return this.read(kind);
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
}
