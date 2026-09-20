/** 集中组装新建和恢复线程共用的执行策略，包内运行配置不改变授权范围。 */
import type { NativeMethods } from "@ui-forge/codex-client";
import type { CodexConnection } from "./codexConnections.js";
import { computerUseDisabledConfig, disableDesktopMcp } from "./computerUsePolicy.js";

/** 在运行配置之上固定沙箱、审批和桌面工具策略，并授权项目临时产物目录。 */
export async function prepareSessionPolicy(
  client: Pick<CodexConnection, "request">,
  cwd: string,
  config: NativeMethods["thread/start"]["params"]["config"],
  temporaryDirectory: string,
) {
  const desktopMcp = await disableDesktopMcp(client, cwd);
  return {
    sandbox: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "auto_review" as const,
    config: {
      ...config,
      ...computerUseDisabledConfig,
      ...desktopMcp,
      "sandbox_workspace_write.writable_roots": [temporaryDirectory],
    },
  };
}
