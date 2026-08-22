/** 验证通用 Graph 的多节点、路由、循环与 Checkpoint 行为。 */

import { describe, expect, it } from "vitest";
import { createMemoryCheckpointer } from "./checkpoint.js";
import { graphEnd, graphStart } from "./graph.js";
import { createGraph } from "./langGraph.js";

describe("createGraph", () => {
  it("按显式边执行多个节点并合并各节点的状态增量", async () => {
    const input = { count: 1, label: "initial" };
    const graph = createGraph<typeof input>({
      nodes: [
        { id: "increment", execute: (state) => ({ count: state.count + 1 }) },
        { id: "describe", execute: (state) => ({ label: `count:${state.count}` }) },
      ],
      edges: [
        { from: graphStart, to: "increment" },
        { from: "increment", to: "describe" },
        { from: "describe", to: graphEnd },
      ],
    });

    await expect(graph.invoke(input)).resolves.toEqual({ count: 2, label: "count:2" });
    expect(input).toEqual({ count: 1, label: "initial" });
  });

  it("通过声明目标的条件路由支持分支和循环", async () => {
    const graph = createGraph<{ count: number; done: boolean }>({
      nodes: [
        { id: "increment", execute: (state) => ({ count: state.count + 1 }) },
        { id: "finish", execute: () => ({ done: true }) },
      ],
      edges: [
        { from: graphStart, to: "increment" },
        { from: "finish", to: graphEnd },
      ],
      routes: [{
        from: "increment",
        targets: ["increment", "finish"],
        decide: (state) => state.count < 3 ? "increment" : "finish",
      }],
    });

    await expect(graph.invoke({ count: 0, done: false })).resolves.toEqual({
      count: 3,
      done: true,
    });
  });

  it("由同一个 Graph 接口保存并恢复 thread 状态", async () => {
    const graph = createGraph<{ revision: number; optional?: string }>({
      nodes: [{ id: "persist", execute: () => ({}) }],
      edges: [
        { from: graphStart, to: "persist" },
        { from: "persist", to: graphEnd },
      ],
      checkpointer: createMemoryCheckpointer(),
    });

    await expect(graph.invoke({ revision: 1, optional: "old" })).rejects.toThrow("threadId");
    await graph.invoke({ revision: 1, optional: "old" }, { threadId: "task-1" });
    await graph.invoke({ revision: 2 }, { threadId: "task-1" });

    await expect(graph.getState("task-1")).resolves.toEqual({ revision: 2 });
    await expect(graph.getState("missing")).resolves.toBeUndefined();
  });

  it("允许 Checkpoint Graph 使用同一拓扑执行瞬时能力而不污染线程状态", async () => {
    const graph = createGraph<{ value: number }>({
      nodes: [{ id: "increment", execute: (state) => ({ value: state.value + 1 }) }],
      edges: [
        { from: graphStart, to: "increment" },
        { from: "increment", to: graphEnd },
      ],
      checkpointer: createMemoryCheckpointer(),
    });

    await graph.invoke({ value: 1 }, { threadId: "task-1" });
    await expect(graph.invoke({ value: 10 }, { checkpoint: false })).resolves.toEqual({ value: 11 });
    await expect(graph.getState("task-1")).resolves.toEqual({ value: 2 });
  });

  it("按固定边在节点后暂停，并从同一线程恢复后续节点", async () => {
    const graph = createGraph<{ inspected: boolean; generated: boolean; goal: string }>({
      nodes: [
        { id: "inspect", execute: () => ({ inspected: true }) },
        { id: "generate", execute: () => ({ generated: true }) },
      ],
      edges: [
        { from: graphStart, to: "inspect" },
        { from: "inspect", to: "generate" },
        { from: "generate", to: graphEnd },
      ],
      pauseAfter: ["inspect"],
      checkpointer: createMemoryCheckpointer(),
    });

    await expect(graph.invoke(
      { inspected: false, generated: false, goal: "initial" },
      { threadId: "task-1" },
    )).resolves.toEqual({ inspected: true, generated: false, goal: "initial" });
    await graph.setState("task-1", {
      inspected: true,
      generated: false,
      goal: "confirmed",
    });
    await expect(graph.resume("task-1")).resolves.toEqual({
      inspected: true,
      generated: true,
      goal: "confirmed",
    });
  });

  it("允许首次保存线程状态而不执行节点", async () => {
    let executions = 0;
    const graph = createGraph<{ value: number }>({
      nodes: [{ id: "increment", execute: (state) => {
        executions += 1;
        return { value: state.value + 1 };
      } }],
      edges: [
        { from: graphStart, to: "increment" },
        { from: "increment", to: graphEnd },
      ],
      checkpointer: createMemoryCheckpointer(),
    });

    await graph.setState("task-1", { value: 4 });

    expect(executions).toBe(0);
    await expect(graph.getState("task-1")).resolves.toEqual({ value: 4 });
    await expect(graph.invoke({ value: 10 }, { threadId: "task-1" }))
      .resolves.toEqual({ value: 11 });
  });

  it("在编译前拒绝无效拓扑和未声明的动态目标", async () => {
    expect(() => createGraph({ nodes: [], edges: [] })).toThrow("至少需要一个节点");
    expect(() => createGraph({
      nodes: [{ id: "node", execute: () => ({}) }],
      edges: [{ from: graphStart, to: "missing" }],
    })).toThrow("未知终点");
    expect(() => createGraph({
      nodes: [{ id: "node", execute: () => ({}) }],
      edges: [
        { from: graphStart, to: "node" },
        { from: "node", to: graphEnd },
      ],
      pauseAfter: ["node"],
    })).toThrow("必须提供 Checkpointer");

    const graph = createGraph<{ enabled: boolean }>({
      nodes: [{ id: "route", execute: () => ({}) }],
      edges: [{ from: graphStart, to: "route" }],
      routes: [{
        from: "route",
        targets: [graphEnd],
        decide: () => "missing",
      }],
    });
    await expect(graph.invoke({ enabled: true })).rejects.toThrow("未声明目标");
  });
});
