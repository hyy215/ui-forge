/** 可控的原生协议开发样本，覆盖配置、流式输出、提问、审批和重连展示。 */
import {
  createSessionSchema,
  sessionMethods,
  instructionMethods,
  sessionIdSchema,
  sendSessionInputSchema,
  respondSessionSchema,
  readInstructionSchema,
  saveInstructionSchema,
  type SessionEvent,
  type SessionSnapshot,
  type NativeItem,
  type NativeTurn,
  sessionFileMethods,
  sessionFileInputSchema,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../src/communication/clientContract";
import { z } from "zod";

/** 每个开发页面持有独立样本，不访问磁盘、网络或真实 Codex。 */
export function createFixtureClient(): CommunicationClient {
  const documents = {
    design: "# 设计规则\n\n忠实还原设计与交互。\n",
    project: "# 工程规则\n\n遵循目标仓库的 TypeScript 约定。\n",
  };
  const revisions = { design: 1, project: 1 };
  const snapshots = new Map<string, SessionSnapshot>();
  const listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  let sequence = 0;
  const scenario = new URLSearchParams(location.search).get("scenario");
  let replyFailures = new URLSearchParams(location.search).has("replyError") ? 1 : 0;
  let sendFailures = new URLSearchParams(location.search).has("sendError") ? 1 : 0;
  let fileFailures = new URLSearchParams(location.search).has("fileError") ? 1 : 0;
  const emit = (taskId: string, event: SessionEvent) => {
    for (const listener of listeners.get(taskId) ?? []) listener(event);
  };
  const complete = (taskId: string, text: string) => {
    const snapshot = snapshots.get(taskId);
    const turn = snapshot?.thread.turns.at(-1);
    if (!snapshot || !turn) return;
    const item: NativeItem = { id: `agent-${sequence++}`, type: "agentMessage", text };
    turn.items.push(item);
    turn.status = "completed";
    snapshot.thread.status = { type: "idle" };
    emit(taskId, {
      type: "notification",
      notification: {
        method: "item/completed",
        params: { threadId: taskId, turnId: turn.id, item },
      },
    });
    emit(taskId, {
      type: "notification",
      notification: { method: "turn/completed", params: { threadId: taskId, turn } },
    });
  };
  return {
    notify: () => undefined,
    async request({ method, params, responseSchema }) {
      let result: unknown;
      if (method === sessionFileMethods.open) {
        const input = sessionFileInputSchema.parse(params);
        if (!snapshots.has(input.taskId)) throw new Error("任务不存在");
        if (fileFailures-- > 0) throw new Error("文件预览失败，请重试。");
        result = { path: input.path };
      } else if (method === instructionMethods.read || method === instructionMethods.save) {
        const { kind } = readInstructionSchema.parse(
          method === instructionMethods.read
            ? params
            : { kind: saveInstructionSchema.parse(params).kind },
        );
        if (method === instructionMethods.save) {
          const input = saveInstructionSchema.parse(params);
          if (new URLSearchParams(location.search).has("saveError"))
            throw new Error("EACCES：规则文件无法写入");
          if (input.revision !== String(revisions[kind])) throw new Error("文件已被修改");
          documents[kind] = input.content;
          revisions[kind] += 1;
        }
        result = {
          kind,
          content: documents[kind],
          path: `/ui-forge/packages/codex-client/instructions/${kind}.md`,
          revision: String(revisions[kind]),
        };
      } else if (method === sessionMethods.list)
        result = {
          tasks: [...snapshots.values()].map(({ thread }) => ({
            taskId: thread.id,
            projectPath: thread.cwd,
            title: thread.preview,
            updatedAt: new Date().toISOString(),
          })),
          nextOffset: null,
        };
      else if (method === sessionMethods.create) {
        const input = createSessionSchema.parse(params);
        const taskId = `demo-${sequence++}`;
        snapshots.set(taskId, {
          thread: {
            id: taskId,
            cwd: input.projectPath,
            preview: input.prompt,
            name: null,
            createdAt: 1,
            updatedAt: 1,
            status: { type: "active" },
            turns: [
              {
                id: `turn-${sequence++}`,
                status: "inProgress",
                error: null,
                items: [
                  {
                    id: "user-1",
                    type: "userMessage",
                    content: [
                      { type: "text", text: input.prompt },
                      ...input.images.map((image) => ({ type: "image", url: image.dataUrl })),
                    ],
                  },
                  {
                    id: "agent-1",
                    type: "agentMessage",
                    text: "我会先检查项目和设计，再实现页面。\n\n**当前活动**：读取项目结构。",
                  },
                  { id: "reasoning-empty", type: "reasoning", summary: [], content: [] },
                  {
                    id: "files-1",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/CustomerList.tsx",
                        kind: { type: "update", move_path: null },
                        diff: "@@ -1 +1 @@\n-const pageSize = 10;\n+const pageSize = 20;\n",
                      },
                    ],
                  },
                  {
                    id: "cmd-1",
                    type: "commandExecution",
                    command: "npm run typecheck",
                    cwd: input.projectPath,
                    status: "inProgress",
                    aggregatedOutput: "",
                  },
                ],
              },
            ],
          },
          pendingRequests: [
            {
              token: "approval-token",
              request: {
                id: 101,
                method: "item/commandExecution/requestApproval",
                params: {
                  threadId: taskId,
                  turnId: "turn-1",
                  itemId: "cmd-1",
                  command: "npm run typecheck",
                  cwd: input.projectPath,
                  reason: "检查目标项目的类型",
                  availableDecisions: ["accept", "decline", "cancel"],
                },
              },
            },
          ],
        });
        if (scenario === "mcp" || scenario === "form") {
          const snapshot = snapshots.get(taskId)!;
          snapshot.pendingRequests = [
            {
              token: "mcp-token",
              request: {
                id: 103,
                method: "mcpServer/elicitation/request",
                params: {
                  threadId: taskId,
                  turnId: snapshot.thread.turns[0]!.id,
                  serverName: "playwright",
                  mode: "form",
                  message:
                    scenario === "mcp"
                      ? 'Allow the playwright MCP server to run tool "browser_click"'
                      : "请确认浏览器操作信息",
                  _meta:
                    scenario === "mcp"
                      ? {
                          codex_approval_kind: "mcp_tool_call",
                          persist: ["session", "always"],
                          tool_description: "Perform click on a web page",
                          tool_params: { target: "e102", element: "在浏览器打开设计" },
                          tool_params_display: [
                            {
                              name: "element",
                              value: "在浏览器打开设计",
                              display_name: "操作目标",
                            },
                            { name: "target", value: "e102", display_name: "元素引用" },
                          ],
                        }
                      : null,
                  requestedSchema:
                    scenario === "mcp"
                      ? { type: "object", properties: {} }
                      : {
                          type: "object",
                          properties: {
                            label: { type: "string", title: "操作名称", minLength: 2 },
                            confirm: { type: "boolean", title: "允许覆盖", default: true },
                          },
                          required: ["label", "confirm"],
                        },
                },
              },
            },
          ];
        }
        if (scenario === "files") {
          const root =
            new URLSearchParams(location.search).get("artifactPath") ??
            "/ui-forge/runtime/tmp/demo/main";
          snapshots.get(taskId)!.thread.turns[0]!.items.push({
            id: "file-links",
            type: "agentMessage",
            text: [
              `[打开页面](http://localhost:3000) · [实际截图](<${root}/delivered preview (1).png>)`,
              "- 构建与交互检查结果见记录。",
              `[完整验收记录](<${root}/verification.md>) · [源文件](src/App.tsx:12:3) · [缺失文件](missing.md)`,
            ].join("\n\n"),
          });
        }
        result = { taskId };
      } else if (method === sessionMethods.read)
        result = snapshots.get(sessionIdSchema.parse(params).taskId);
      else if (method === sessionMethods.respond) {
        const input = respondSessionSchema.parse(params);
        const snapshot = snapshots.get(input.taskId);
        const pending = snapshot?.pendingRequests.find((entry) => entry.token === input.token);
        if (!snapshot || !pending) throw new Error("请求已失效。");
        if (pending.token === "approval-token")
          z.object({ decision: z.enum(["accept", "decline", "cancel"]) })
            .strict()
            .parse(input.result);
        if (pending.token === "mcp-token") {
          const reply = z
            .object({
              action: z.enum(["accept", "decline", "cancel"]),
              content: z.unknown(),
              _meta: z.null(),
            })
            .strict()
            .parse(input.result);
          if (reply.action === "accept") {
            if (scenario === "mcp") z.object({}).strict().parse(reply.content);
            else
              z.object({ label: z.string().min(2), confirm: z.boolean() })
                .strict()
                .parse(reply.content);
          } else z.null().parse(reply.content);
        }
        if (replyFailures-- > 0) throw new Error("回复暂时失败，请重试。");
        snapshot.pendingRequests = snapshot.pendingRequests.filter(
          (entry) => entry.token !== input.token,
        );
        emit(input.taskId, { type: "resolved", token: input.token });
        if (pending.token === "approval-token") {
          const command = snapshot.thread.turns[0]?.items.find((item) => item.id === "cmd-1");
          if (command) {
            const reply = z.object({ decision: z.string() }).parse(input.result);
            command.status = reply.decision === "accept" ? "completed" : "declined";
            command.aggregatedOutput = reply.decision === "accept" ? "类型检查完成。" : "";
            emit(input.taskId, {
              type: "notification",
              notification: {
                method: "item/completed",
                params: {
                  threadId: input.taskId,
                  turnId: snapshot.thread.turns[0]!.id,
                  item: command,
                },
              },
            });
          }
          const question = {
            token: "question-token",
            request: {
              id: 102,
              method: "item/tool/requestUserInput",
              params: {
                threadId: input.taskId,
                turnId: snapshot.thread.turns[0]?.id ?? "",
                questions: [
                  {
                    id: "style",
                    question: "列表默认展示多少条？",
                    header: "分页",
                    options: [
                      { label: "20 条", description: "常规分页" },
                      { label: "50 条", description: "查看更多" },
                    ],
                  },
                ],
              },
            },
          };
          snapshot.pendingRequests.push(question);
          emit(input.taskId, { type: "request", pending: question });
        } else if (pending.token === "mcp-token") {
          const reply = z.object({ action: z.string() }).parse(input.result);
          complete(
            input.taskId,
            "工具请求已处理：" +
              ({ accept: "已允许", decline: "已拒绝", cancel: "已取消" } as Record<string, string>)[
                reply.action
              ],
          );
        } else complete(input.taskId, "已收到你的回答。\n\n本次为开发演示，**未执行工程验证**。");
        result = { accepted: true };
      } else if (method === sessionMethods.send) {
        const input = sendSessionInputSchema.parse(params);
        const snapshot = snapshots.get(input.taskId);
        if (!snapshot) throw new Error("任务不存在");
        if (sendFailures-- > 0) throw new Error("发送暂时失败，请重试。");
        const turn: NativeTurn = {
          id: `turn-${sequence++}`,
          status: "inProgress",
          error: null,
          items: [
            {
              id: `user-${sequence++}`,
              type: "userMessage",
              content: [
                ...(input.text ? [{ type: "text", text: input.text }] : []),
                ...input.images.map((image) => ({ type: "image", url: image.dataUrl })),
              ],
            },
          ],
        };
        snapshot.thread.turns.push(turn);
        emit(input.taskId, {
          type: "notification",
          notification: { method: "turn/started", params: { threadId: input.taskId, turn } },
        });
        const item = { id: `agent-${sequence++}`, type: "agentMessage", text: "" };
        turn.items.push(item);
        emit(input.taskId, {
          type: "notification",
          notification: {
            method: "item/started",
            params: { threadId: input.taskId, turnId: turn.id, item },
          },
        });
        setTimeout(() => {
          item.text = "已收到补充需求。";
          emit(input.taskId, {
            type: "notification",
            notification: {
              method: "item/agentMessage/delta",
              params: {
                threadId: input.taskId,
                turnId: turn.id,
                itemId: item.id,
                delta: item.text,
              },
            },
          });
        }, 100);
        setTimeout(() => complete(input.taskId, "将按最新要求继续修改。"), 220);
        result = { accepted: true };
      } else if (method === sessionMethods.stop) {
        const value =
          params && typeof params === "object" && "taskId" in params ? params.taskId : undefined;
        if (typeof value !== "string") throw new Error("任务不存在");
        const snapshot = snapshots.get(value);
        const turn = snapshot?.thread.turns.at(-1);
        if (!snapshot || !turn) throw new Error("任务不存在");
        turn.status = "interrupted";
        snapshot.pendingRequests = [];
        snapshot.thread.status = { type: "idle" };
        emit(value, { type: "snapshot", snapshot: structuredClone(snapshot) });
        result = { accepted: true };
      } else throw new Error(`未实现的样本方法：${method}`);
      return responseSchema.parse(structuredClone(result));
    },
    async stream({ params, eventSchema, onEvent, signal }) {
      const { taskId } = sessionIdSchema.parse(params);
      const snapshot = snapshots.get(taskId);
      if (!snapshot) throw new Error("演示任务不存在，请新建任务。");
      const listener = (event: SessionEvent) => {
        void onEvent(eventSchema.parse(structuredClone(event)));
      };
      const group = listeners.get(taskId) ?? new Set();
      group.add(listener);
      listeners.set(taskId, group);
      try {
        await onEvent(eventSchema.parse({ type: "snapshot", snapshot: structuredClone(snapshot) }));
        if (scenario === "mcp")
          for (const version of [1, 2, 3])
            await onEvent(
              eventSchema.parse({
                type: "notification",
                notification: {
                  method: "turn/diff/updated",
                  params: {
                    threadId: taskId,
                    turnId: snapshot.thread.turns[0]!.id,
                    diff:
                      "diff --git a/src/CustomerList.tsx b/src/CustomerList.tsx\n@@ -1 +1 @@\n-const version = 0;\n+const version = " +
                      version +
                      ";\n",
                  },
                },
              }),
            );
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        group.delete(listener);
      }
    },
  };
}
