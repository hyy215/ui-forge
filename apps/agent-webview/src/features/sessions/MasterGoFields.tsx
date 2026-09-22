/** MasterGo 接入字段与只读检查结果，所有请求由表单注入。 */
import { Alert, Button, Input, Radio } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import type { DesignConnectionCheck } from "@ui-forge/shared-protocol";
import type { MasterGoDraft } from "./designInput";
import styles from "./DesignSource.module.css";

/** 展示显式接入选择，不在渲染或地址变化时自动连接设计服务。 */
export function MasterGoFields({
  draft,
  disabled,
  checking,
  result,
  error,
  onChange,
  onCheck,
}: {
  draft: MasterGoDraft;
  disabled: boolean;
  checking: boolean;
  result: DesignConnectionCheck | null;
  error: string;
  onChange: (draft: MasterGoDraft) => void;
  onCheck: () => void;
}) {
  return (
    <section className={styles.fields} aria-label="MasterGo 设计来源">
      <label htmlFor="design-url">设计链接</label>
      <Input
        id="design-url"
        value={draft.url}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, url: event.target.value })}
        placeholder="MasterGo 文件/图层链接"
      />
      <span id="mastergo-connection-label">MasterGo 接入方式</span>
      <Radio.Group
        aria-labelledby="mastergo-connection-label"
        value={draft.connection}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...draft, connection: event.target.value as "magic" | "vibe" })
        }
      >
        <Radio value="magic">Magic</Radio>
        <Radio value="vibe">Vibe</Radio>
      </Radio.Group>
      {draft.connection === "vibe" && (
        <>
          <label htmlFor="vibe-endpoint">Vibe MCP 地址</label>
          <Input
            id="vibe-endpoint"
            value={draft.endpoint}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, endpoint: event.target.value })}
          />
          <details className={styles.advanced}>
            <summary>高级设置</summary>
            <label htmlFor="vibe-status-endpoint">画布状态地址</label>
            <Input
              id="vibe-status-endpoint"
              value={draft.statusEndpoint}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, statusEndpoint: event.target.value })}
            />
          </details>
        </>
      )}
      <div>
        <Button
          aria-label="检查连接"
          icon={<ApiOutlined aria-hidden />}
          loading={checking}
          disabled={disabled || !draft.connection || !draft.url.trim()}
          onClick={onCheck}
        >
          检查连接
        </Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {result && (
        <Alert
          type="success"
          showIcon
          title="连接检查成功"
          description={
            <div className={styles.checkResult}>
              <span>
                {result.tools.length} 个工具
                {result.serverVersion ? ` · 服务版本 ${result.serverVersion}` : ""}
              </span>
              {result.target && (
                <span>
                  文件 {result.target.documentId} · 页面 {result.target.pageId ?? "未记录"} · 节点{" "}
                  {result.target.nodeId}
                </span>
              )}
            </div>
          }
        />
      )}
    </section>
  );
}
