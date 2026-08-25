/** 验证 Agent Server 统一通信入口与 D2C 服务的协议集成。 */
import { afterEach, describe, expect, it } from "vitest";
import { D2CAgent } from "@ui-forge/d2c-agent";
import {
  communicationResponseMessageSchema,
  communicationStreamMessageSchema,
  createCommunicationRequestMessage,
  createCommunicationStreamRequestMessage,
  d2cWorkflowMethods,
  d2cWorkflowSnapshotSchema,
} from "@ui-forge/shared-protocol";
import { D2CWorkflowService } from "../d2c/d2cWorkflowService.js";
import { buildApp } from "./buildApp.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("agent server", () => {
  it("initializes a server-owned D2C workflow through the communication endpoint", async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage(
        "test-1",
        d2cWorkflowMethods.initialize,
        { projectPath: "/workspace" },
      ),
    });

    const message = communicationResponseMessageSchema.parse(response.json());
    expect(message.success).toBe(true);
    if (!message.success) return;
    const snapshot = d2cWorkflowSnapshotSchema.parse(message.data);
    expect(snapshot.status).toBe("draft");
  });

  it("rejects stale D2C commands with a correlated error response", async () => {
    const app = buildApp();
    apps.push(app);
    const initialized = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("test-1", d2cWorkflowMethods.initialize, {}),
    });
    const initialMessage = communicationResponseMessageSchema.parse(initialized.json());
    if (!initialMessage.success) throw new Error(initialMessage.error.message);
    const snapshot = d2cWorkflowSnapshotSchema.parse(initialMessage.data);
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("test-2", d2cWorkflowMethods.inspectDesign, {
        taskId: snapshot.taskId,
        expectedRevision: 99,
        designUrl: "https://mastergo.com/example",
      }),
    });
    expect(communicationResponseMessageSchema.parse(response.json()))
      .toMatchObject({ success: false, requestId: "test-2" });
  });

  it("persists exact design confirmation before starting analysis", async () => {
    const source = { provider: "mastergo", reference: "https://mastergo.com/file/123?layer_id=12:48" };
    const previewSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#fff"/></svg>';
    const previewUrl = `data:image/svg+xml;base64,${Buffer.from(previewSvg).toString("base64")}`;
    const designSourceAdapter: D2CAgent.DesignSourceAdapter = {
      id: "mastergo",
      inspect: async () => ({
        context: {
          source,
          name: "客户管理",
          nodeCount: 10,
          tokens: { colorPrimary: "#1677ff" },
          regions: [{ id: "12:48", name: "客户列表", role: "table" }],
          preview: { url: previewUrl, width: 1440, height: 900 },
          warnings: [],
        },
        provenance: {
          provider: "MasterGo",
          transport: "MCP",
          operations: ["getDesignSections"],
        },
      }),
    };
    const service = D2CAgent.createService({
      componentCatalog: { components: [{ id: "table", name: "Table", aliases: ["表格"] }] },
      designSourceAdapters: [designSourceAdapter],
      projectInspector: { inspect: async (projectRoot) => ({ kind: "empty", projectRoot }) },
      planDeepAgent: {
        plan: async ({ recognition }) => ({
          componentRecognition: recognition,
          plan: {
            status: "reviewable",
            summary: "审阅方案",
            designUnderstanding: {
              layout: { summary: "页面布局", regions: [], evidence: ["设计结构"], warnings: [] },
              interactions: [],
            },
            reusableComponents: [],
            newComponents: [],
            componentDecisions: [],
            fileImpacts: [],
            steps: [{
              id: "step-1",
              kind: "initialize",
              targetId: "react-antd-project",
              title: "初始化",
              description: "初始化项目",
              decision: "create",
              dependsOn: [],
              files: [],
              evidence: ["目标目录为空"],
              acceptanceCriteria: ["可审阅"],
              risks: [],
            }],
            files: [],
            contextGaps: ["缺少文件证据"],
            stopConditions: ["不得直接写入"],
          },
        }),
      },
    });
    const app = buildApp({
      d2cWorkflowService: new D2CWorkflowService({
        designProvider: "mastergo",
        service,
      }),
    });
    apps.push(app);

    const initialized = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("test-1", d2cWorkflowMethods.initialize, {}),
    });
    const initialMessage = communicationResponseMessageSchema.parse(initialized.json());
    if (!initialMessage.success) throw new Error(initialMessage.error.message);
    const initialSnapshot = d2cWorkflowSnapshotSchema.parse(initialMessage.data);
    const inspected = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("test-2", d2cWorkflowMethods.inspectDesign, {
        taskId: initialSnapshot.taskId,
        expectedRevision: initialSnapshot.revision,
        designUrl: source.reference,
      }),
    });
    const inspectedMessage = communicationResponseMessageSchema.parse(inspected.json());
    if (!inspectedMessage.success) throw new Error(inspectedMessage.error.message);
    const inspectedSnapshot = d2cWorkflowSnapshotSchema.parse(inspectedMessage.data);
    expect(inspectedSnapshot.status).toBe("svg_ready");

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationRequestMessage("test-3", d2cWorkflowMethods.confirmDesign, {
        taskId: inspectedSnapshot.taskId,
        expectedRevision: inspectedSnapshot.revision,
        confirmation: "确认设计",
      }),
    });
    const confirmedMessage = communicationResponseMessageSchema.parse(confirmed.json());
    if (!confirmedMessage.success) throw new Error(confirmedMessage.error.message);
    const confirmedSnapshot = d2cWorkflowSnapshotSchema.parse(confirmedMessage.data);
    expect(confirmedSnapshot.status).toBe("design_confirmed");

    const streamed = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: createCommunicationStreamRequestMessage(
        "stream-1",
        d2cWorkflowMethods.streamConversation,
        {
          taskId: confirmedSnapshot.taskId,
          expectedRevision: confirmedSnapshot.revision,
        },
      ),
    });
    const streamMessages = streamed.body.trim().split("\n").map((line) => (
      communicationStreamMessageSchema.parse(JSON.parse(line))
    ));
    expect(streamMessages).toContainEqual(expect.objectContaining({
      kind: "stream-event",
      event: expect.objectContaining({
        type: "project-validation",
        result: expect.objectContaining({ kind: "empty" }),
      }),
    }));
    expect(streamMessages.at(-1)).toEqual({
      kind: "stream-complete",
      requestId: "stream-1",
      seq: streamMessages.length,
    });
  });

  it("rejects malformed communication input before dispatch", async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/communication",
      payload: { kind: "request", method: d2cWorkflowMethods.initialize },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_communication_message" });
  });
});
