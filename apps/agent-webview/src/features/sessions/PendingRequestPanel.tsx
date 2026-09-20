/** 展示真实审批和提问，用户明确提交后才回传对应请求 token 的决议。 */
import { useState } from "react";
import { Alert, Button, Input, Space } from "antd";
import { z } from "zod";
import type { NativeItem, PendingRequest } from "@ui-forge/shared-protocol";
import { RequestDetails } from "./RequestDetails";
import { McpElicitationForm } from "./McpElicitationForm";
import { approvalChoices } from "./requestPresentation";
import { stringValue } from "@ui-forge/client-core";
import styles from "./Sessions.module.css";

const questionSchema = z.array(
  z.object({
    id: z.string(),
    question: z.string(),
    header: z.string().optional(),
    isSecret: z.boolean().optional(),
    options: z
      .array(z.object({ label: z.string(), description: z.string() }))
      .nullable()
      .optional(),
  }),
);
/** 原生决议保持不变；按请求类型呈现命令、文件、工具操作或需要回答的问题。 */
export function PendingRequestPanel({
  pending,
  item,
  onRespond,
}: {
  pending: PendingRequest;
  item?: NativeItem | undefined;
  onRespond: (token: string, result: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { method, params } = pending.request;
  const questions =
    method === "item/tool/requestUserInput"
      ? questionSchema.safeParse(params.questions)
      : undefined;
  const approval =
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval";
  const permissions = method === "item/permissions/requestApproval";
  const requestedPermissions = z.record(z.string(), z.json()).safeParse(params.permissions);
  const grantedPermissions = requestedPermissions.success
    ? Object.fromEntries(
        Object.entries(requestedPermissions.data).filter(([, value]) => value !== null),
      )
    : {};
  const elicitation = method === "mcpServer/elicitation/request";
  const title = questions?.success
    ? "Codex 需要你的回答"
    : elicitation
      ? stringValue(params.serverName) + " 请求确认"
      : permissions
        ? "允许扩展访问权限？"
        : method === "item/fileChange/requestApproval"
          ? "允许修改这些文件？"
          : params.networkApprovalContext
            ? "允许访问此网络地址？"
            : approval
              ? "允许运行这条命令？"
              : "Codex 等待你的确认";
  const respond = async (result: unknown) => {
    setBusy(true);
    setError("");
    try {
      await onRespond(pending.token, result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "回复失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={styles.request}
      aria-label={questions?.success ? "Codex 提问" : "Codex 请求"}
      aria-busy={busy}
    >
      <div className={styles.requestHeading}>
        <span className={styles.requestDot} />
        <strong>{title}</strong>
      </div>
      {questions?.success ? (
        questions.data.map((question) => (
          <div className={styles.question} key={question.id}>
            <label htmlFor={pending.token + "-" + question.id}>{question.question}</label>
            {question.options?.length ? (
              <div className={styles.questionOptions}>
                {question.options.map((option) => (
                  <Button
                    disabled={busy}
                    key={option.label}
                    title={option.description}
                    aria-pressed={answers[question.id] === option.label}
                    type={answers[question.id] === option.label ? "primary" : "default"}
                    onClick={() => setAnswers({ ...answers, [question.id]: option.label })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              id={pending.token + "-" + question.id}
              type={question.isSecret ? "password" : "text"}
              value={answers[question.id] ?? ""}
              disabled={busy}
              placeholder="也可以输入自己的回答"
              onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
            />
          </div>
        ))
      ) : (
        <RequestDetails pending={pending} item={item} />
      )}
      {error && <Alert title={error} type="error" showIcon />}
      {elicitation ? (
        <McpElicitationForm pending={pending} busy={busy} onRespond={respond} />
      ) : (
        <Space wrap className={styles.requestActions ?? ""}>
          {approval &&
            approvalChoices(params.availableDecisions).map((choice, index) => (
              <div key={index} className={styles.approvalChoice}>
                <Button
                  type={choice.primary ? "primary" : "default"}
                  disabled={busy}
                  onClick={() => void respond({ decision: choice.decision })}
                >
                  {choice.label}
                </Button>
                {choice.detail && <p className={styles.hint}>{choice.detail}</p>}
              </div>
            ))}
          {permissions && (
            <>
              <Button
                type="primary"
                loading={busy}
                onClick={() => void respond({ permissions: grantedPermissions, scope: "turn" })}
              >
                允许本轮权限
              </Button>
              <Button
                disabled={busy}
                onClick={() => void respond({ permissions: {}, scope: "turn" })}
              >
                拒绝
              </Button>
            </>
          )}
          {questions?.success && (
            <Button
              type="primary"
              loading={busy}
              disabled={questions.data.some((question) => !answers[question.id]?.trim())}
              onClick={() =>
                void respond({
                  answers: Object.fromEntries(
                    questions.data.map((question) => [
                      question.id,
                      { answers: [answers[question.id]] },
                    ]),
                  ),
                })
              }
            >
              提交回答
            </Button>
          )}
        </Space>
      )}
      {!approval && !permissions && !elicitation && !questions?.success && (
        <div className={styles.rawReply}>
          <label htmlFor={"reply-" + pending.token}>响应内容（JSON）</label>
          <Input.TextArea
            id={"reply-" + pending.token}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={4}
            disabled={busy}
          />
          <Button
            loading={busy}
            onClick={() => {
              try {
                const content: unknown = JSON.parse(raw);
                void respond(content);
              } catch {
                setError("请输入有效 JSON。");
              }
            }}
          >
            提交响应
          </Button>
        </div>
      )}
      <details className={styles.requestTechnical}>
        <summary>请求详情</summary>
        <p>{method}</p>
        <pre>{JSON.stringify(params, null, 2)}</pre>
      </details>
    </section>
  );
}
