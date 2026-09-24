/** Offline long-history samples and bounded in-memory controls for repeatable Webview measurements. */
import { z } from "zod";
import {
  listSessionsSchema,
  respondSessionSchema,
  sessionIdSchema,
  sessionMethods,
  sessionSnapshotSchema,
  stopSessionSchema,
  type SessionEvent,
  type SessionSnapshot,
} from "@ui-forge/shared-protocol";
import type { CommunicationClient } from "../src/communication/clientContract";

/** Fixed synthetic task identity; no real task or workspace is accessible through this client. */
export const LONG_HISTORY_TASK_ID = "benchmark-task";
const workspace = "/benchmark/simulated-project";
const activeTurnId = "benchmark-active";
const streamItemId = "benchmark-stream";
const approvalToken = "benchmark-approval";
const historySizeSchema = z.union([z.literal(100), z.literal(500), z.literal(1000)]);
const controlSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("stream"),
    count: z.literal(100),
    intervalMs: z.number().int().min(10).max(1000),
  }),
  z.strictObject({ action: z.literal("approval") }),
]);
const decisionSchema = z.strictObject({ decision: z.enum(["accept", "decline", "cancel"]) });

/** Build exactly N historical items plus one active message; each call owns a separate snapshot. */
export function createLongHistorySnapshot(historyItems: 100 | 500 | 1000): SessionSnapshot {
  const size = historySizeSchema.parse(historyItems);
  const turns = Array.from({ length: size / 4 }, (_, index) => {
    const label = String(index + 1).padStart(4, "0");
    return {
      id: `benchmark-history-${label}`,
      status: "completed",
      error: null,
      items: [
        {
          id: `benchmark-user-${label}`,
          type: "userMessage",
          content: [{ type: "text", text: `模拟需求 ${label}：检查列表筛选与重置。` }],
        },
        {
          id: `benchmark-agent-${label}`,
          type: "agentMessage",
          text: `模拟记录 ${label}：已记录筛选、重置与边界状态。`,
        },
        {
          id: `benchmark-command-${label}`,
          type: "commandExecution",
          command: `simulated-check ${label}`,
          cwd: workspace,
          status: "completed",
          exitCode: 0,
          durationMs: 10,
          aggregatedOutput: "Simulated check completed.\nNo command was executed.\n",
        },
        {
          id: `benchmark-file-${label}`,
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: `benchmark/Example${label}.tsx`,
              kind: { type: "update", move_path: null },
              diff: "@@ -1 +1 @@\n-const sample = false;\n+const sample = true;\n",
            },
          ],
        },
      ],
    };
  });
  return sessionSnapshotSchema.parse({
    thread: {
      id: LONG_HISTORY_TASK_ID,
      cwd: workspace,
      preview: "长历史基线（模拟）",
      name: "长历史基线（模拟）",
      createdAt: 1790121600,
      updatedAt: 1790121600,
      status: { type: "active", activeFlags: [] },
      turns: [
        ...turns,
        {
          id: activeTurnId,
          status: "inProgress",
          error: null,
          startedAt: null,
          items: [{ id: streamItemId, type: "agentMessage", text: "stream-ready" }],
        },
      ],
    },
    pendingRequests: [],
    designBinding: { bindingId: "00000000-0000-4000-8000-000000000001", source: { kind: "local" } },
  });
}

/** Provide a read-only synthetic task, with one explicit stream and approval simulation per instance. */
export function createLongHistoryFixtureClient(
  historyItems: 100 | 500 | 1000,
): CommunicationClient {
  const snapshot = createLongHistorySnapshot(historyItems);
  const subscribers = new Set<(event: SessionEvent) => Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let streamStarted = false;
  let emittedCount = 0;
  let approvalIssued = false;
  const activeTurn = () => snapshot.thread.turns.find((turn) => turn.id === activeTurnId)!;
  const assertTask = (taskId: string) => {
    if (taskId !== LONG_HISTORY_TASK_ID)
      throw new Error("Only the synthetic benchmark task is available.");
  };
  const progress = (detail: Record<string, string | number>) => {
    window.dispatchEvent(
      new CustomEvent("ui-forge:benchmark-progress", {
        detail: { taskId: LONG_HISTORY_TASK_ID, historyItems, ...detail },
      }),
    );
  };
  const emit = async (event: SessionEvent) => {
    await Promise.all([...subscribers].map((subscriber) => subscriber(event)));
  };
  const cancelTimer = () => {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const control = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const parsed = controlSchema.safeParse(event.detail as unknown);
    if (!parsed.success || !subscribers.size || activeTurn().status !== "inProgress") return;
    if (parsed.data.action === "approval") {
      if (approvalIssued) return;
      approvalIssued = true;
      const pending = {
        token: approvalToken,
        request: {
          id: approvalToken,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: LONG_HISTORY_TASK_ID,
            turnId: activeTurnId,
            itemId: "benchmark-approval-command",
            command: "simulated-check approval",
            cwd: workspace,
            reason: "模拟审批响应测量，不执行任何命令。",
            availableDecisions: ["accept", "decline", "cancel"],
          },
        },
      };
      snapshot.pendingRequests.push(pending);
      void emit({ type: "request", pending });
      return;
    }
    if (streamStarted) return;
    streamStarted = true;
    const { intervalMs, count } = parsed.data;
    const currentGeneration = generation;
    progress({ kind: "stream-start", count });
    const tick = async () => {
      timer = undefined;
      if (currentGeneration !== generation || !subscribers.size) return;
      emittedCount += 1;
      const delta =
        emittedCount === count
          ? " stream-end-100"
          : ` step-${String(emittedCount).padStart(3, "0")}`;
      const item = activeTurn().items.find((item) => item.id === streamItemId)!;
      item.text = String(item.text) + delta;
      await emit({
        type: "notification",
        notification: {
          method: "item/agentMessage/delta",
          params: {
            threadId: LONG_HISTORY_TASK_ID,
            turnId: activeTurnId,
            itemId: streamItemId,
            delta,
          },
        },
      });
      if (currentGeneration !== generation || !subscribers.size) return;
      if (emittedCount === count) progress({ kind: "stream-end", count: emittedCount });
      else timer = setTimeout(() => void tick(), intervalMs);
    };
    timer = setTimeout(() => void tick(), intervalMs);
  };

  return {
    notify() {
      throw new Error("Benchmark notifications cannot perform writes.");
    },
    async request({ method, params, responseSchema, signal }) {
      if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
      if (method === sessionMethods.list) {
        const input = listSessionsSchema.parse(params);
        return responseSchema.parse({
          tasks:
            input.offset > 0 || (input.projectPath !== undefined && input.projectPath !== workspace)
              ? []
              : [
                  {
                    taskId: LONG_HISTORY_TASK_ID,
                    projectPath: workspace,
                    title: snapshot.thread.preview,
                    updatedAt: "2026-09-23T00:00:00.000Z",
                    designBinding: structuredClone(snapshot.designBinding),
                  },
                ],
          nextOffset: null,
        });
      }
      if (method === sessionMethods.read) {
        assertTask(sessionIdSchema.parse(params).taskId);
        return responseSchema.parse(structuredClone(snapshot));
      }
      if (method === sessionMethods.respond) {
        const input = respondSessionSchema.parse(params);
        assertTask(input.taskId);
        const { decision } = decisionSchema.parse(input.result);
        if (
          input.token !== approvalToken ||
          !snapshot.pendingRequests.some((request) => request.token === input.token)
        )
          throw new Error("Synthetic approval is unavailable or already resolved.");
        const result = responseSchema.parse({ accepted: true });
        snapshot.pendingRequests = [];
        await emit({
          type: "notification",
          notification: {
            method: "serverRequest/resolved",
            params: { threadId: LONG_HISTORY_TASK_ID, requestId: approvalToken },
          },
        });
        progress({ kind: "approval-resolved", decision });
        return result;
      }
      if (method === sessionMethods.stop) {
        const input = stopSessionSchema.parse(params);
        assertTask(input.taskId);
        if (input.turnId !== activeTurnId || activeTurn().status !== "inProgress")
          throw new Error("Synthetic active turn is unavailable.");
        const result = responseSchema.parse({ accepted: true });
        cancelTimer();
        activeTurn().status = "interrupted";
        snapshot.thread.status = { type: "idle" };
        snapshot.pendingRequests = [];
        await emit({ type: "snapshot", snapshot });
        progress({ kind: "stopped", count: emittedCount });
        return result;
      }
      throw new Error("This operation is disabled in the offline benchmark.");
    },
    async stream({ method, params, eventSchema, onEvent, signal }) {
      if (method !== sessionMethods.subscribe)
        return Promise.reject(new Error("Only synthetic task subscriptions are available."));
      assertTask(sessionIdSchema.parse(params).taskId);
      if (signal?.aborted) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        let closed = false;
        let queue = Promise.resolve();
        const close = (error?: unknown) => {
          if (closed) return;
          closed = true;
          signal?.removeEventListener("abort", abort);
          subscribers.delete(deliver);
          if (!subscribers.size) {
            window.removeEventListener("ui-forge:benchmark-control", control);
            cancelTimer();
          }
          if (error === undefined) resolve();
          else reject(error);
        };
        const abort = () => close();
        const deliver = (event: SessionEvent) => {
          const copy = structuredClone(event);
          queue = queue
            .then(async () => {
              if (!closed) await onEvent(eventSchema.parse(copy));
            })
            .catch(close);
          return queue;
        };
        if (!subscribers.size) window.addEventListener("ui-forge:benchmark-control", control);
        subscribers.add(deliver);
        signal?.addEventListener("abort", abort, { once: true });
        void deliver({ type: "snapshot", snapshot });
      });
    },
  };
}
