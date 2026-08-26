/** 提供单视图 D2C Webview 本地开发使用的安全 Fixture。 */

import type { D2CWorkflowSnapshot, TaskWorkflowViewModel } from "@ui-forge/shared-protocol";

/** Fixture 首步设计检查返回的 SVG data URL。 */
export const fixturePreviewUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjI0IiB5PSI0OCI+5a6i5oi35YiX6KGoPC90ZXh0Pjwvc3ZnPg==";

/** 创建符合当前单视图协议的展示模型。 */
export function createTaskWorkflowFixture(): TaskWorkflowViewModel {
  return {
    setup: {
      projectPath: "/workspace/demo",
      taskGoal: "请结合当前项目，根据 MasterGo 设计「客户列表」生成整体修改方案。",
      designUrl: "https://mastergo.com/file/demo?layer_id=1:2",
      designSummary: {
        name: "客户列表",
        nodeId: "1:2",
        nodeName: "客户列表",
        regionCount: 1,
        nodeCount: 10,
        tokenCount: 1,
        preview: { url: fixturePreviewUrl, width: 320, height: 180 },
        structurePreview: null,
        designData: null,
        warnings: [],
      },
    },
    svg: {
      taskGoal: "请结合当前项目，根据 MasterGo 设计「客户列表」生成整体修改方案。",
      statusMessage: "已生成待确认的设计预览。",
      tools: [],
    },
    conversation: {
      initialUserMessage: "请结合当前项目，根据 MasterGo 设计「客户列表」生成整体修改方案。",
      planStatus: "idle",
      projectValidation: null,
      designComponentRecognition: null,
      plan: null,
    },
    codeGeneration: { status: "idle" },
  };
}

/** 创建本地开发默认的 Design URL 待输入快照。 */
export function createTaskWorkflowSnapshot(): D2CWorkflowSnapshot {
  const viewModel = createTaskWorkflowFixture();
  return {
    taskId: "00000000-0000-4000-8000-000000000001",
    revision: 0,
    status: "draft",
    viewModel: {
      ...viewModel,
      setup: { ...viewModel.setup, designUrl: "", designSummary: null },
      svg: { ...viewModel.svg, statusMessage: "", tools: [] },
    },
  };
}
