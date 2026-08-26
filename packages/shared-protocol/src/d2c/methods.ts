/** 定义 D2C 工作流跨不同传输方式复用的稳定方法名称。 */

export const d2cWorkflowMethods = {
  initialize: "ui-forge.d2c.initialize",
  getSnapshot: "ui-forge.d2c.get-snapshot",
  inspectDesign: "ui-forge.d2c.inspect-design",
  confirmDesign: "ui-forge.d2c.confirm-design",
  getDesignDataIndex: "ui-forge.d2c.get-design-data-index",
  getDesignDataSection: "ui-forge.d2c.get-design-data-section",
  streamConversation: "ui-forge.d2c.stream-conversation",
  cancelConversation: "ui-forge.d2c.cancel-conversation",
  streamCodeGeneration: "ui-forge.d2c.stream-code-generation",
  cancelCodeGeneration: "ui-forge.d2c.cancel-code-generation",
  reset: "ui-forge.d2c.reset",
} as const;

/** D2C 工作流支持的通信方法。 */
export type D2CWorkflowMethod = typeof d2cWorkflowMethods[keyof typeof d2cWorkflowMethods];
