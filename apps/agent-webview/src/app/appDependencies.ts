/** 注入环境无关传输与宿主明确提供的工作区，不在功能组件读取 VS Code API。 */
import type { CommunicationClient } from "../communication/clientContract";
import { z } from "zod";
import { isVsCodeRuntime } from "../communication/vscode/createVsCodeCommunicationClient";

/** 应用唯一的环境相关依赖。 */
export interface AppDependencies {
  communicationClient: CommunicationClient;
  workspacePath?: string;
  fixture?: boolean;
  host?: "vscode" | "browser";
}
/** 使用 Extension 注入的展示上下文；真正的工作区边界仍由宿主检查。 */
export function createAppDependencies(
  communicationClient: CommunicationClient,
  fixture = false,
): AppDependencies {
  const context = z
    .object({ projectPath: z.string().optional() })
    .safeParse(Reflect.get(window, "uiForgeHost"));
  return {
    communicationClient,
    fixture,
    host: isVsCodeRuntime() ? "vscode" : "browser",
    ...(context.success && context.data.projectPath
      ? { workspacePath: context.data.projectPath }
      : {}),
  };
}
