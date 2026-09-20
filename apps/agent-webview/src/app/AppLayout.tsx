/** 应用导航壳层，独立展示配置入口和开发样本标识。 */
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { SettingsLink } from "../features/settings/SettingsLink";
import { appPaths } from "./appPaths";

/** 渲染所有页面共用的轻量导航。 */
export function AppLayout({ fixture, host }: { fixture: boolean; host: "vscode" | "browser" }) {
  const settings = useLocation().pathname === appPaths.settings;
  return (
    <div className={`app-shell${settings ? " settings-shell" : ""}`}>
      <header className="app-header">
        {settings ? (
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">
              u
            </span>
            ui-forge <span className="page-label">/ 规则配置</span>
          </span>
        ) : (
          <NavLink to={appPaths.home} className="brand" aria-label="ui-forge">
            <span className="brand-mark" aria-hidden="true">
              u
            </span>
            ui-forge
          </NavLink>
        )}
        {settings ? (
          host === "vscode" ? (
            <a href="command:ui-forge.open">返回对话 ↗</a>
          ) : (
            <span className="page-hint">关闭此页即可返回对话</span>
          )
        ) : (
          <nav aria-label="主导航">
            <NavLink to={appPaths.task}>新建任务</NavLink>
            <SettingsLink host={host} />
          </nav>
        )}
      </header>
      {fixture && (
        <div className="fixture-banner" role="note">
          开发演示 · 使用模拟 Codex 消息，不执行任务或写入规则文件
        </div>
      )}
      <Outlet />
    </div>
  );
}
