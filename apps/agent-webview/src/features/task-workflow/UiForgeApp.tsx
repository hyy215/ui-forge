/** 组合设计读取、方案授权、代码生成与受控应用能力的单视图工作台。 */

import type { D2CWorkflowSnapshot } from "@ui-forge/shared-protocol";
import type { TaskWorkflowDataSource } from "../../data-sources/task-workflow";
import { ConversationStage } from "./conversation/ConversationStage";
import { useTaskWorkflow } from "./model/useTaskWorkflow";
import "./task-workflow.css";

/** D2C 工作流页面参数。 */
export interface UiForgeAppProps {
  dataSource: TaskWorkflowDataSource;
  initialSnapshot: D2CWorkflowSnapshot;
}

/** 渲染单一对话视图，并把一次 Plan 授权串联到自动生成与安全落盘。 */
export function UiForgeApp({ dataSource, initialSnapshot }: UiForgeAppProps) {
  const workflow = useTaskWorkflow(dataSource, initialSnapshot);
  const { snapshot, commandError, isInspectingDesign } = workflow;

  return (
    <main className="app-shell">
      <div className="workbench">
        <nav className="stage-strip" aria-label="任务阶段">
          <div className="stage-strip-title"><strong>交付进度</strong></div>
          <div className="stage-strip-item stage-strip-item--active">
            <span className="stage-number">1</span>
            <div><strong>生成前端视图</strong><small>设计确认与方案审阅</small></div>
          </div>
        </nav>
        <div className="workspace-column">
          <div className="main-panel">
            <ConversationStage
              setup={snapshot.viewModel.setup}
              taskId={snapshot.taskId}
              dataSource={dataSource}
              tools={snapshot.viewModel.svg.tools}
              conversation={workflow.conversation}
              commandError={commandError}
              designConfirmed={workflow.designConfirmed}
              isInspectingDesign={isInspectingDesign}
              onInspectDesign={(designUrl) => void workflow.inspectDesign(designUrl)}
              onConfirmDesign={workflow.confirmDesign}
              onReset={() => void workflow.reset()}
              onRetryStream={workflow.retryConversationStream}
              onStopConversation={() => void workflow.stopConversation()}
              isStoppingConversation={workflow.isStoppingConversation}
              workflowStatus={snapshot.status}
              planApproval={snapshot.viewModel.conversation.planApproval}
              conversationStreamActive={workflow.conversation.streamActive}
              isApprovingPlan={workflow.isApprovingPlan}
              isApprovingCommands={workflow.isApprovingCommands}
              onApprovePlan={() => void workflow.approvePlan()}
              onApproveCommands={() => void workflow.approveDeliveryCommands()}
              codeGeneration={workflow.codeGeneration}
              isStoppingCodeGeneration={workflow.isStoppingCodeGeneration}
              onGenerateCode={workflow.generateCode}
              onStopCodeGeneration={() => void workflow.stopCodeGeneration()}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
