/** 在所有页面提供一致的规则配置入口，保留当前对话及其草稿。 */
import type { ReactNode } from "react";
import { appPaths } from "../../app/appPaths";

/** VS Code 聚焦独立配置面板，浏览器在新标签页中打开配置。 */
export function SettingsLink({
  host,
  children = "规则配置",
  className,
}: {
  host: "vscode" | "browser";
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <a
      href={host === "vscode" ? "command:ui-forge.openSettings" : `#${appPaths.settings}`}
      target={host === "browser" ? "_blank" : undefined}
      rel="noopener noreferrer"
      title="在独立标签页打开配置"
      className={className}
    >
      {children}
    </a>
  );
}
