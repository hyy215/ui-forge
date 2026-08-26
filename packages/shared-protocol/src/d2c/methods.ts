/** 定义 D2C 工作流跨不同传输方式复用的稳定方法名称。 */

export const d2cWorkflowMethods = {
  initialize: "ui-forge.d2c.initialize",
  getSnapshot: "ui-forge.d2c.get-snapshot",
  listTasks: "ui-forge.d2c.list-tasks",
  renameTask: "ui-forge.d2c.rename-task",
  archiveTask: "ui-forge.d2c.archive-task",
  restoreTask: "ui-forge.d2c.restore-task",
  deleteTask: "ui-forge.d2c.delete-task",
  inspectDesign: "ui-forge.d2c.inspect-design",
  confirmDesign: "ui-forge.d2c.confirm-design",
  getDesignDataIndex: "ui-forge.d2c.get-design-data-index",
  getDesignDataSection: "ui-forge.d2c.get-design-data-section",
  getDeliveryEvidence: "ui-forge.d2c.get-delivery-evidence",
  streamConversation: "ui-forge.d2c.stream-conversation",
  cancelConversation: "ui-forge.d2c.cancel-conversation",
  approvePlan: "ui-forge.d2c.approve-plan",
  approveDeliveryCommands: "ui-forge.d2c.approve-delivery-commands",
  streamCodeGeneration: "ui-forge.d2c.stream-code-generation",
  cancelCodeGeneration: "ui-forge.d2c.cancel-code-generation",
  reset: "ui-forge.d2c.reset",
} as const;

/** D2C 工作流支持的通信方法。 */
export type D2CWorkflowMethod = typeof d2cWorkflowMethods[keyof typeof d2cWorkflowMethods];
