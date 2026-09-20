/** 将 MCP 的标准 elicitation schema 转为表单；空审批不要求用户手写 JSON。 */
import { useState } from "react";
import { Alert, Button, Input, Radio, Select, Space } from "antd";
import type { PendingRequest } from "@ui-forge/shared-protocol";
import {
  elicitationContent,
  elicitationSchema,
  fieldOptions,
  type ElicitationValues,
} from "./requestPresentation";
import styles from "./Sessions.module.css";

/** 用户提交后回传 action/content；拒绝与取消始终使用空 content。 */
export function McpElicitationForm({
  pending,
  busy,
  onRespond,
}: {
  pending: PendingRequest;
  busy: boolean;
  onRespond: (result: unknown) => Promise<void>;
}) {
  const [values, setValues] = useState<ElicitationValues>({});
  const [raw, setRaw] = useState("{}");
  const [error, setError] = useState("");
  const { params } = pending.request;
  const schema = elicitationSchema.safeParse(params.requestedSchema);
  const isUrl = params.mode === "url";
  const fields = schema.success ? Object.entries(schema.data.properties) : [];
  const accept = () => {
    try {
      const content: unknown = isUrl
        ? null
        : schema.success
          ? elicitationContent(schema.data, values)
          : JSON.parse(raw);
      setError("");
      void onRespond({ action: "accept", content, _meta: null });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "请检查表单内容");
    }
  };
  return (
    <div className={styles.elicitationForm}>
      {fields.map(([name, field]) => {
        const id = pending.token + "-" + name;
        const options = fieldOptions(field);
        const value = values[name];
        return (
          <div className={styles.question} key={name}>
            <label htmlFor={id}>
              {field.title ?? name}
              {schema.success && schema.data.required?.includes(name) ? " *" : ""}
            </label>
            {field.description && <p className={styles.hint}>{field.description}</p>}
            {field.type === "boolean" ? (
              <Radio.Group
                id={id}
                aria-label={field.title ?? name}
                disabled={busy}
                value={value}
                onChange={(event) => setValues({ ...values, [name]: event.target.value === true })}
                options={[
                  { label: "是", value: true },
                  { label: "否", value: false },
                ]}
              />
            ) : options ? (
              <Select
                id={id}
                aria-label={field.title ?? name}
                disabled={busy}
                {...(field.type === "array" ? { mode: "multiple" as const } : {})}
                options={options}
                value={value === undefined || typeof value === "boolean" ? null : value}
                onChange={(selected: string | string[]) =>
                  setValues({ ...values, [name]: selected })
                }
              />
            ) : (
              <Input
                id={id}
                disabled={busy}
                type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
              />
            )}
          </div>
        );
      })}
      {!schema.success && !isUrl && (
        <div className={styles.rawReply}>
          <p>此工具请求了扩展表单，请查看字段要求后填写。</p>
          <details>
            <summary>字段要求</summary>
            <pre>{JSON.stringify(params.requestedSchema, null, 2)}</pre>
          </details>
          <label htmlFor={pending.token + "-json"}>响应内容（JSON）</label>
          <Input.TextArea
            id={pending.token + "-json"}
            rows={4}
            value={raw}
            disabled={busy}
            onChange={(event) => setRaw(event.target.value)}
          />
        </div>
      )}
      {error && <Alert title={error} type="error" showIcon />}
      <Space wrap className={styles.requestActions ?? ""}>
        <Button type="primary" loading={busy} onClick={accept}>
          {isUrl ? "已完成确认" : fields.length ? "提交信息" : "允许本次"}
        </Button>
        <Button
          disabled={busy}
          onClick={() => void onRespond({ action: "decline", content: null, _meta: null })}
        >
          拒绝
        </Button>
        <Button
          disabled={busy}
          onClick={() => void onRespond({ action: "cancel", content: null, _meta: null })}
        >
          取消操作
        </Button>
      </Space>
    </div>
  );
}
