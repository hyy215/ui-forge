/** 按显式来源检查设计连接和目标，不进入任何任务生命周期。 */
import { designMethods, designConnectionCheckSchema } from "@ui-forge/shared-protocol";
import type { Command } from "commander";
import { LocalClient } from "../client.js";
import { addDesignSourceOptions, readDesignSourceOptions } from "../designSourceOptions.js";
import { readJsonOption } from "../options.js";

/** 注册只读设计接入检查；JSON 输出使用服务端白名单 Schema。 */
export function registerDesignCheckCommand(program: Command): void {
  const command = addDesignSourceOptions(
    program.command("design-check").description("只读检查所选设计接入，不启动任务"),
  );
  command.action(async () => {
    const source = readDesignSourceOptions(command.opts());
    const client = new LocalClient();
    await client.connect();
    const report = await client.request(
      designMethods.check,
      { source },
      designConnectionCheckSchema,
    );
    const target = report.target;
    const readable = [
      source.kind === "local"
        ? "来源：图片/文字；无需平台接入。"
        : `来源：MasterGo；接入：${source.connection.kind === "magic" ? "Magic" : "Vibe"}；连接检查成功。`,
      ...(target
        ? [`文件：${target.documentId}；页面：${target.pageId ?? "未记录"}；节点：${target.nodeId}`]
        : []),
      `工具：${report.tools.length}；服务版本：${report.serverVersion ?? "未记录"}`,
    ].join("\n");
    process.stdout.write(`${readJsonOption(command) ? JSON.stringify(report) : readable}\n`);
  });
}
