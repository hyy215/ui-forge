/** 把审批原因、命令、文件范围和 MCP 操作目标呈现为用户可读的内容。 */
import { z } from "zod";
import type { NativeItem, PendingRequest } from "@ui-forge/shared-protocol";
import { FileChangesView } from "./FileChangesView";
import { NativeValueView } from "./NativeValueView";
import { stringValue } from "@ui-forge/client-core";
import styles from "./Sessions.module.css";

/** 关联已收到的 item 补全审批预览；只展示此次请求携带的作用范围。 */
export function RequestDetails({
  pending,
  item,
}: {
  pending: PendingRequest;
  item?: NativeItem | undefined;
}) {
  const { method, params } = pending.request;
  const reason = stringValue(params.reason) || stringValue(params.message);
  const meta = z.record(z.string(), z.unknown()).catch({}).parse(params._meta);
  const display = z
    .array(z.object({ name: z.string(), value: z.unknown(), display_name: z.string().optional() }))
    .safeParse(meta.tool_params_display);
  const network = z
    .object({ host: z.string(), protocol: z.string() })
    .safeParse(params.networkApprovalContext);
  return (
    <div className={styles.requestDetails}>
      {reason && <p className={styles.requestReason}>{reason}</p>}
      {method === "item/commandExecution/requestApproval" &&
        (network.success ? (
          <div className={styles.permissionScope}>
            <strong>网络访问</strong>
            <code>{network.data.protocol + "://" + network.data.host}</code>
          </div>
        ) : (
          <>
            <pre className={styles.commandPreview}>
              <code>
                {stringValue(params.command) || stringValue(item?.command) || "命令预览未提供"}
              </code>
            </pre>
            {(params.cwd || item?.cwd) && (
              <p className={styles.toolMeta}>
                工作目录：{stringValue(params.cwd) || stringValue(item?.cwd)}
              </p>
            )}
          </>
        ))}
      {method === "item/fileChange/requestApproval" && (
        <>
          {params.grantRoot && (
            <p>
              授权目录：<code>{stringValue(params.grantRoot)}</code>
            </p>
          )}
          <FileChangesView changes={item?.changes} />
        </>
      )}
      {(method === "item/permissions/requestApproval" || params.additionalPermissions) && (
        <div className={styles.permissionScope}>
          <strong>请求的权限范围</strong>
          <NativeValueView value={params.permissions ?? params.additionalPermissions} />
        </div>
      )}
      {method === "mcpServer/elicitation/request" && (
        <>
          {typeof meta.tool_description === "string" && (
            <p className={styles.hint}>{meta.tool_description}</p>
          )}
          {display.success && display.data.length ? (
            <dl className={styles.valueFields}>
              {display.data.map((field) => (
                <div key={field.name}>
                  <dt>{field.display_name ?? field.name}</dt>
                  <dd>
                    {typeof field.value === "string" ? field.value : JSON.stringify(field.value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <NativeValueView value={meta.tool_params} />
          )}
          {params.mode === "url" &&
            typeof params.url === "string" &&
            /^https?:\/\//i.test(params.url) && (
              <a href={params.url} target="_blank" rel="noreferrer">
                打开 {stringValue(params.serverName)} 的确认页面 ↗
              </a>
            )}
        </>
      )}
    </div>
  );
}
