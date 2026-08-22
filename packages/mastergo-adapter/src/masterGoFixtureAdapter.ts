/** 将显式登记或固定默认的 MasterGo 捕获样本作为受限测试设计来源。 */

import { readFile } from "node:fs/promises";
import type { D2CAgent } from "@ui-forge/d2c-agent";
import { writeMasterGoDesignArtifact } from "./masterGoDesignArtifact.js";
import { createMasterGoHighFidelityPreview } from "./masterGoHighFidelityPreview.js";
import { MasterGoMcpAdapter } from "./masterGoMcpAdapter.js";
import { rawDesignPayloadSchema, type RawDesignPayload } from "./types.js";

/** 配置测试引用白名单、可选固定默认样本及可替换标准化器。 */
export interface MasterGoFixtureAdapterOptions {
  fixtures: Readonly<Record<string, string>>;
  defaultFixture?: string;
  normalizer?: Pick<MasterGoMcpAdapter, "normalize">;
  artifactWriter?: D2CAgent.DesignArtifactWriter;
}

/** 读取登记或固定默认的真实 MasterGo 捕获数据并复用生产标准化逻辑。 */
export class MasterGoFixtureAdapter implements D2CAgent.DesignSourceAdapter {
  /** 在设计来源注册表中选择测试 MasterGo 数据的稳定标识。 */
  readonly id = "mastergo-fixture";

  private readonly fixtures: ReadonlyMap<string, string>;
  private readonly defaultFixture: string | undefined;
  private readonly normalizer: Pick<MasterGoMcpAdapter, "normalize">;
  private readonly artifactWriter: D2CAgent.DesignArtifactWriter | undefined;

  /** 创建不会把客户端引用解释为文件路径的测试来源 Adapter。 */
  constructor(options: MasterGoFixtureAdapterOptions) {
    this.fixtures = new Map(Object.entries(options.fixtures));
    this.defaultFixture = options.defaultFixture;
    this.normalizer = options.normalizer ?? new MasterGoMcpAdapter();
    this.artifactWriter = options.artifactWriter;
  }

  /** 根据登记引用或固定默认样本读取、校验并标准化捕获数据。 */
  async inspect(reference: string): Promise<D2CAgent.DesignInspection> {
    const fixturePath = this.fixtures.get(reference) ?? this.defaultFixture;
    if (!fixturePath) throw new Error(`未登记的 MasterGo 测试设计：${reference}`);
    const payload = await this.readPayload(reference, fixturePath);
    const normalized = await this.normalizer.normalize(payload);
    const preview = createMasterGoHighFidelityPreview(payload, []);
    const context = preview ? { ...normalized, preview } : normalized;
    const fixtureContext = this.toFixtureContext(context, reference);
    const artifact = await writeMasterGoDesignArtifact(this.artifactWriter, payload, fixtureContext);
    return {
      context: fixtureContext,
      provenance: {
        provider: "MasterGo Fixture",
        transport: "fixture",
        operations: ["readFixture", "normalizeDesign"],
      },
      ...(artifact ? { artifact } : {}),
    };
  }

  /** 从白名单解析出的固定路径读取并运行时校验不可信 JSON。 */
  private async readPayload(reference: string, fixturePath: string): Promise<RawDesignPayload> {
    const content = await readFile(fixturePath, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new Error(`MasterGo 测试设计不是有效 JSON：${reference}`);
    }
    const result = rawDesignPayloadSchema.safeParse(value);
    if (!result.success) throw new Error(`MasterGo 测试设计格式无效：${reference}`);
    return result.data;
  }

  /** 将捕获文件的原始来源替换为 Runtime 实际选择的测试 Provider。 */
  private toFixtureContext(
    context: D2CAgent.DesignContext,
    reference: string,
  ): D2CAgent.DesignContext {
    return {
      ...context,
      source: { provider: this.id, reference },
    };
  }
}
