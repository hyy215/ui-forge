/** 将通用设计来源按 Provider 标识路由到已注册的具体 Adapter。 */

import type {
  DesignContextResolver,
  DesignSourceAdapter,
} from "./designSourceAdapter.js";
import type { DesignInspection } from "./designInspection.js";
import type { DesignSource } from "./designSource.js";

/** 从一组互不重名的设计 Adapter 创建运行时设计来源解析器。 */
export function createDesignContextResolver(
  adapters: readonly DesignSourceAdapter[],
): DesignContextResolver {
  return new RegisteredDesignContextResolver(adapters);
}

/** 校验 Adapter 注册并按来源 Provider 执行确定性分派。 */
class RegisteredDesignContextResolver implements DesignContextResolver {
  private readonly adapters: ReadonlyMap<string, DesignSourceAdapter>;

  /** 校验 Adapter 标识非空且唯一，并建立不可变的 Provider 路由表。 */
  constructor(adapters: readonly DesignSourceAdapter[]) {
    const entries = adapters.map((adapter): readonly [string, DesignSourceAdapter] => {
      const id = adapter.id.trim();
      if (!id) throw new Error("设计来源 Adapter 必须声明非空 id。");
      return [id, adapter];
    });
    this.adapters = new Map(entries);
    if (this.adapters.size !== entries.length) throw new Error("设计来源 Adapter id 不能重复。");
  }

  /** 按来源 Provider 选择 Adapter，并将不可信引用交给具体实现检查。 */
  async inspect(source: DesignSource): Promise<DesignInspection> {
    const adapter = this.adapters.get(source.provider);
    if (!adapter) throw new Error(`不支持的设计来源：${source.provider}`);
    return adapter.inspect(source.reference);
  }
}
