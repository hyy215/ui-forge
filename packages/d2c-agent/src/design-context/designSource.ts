/** 定义不绑定具体供应商的设计来源标识。 */

/** 使用稳定 Provider 标识和不透明引用描述任意设计来源。 */
export interface DesignSource {
  provider: string;
  reference: string;
}
