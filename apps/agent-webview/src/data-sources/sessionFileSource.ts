/** 把文件链接映射到浏览器只读预览或 VS Code 的请求响应桥接。 */
import {
  sessionFileMethods,
  sessionFileRoute,
  sessionFileSchema,
  type SessionFileInput,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../communication/clientContract";

/** 组件使用的文件打开能力，宿主差异在应用组装时确定。 */
export interface SessionFileSource {
  /** 生成带任务身份的真实文件地址，不直接暴露 file:// URI。 */
  href(input: SessionFileInput): string;
  /** 原生宿主拦截点击时打开文件；浏览器使用上面的链接。 */
  open?: (input: SessionFileInput) => Promise<void>;
}

/** 浏览器链接直接指向真实文件路由；VS Code 等待原生编辑器打开结果。 */
export function createSessionFileSource(
  client: CommunicationClient,
  host: "vscode" | "browser",
): SessionFileSource {
  return {
    href: (input) => `${sessionFileRoute}?${new URLSearchParams(input)}`,
    ...(host === "vscode"
      ? {
          open: async (input: SessionFileInput) => {
            await client.request({
              method: sessionFileMethods.open,
              params: input,
              responseSchema: sessionFileSchema,
            });
          },
        }
      : {}),
  };
}
