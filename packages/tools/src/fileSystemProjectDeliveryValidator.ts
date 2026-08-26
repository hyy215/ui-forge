/** 对已落盘 React + Ant Design 项目执行受控构建、Vite 预览、截图和视觉差异门禁。 */

import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  calculateDeliveryCommandPlanHash,
  type D2CAgent,
} from "@ui-forge/d2c-agent";
import {
  SharpPixelVisualEvaluator,
  type VisualEvaluator,
  type VisualEvaluation,
  type VisualImage,
} from "@ui-forge/visual-evaluator";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { z } from "zod";

const maximumManifestBytes = 1024 * 1024;
const maximumOutputCharacters = 64 * 1024;
const buildTimeoutMs = 5 * 60_000;
const previewStartupTimeoutMs = 45_000;
const pageRenderTimeoutMs = 45_000;
const defaultVisualThreshold = 0.1;
const supportedBuildScript = /^(?:tsc(?: -b)? && )?vite build(?: --emptyOutDir)?$/;
const dependencyMapSchema = z.record(z.string(), z.string());
const packageManifestSchema = z.object({
  packageManager: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: dependencyMapSchema.optional(),
  devDependencies: dependencyMapSchema.optional(),
});

interface CommandResult {
  exitCode: number | null;
  durationMs: number;
  output: string;
  timedOut: boolean;
  failedCommand?: D2CAgent.DeliveryCommand;
}

type CommandAuditReporter = (event:
  | { type: "started"; command: D2CAgent.DeliveryCommand }
  | {
      type: "completed";
      command: D2CAgent.DeliveryCommand;
      exitCode: number | null;
      durationMs: number;
    }
) => void | Promise<void>;

interface RunningPreview {
  process: ChildProcess;
  startupError?: Error;
  url: string;
}

type SupportedPackageManager = "npm" | "pnpm";

interface PackageManagerRuntime {
  name: SupportedPackageManager;
  cliPath: string;
}

/** 配置自动交付验收的视觉阈值与可替换评测实现。 */
export interface FileSystemProjectDeliveryValidatorOptions {
  visualThreshold?: number;
  visualEvaluator?: VisualEvaluator;
  /** 测试或宿主可显式绑定的 npm CLI 文件；生产默认从当前 Node 运行时解析。 */
  npmCliPath?: string;
  /** 测试或宿主可显式绑定的 pnpm CLI 文件；生产默认使用当前 Node 附带的 Corepack。 */
  pnpmCliPath?: string;
  /** 测试可固定 Vite Preview 端口；生产按 taskId 确定性选择。 */
  previewPort?: number;
  /** 将不含环境变量和输出正文的命令生命周期发送到安全日志边界。 */
  commandAuditReporter?: (event: D2CAgent.DeliveryCommandAuditEvent) => void | Promise<void>;
}

/** 仅运行固定构建脚本形态和本地 Vite 二进制，并把失败收敛为人工阻塞结果。 */
export class FileSystemProjectDeliveryValidator implements D2CAgent.ProjectDeliveryValidator {
  private readonly visualThreshold: number;
  private readonly visualEvaluator: VisualEvaluator;
  private readonly npmCliPath: string | undefined;
  private readonly pnpmCliPath: string | undefined;
  private readonly previewPort: number | undefined;
  private readonly commandAuditReporter:
    | ((event: D2CAgent.DeliveryCommandAuditEvent) => void | Promise<void>)
    | undefined;

  /** 注入交付证据存储，并校验视觉门禁阈值。 */
  constructor(
    private readonly evidenceStore: D2CAgent.DeliveryEvidenceStore,
    options: FileSystemProjectDeliveryValidatorOptions = {},
  ) {
    this.visualThreshold = options.visualThreshold ?? defaultVisualThreshold;
    if (!Number.isFinite(this.visualThreshold)
      || this.visualThreshold < 0 || this.visualThreshold > 1) {
      throw new Error("视觉差异阈值必须位于 0 到 1 之间。");
    }
    this.visualEvaluator = options.visualEvaluator ?? new SharpPixelVisualEvaluator();
    this.npmCliPath = options.npmCliPath;
    this.pnpmCliPath = options.pnpmCliPath;
    this.previewPort = options.previewPort;
    this.commandAuditReporter = options.commandAuditReporter;
  }

  /** 只读解析真实命令和工作目录，并在任何子进程启动前返回持久化计划。 */
  async prepare(input: Parameters<D2CAgent.ProjectDeliveryValidator["prepare"]>[0]): Promise<D2CAgent.DeliveryCommandPlan> {
    const projectRoot = await requireProjectRoot(input.inspection.projectRoot);
    const workspaceRoot = await requireProjectRoot(input.workspaceRoot);
    const manifest = await readManifest(projectRoot);
    const withinWorkspace = isWithinRoot(workspaceRoot, projectRoot);
    const commands = await this.resolveDeliveryCommands({
      taskId: input.taskId,
      projectRoot,
      manifest,
      workspaceScope: withinWorkspace ? "within-workspace" : "manual-only",
    });
    const commandPlanHash = calculateDeliveryCommandPlanHash({
      patchSetHash: input.patchSetHash,
      workspaceRoot,
      commands,
    });
    const preparedAt = new Date().toISOString();
    const plan: D2CAgent.DeliveryCommandPlan = withinWorkspace
      && commands.length > 0
      && commands.every((command) => command.workspaceScope === "within-workspace")
      ? {
          status: "approval_required",
          patchSetHash: input.patchSetHash,
          workspaceRoot,
          commandPlanHash,
          commands,
          summary: `系统准备执行 ${commands.length} 条真实命令；批准只对当前命令哈希有效。`,
          preparedAt,
        }
      : {
          status: "manual_only",
          patchSetHash: input.patchSetHash,
          workspaceRoot,
          commandPlanHash,
          commands,
          summary: "当前命令不满足 Workspace 内自动执行策略。",
          reason: withinWorkspace
            ? "项目脚本或包管理器不在自动执行白名单内，请复制命令后人工处理。"
            : "命令工作目录位于当前 Workspace 外，系统不会提供自动执行入口。",
          preparedAt,
        };
    await this.commandAuditReporter?.({
      type: "proposed",
      taskId: input.taskId,
      commandPlanHash,
      commands: structuredClone(commands),
    });
    return plan;
  }

  /** 从白名单脚本、受信包管理器运行时和固定 Preview 端口生成全部真实 argv。 */
  private async resolveDeliveryCommands(input: {
    taskId: string;
    projectRoot: string;
    manifest: z.infer<typeof packageManifestSchema>;
    workspaceScope: D2CAgent.DeliveryCommand["workspaceScope"];
  }): Promise<D2CAgent.DeliveryCommand[]> {
    const script = input.manifest.scripts?.build?.trim();
    const packageManager = await resolvePackageManagerRuntime(
      input.manifest.packageManager,
      {
        npmCliPath: this.npmCliPath,
        pnpmCliPath: this.pnpmCliPath,
      },
    ).catch(() => undefined);
    if (!script || !supportedBuildScript.test(script)) {
      return packageManager ? [createCommand({
        commandId: "manual-build",
        purpose: "build-vite",
        cwd: input.projectRoot,
        executable: process.execPath,
        arguments: [packageManager.cliPath, "run", "build"],
        timeoutMs: buildTimeoutMs,
        networkAccess: "none",
        workspaceScope: "manual-only",
      })] : [];
    }
    if (!packageManager) return [];
    const commands: D2CAgent.DeliveryCommand[] = [];
    const typeScriptPath = join(input.projectRoot, "node_modules", "typescript", "bin", "tsc");
    const vitePath = join(input.projectRoot, "node_modules", "vite", "bin", "vite.js");
    const requiredPaths = script.startsWith("tsc") ? [typeScriptPath, vitePath] : [vitePath];
    const dependenciesMissing = (await Promise.all(requiredPaths.map(isRegularFile))).some((exists) => !exists);
    if (dependenciesMissing) {
      commands.push(createCommand({
        commandId: "install-dependencies",
        purpose: "install-dependencies",
        cwd: input.projectRoot,
        executable: process.execPath,
        arguments: await createInstallArguments(packageManager, input.projectRoot),
        timeoutMs: buildTimeoutMs,
        networkAccess: "required",
        workspaceScope: input.workspaceScope,
      }));
    }
    if (script.startsWith("tsc")) {
      commands.push(createCommand({
        commandId: "build-typescript",
        purpose: "build-typescript",
        cwd: input.projectRoot,
        executable: process.execPath,
        arguments: [typeScriptPath, ...(script.startsWith("tsc -b") ? ["-b"] : [])],
        timeoutMs: buildTimeoutMs,
        networkAccess: "none",
        workspaceScope: input.workspaceScope,
      }));
    }
    commands.push(createCommand({
      commandId: "build-vite",
      purpose: "build-vite",
      cwd: input.projectRoot,
      executable: process.execPath,
      arguments: [vitePath, "build", ...(script.endsWith(" --emptyOutDir") ? ["--emptyOutDir"] : [])],
      timeoutMs: buildTimeoutMs,
      networkAccess: "none",
      workspaceScope: input.workspaceScope,
    }));
    const previewPort = this.previewPort ?? deterministicPreviewPort(input.taskId);
    commands.push(createCommand({
      commandId: "start-vite-preview",
      purpose: "start-vite-preview",
      cwd: input.projectRoot,
      executable: process.execPath,
      arguments: [
        vitePath,
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(previewPort),
        "--strictPort",
      ],
      timeoutMs: previewStartupTimeoutMs + pageRenderTimeoutMs,
      networkAccess: "none",
      workspaceScope: input.workspaceScope,
    }));
    return commands;
  }

  /** 把准备阶段异常也收敛为结构化人工阻塞结果，同时传播显式取消。 */
  async validate(input: Parameters<D2CAgent.ProjectDeliveryValidator["validate"]>[0]): Promise<D2CAgent.ProjectDeliveryValidationOutcome> {
    try {
      return await this.runValidation(input);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const reason = errorMessage(error);
      await this.commandAuditReporter?.({
        type: "blocked",
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
        reasonCode: classifyCommandFailure(error),
      });
      return blockedOutcome(input.patchSetHash, {
        status: "blocked",
        command: "未启动",
        durationMs: 0,
        summary: "目标项目构建未启动。",
        outputSummary: "",
        reason,
      }, reason);
    }
  }

  /** 顺序执行构建、页面渲染和视觉门禁，任一步失败即停止并保留现有文件。 */
  private async runValidation(input: Parameters<D2CAgent.ProjectDeliveryValidator["validate"]>[0]): Promise<D2CAgent.ProjectDeliveryValidationOutcome> {
    const projectRoot = await requireProjectRoot(input.inspection.projectRoot);
    const workspaceRoot = await requireProjectRoot(input.workspaceRoot);
    assertApprovedCommandPlan(input, workspaceRoot, projectRoot);
    await ensurePrivateRuntimeDirectories(projectRoot);
    const manifest = await readManifest(projectRoot);
    const expectedCommands = await this.resolveDeliveryCommands({
      taskId: input.taskId,
      projectRoot,
      manifest,
      workspaceScope: "within-workspace",
    });
    assertPreparedCommandPolicy(input, expectedCommands);
    const installCommand = input.commandPlan.commands.find(
      (command) => command.purpose === "install-dependencies",
    );
    if (installCommand) {
      await input.reportProgress?.({
        type: "delivery-command-start",
        purpose: "install-dependencies",
        command: installCommand.displayCommand,
      });
      const install = await runCommand(
        installCommand,
        input.signal,
        (event) => this.commandAuditReporter?.({
          ...event,
          taskId: input.taskId,
          commandPlanHash: input.commandPlan.commandPlanHash,
        }),
      );
      if (install.exitCode !== 0 || install.timedOut) {
        await input.reportProgress?.({
          type: "delivery-command-blocked",
          purpose: "install-dependencies",
          durationMs: install.durationMs,
        });
        const reason = install.timedOut
          ? "依赖安装超过 5 分钟上限。"
          : `依赖安装进程退出码为 ${String(install.exitCode)}。`;
        await this.commandAuditReporter?.({
          type: "blocked",
          taskId: input.taskId,
          commandPlanHash: input.commandPlan.commandPlanHash,
          command: structuredClone(installCommand),
          reasonCode: install.timedOut ? "COMMAND_TIMEOUT" : "COMMAND_EXIT_NONZERO",
        });
        return blockedOutcome(input.patchSetHash, {
          status: "blocked",
          command: installCommand.displayCommand,
          durationMs: install.durationMs,
          summary: "目标项目依赖安装未通过。",
          outputSummary: sanitizeOutput(install.output, projectRoot),
          reason,
        }, reason);
      }
      await input.reportProgress?.({
        type: "delivery-command-complete",
        purpose: "install-dependencies",
        durationMs: install.durationMs,
      });
    }
    await assertPreparedLocalCommands(projectRoot, input.commandPlan.commands);
    const buildCommands = input.commandPlan.commands.filter(
      (command) => command.purpose === "build-typescript" || command.purpose === "build-vite",
    );
    const buildLabel = buildCommands.map((command) => command.displayCommand).join(" && ");
    await input.reportProgress?.({ type: "delivery-build-start", command: buildLabel });
    const build = await runBuildCommands(
      buildCommands,
      buildTimeoutMs,
      input.signal,
      (event) => this.commandAuditReporter?.({
        ...event,
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
      }),
    );
    const buildResult: D2CAgent.DeliveryBuildResult = build.exitCode === 0 && !build.timedOut
      ? {
          status: "passed",
          command: buildLabel,
          durationMs: build.durationMs,
          summary: "目标项目构建通过。",
          outputSummary: sanitizeOutput(build.output, projectRoot),
        }
      : {
          status: "blocked",
          command: buildLabel,
          durationMs: build.durationMs,
          summary: "目标项目构建未通过。",
          outputSummary: sanitizeOutput(build.output, projectRoot),
          reason: build.timedOut ? "构建超过 5 分钟上限。" : `构建进程退出码为 ${String(build.exitCode)}。`,
        };
    if (buildResult.status === "blocked") {
      await input.reportProgress?.({ type: "delivery-build-blocked", durationMs: build.durationMs });
      await this.commandAuditReporter?.({
        type: "blocked",
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
        ...(build.failedCommand ? { command: structuredClone(build.failedCommand) } : {}),
        reasonCode: build.timedOut ? "COMMAND_TIMEOUT" : "COMMAND_EXIT_NONZERO",
      });
      return blockedOutcome(input.patchSetHash, buildResult, buildResult.reason ?? buildResult.summary);
    }
    await input.reportProgress?.({ type: "delivery-build-complete", durationMs: build.durationMs });

    const viewport = resolveViewport(input.designPreview);
    await input.reportProgress?.({
      type: "delivery-render-start",
      previewPath: input.target.previewPath,
    });
    const renderStartedAt = performance.now();
    let screenshot: Buffer;
    let referenceImage: VisualImage;
    let actualImage: D2CAgent.DeliveryEvidenceReference;
    try {
      referenceImage = decodeDesignPreview(input.designPreview);
      screenshot = await renderVitePage({
        projectRoot,
        manifest,
        command: requirePreparedCommand(input.commandPlan.commands, "start-vite-preview"),
        audit: (event) => this.commandAuditReporter?.({
          ...event,
          taskId: input.taskId,
          commandPlanHash: input.commandPlan.commandPlanHash,
        }),
        previewPath: validatePreviewPath(input.target.previewPath),
        viewport,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      throwIfAborted(input.signal);
      actualImage = await this.evidenceStore.write({
        taskId: input.taskId,
        patchSetHash: input.patchSetHash,
        kind: "actual",
        data: screenshot,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      const durationMs = elapsedMilliseconds(renderStartedAt);
      const reason = errorMessage(error);
      const previewCommand = requirePreparedCommand(
        input.commandPlan.commands,
        "start-vite-preview",
      );
      await this.commandAuditReporter?.({
        type: "blocked",
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
        command: structuredClone(previewCommand),
        reasonCode: "PREVIEW_OR_RENDER_BLOCKED",
      });
      const render: D2CAgent.DeliveryRenderResult = {
        status: "blocked",
        durationMs,
        summary: "页面渲染未完成。",
        reason,
        previewPath: input.target.previewPath,
        viewport,
      };
      await input.reportProgress?.({ type: "delivery-render-blocked", durationMs });
      return blockedOutcome(input.patchSetHash, buildResult, reason, render);
    }
    throwIfAborted(input.signal);
    const renderDurationMs = elapsedMilliseconds(renderStartedAt);
    const renderResult: D2CAgent.DeliveryRenderResult = {
      status: "passed",
      durationMs: renderDurationMs,
      summary: "页面已在受控本地 Vite 预览中完成渲染。",
      previewPath: input.target.previewPath,
      viewport,
      actualImage,
    };
    await input.reportProgress?.({ type: "delivery-render-complete", durationMs: renderDurationMs });

    await input.reportProgress?.({
      type: "delivery-visual-start",
      threshold: this.visualThreshold,
    });
    const visualStartedAt = performance.now();
    throwIfAborted(input.signal);
    let evaluation: VisualEvaluation;
    let differenceImage: D2CAgent.DeliveryEvidenceReference;
    try {
      evaluation = await this.visualEvaluator.evaluate({
        referenceImage,
        actualImage: { data: screenshot, mimeType: "image/png" },
        viewport,
        threshold: this.visualThreshold,
      });
      throwIfAborted(input.signal);
      differenceImage = await this.evidenceStore.write({
        taskId: input.taskId,
        patchSetHash: input.patchSetHash,
        kind: "difference",
        data: evaluation.differenceImage,
        width: viewport.width,
        height: viewport.height,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      const durationMs = elapsedMilliseconds(visualStartedAt);
      const reason = errorMessage(error);
      await input.reportProgress?.({ type: "delivery-visual-blocked", durationMs });
      await this.commandAuditReporter?.({
        type: "blocked",
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
        reasonCode: "VISUAL_EVALUATION_BLOCKED",
      });
      return blockedOutcome(input.patchSetHash, buildResult, reason, renderResult);
    }
    throwIfAborted(input.signal);
    const visualDurationMs = elapsedMilliseconds(visualStartedAt);
    const visualResult: D2CAgent.DeliveryVisualResult = {
      status: evaluation.passed ? "passed" : "blocked",
      durationMs: visualDurationMs,
      summary: evaluation.passed ? "页面视觉差异通过自动门禁。" : "页面视觉差异超过自动门禁。",
      ...(!evaluation.passed
        ? { reason: `显著差异像素占比 ${formatRatio(evaluation.pixelDifferenceRatio)} 超过 ${formatRatio(evaluation.threshold)}。` }
        : {}),
      pixelDifferenceRatio: evaluation.pixelDifferenceRatio,
      threshold: evaluation.threshold,
      differenceImage,
    };
    if (!evaluation.passed) {
      await input.reportProgress?.({
        type: "delivery-visual-blocked",
        durationMs: visualDurationMs,
        pixelDifferenceRatio: evaluation.pixelDifferenceRatio,
      });
      await this.commandAuditReporter?.({
        type: "blocked",
        taskId: input.taskId,
        commandPlanHash: input.commandPlan.commandPlanHash,
        reasonCode: "VISUAL_GATE_BLOCKED",
      });
      return blockedOutcome(
        input.patchSetHash,
        buildResult,
        visualResult.reason ?? visualResult.summary,
        renderResult,
        visualResult,
      );
    }
    await input.reportProgress?.({
      type: "delivery-visual-complete",
      durationMs: visualDurationMs,
      pixelDifferenceRatio: evaluation.pixelDifferenceRatio,
    });
    return {
      status: "passed",
      patchSetHash: input.patchSetHash,
      summary: "目标项目已通过构建、页面渲染和视觉差异三项自动门禁。",
      build: buildResult,
      render: renderResult,
      visual: visualResult,
      validatedAt: new Date().toISOString(),
    };
  }
}

/** 创建展示字符串与 spawn 参数来自同一结构的命令。 */
function createCommand(input: Omit<D2CAgent.DeliveryCommand, "displayCommand">): D2CAgent.DeliveryCommand {
  return {
    ...input,
    displayCommand: [input.executable, ...input.arguments].map(quoteCommandArgument).join(" "),
  };
}

/** 使用可复制但不会参与执行解析的 POSIX 风格安全引用展示参数。 */
function quoteCommandArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** 从 packageManager 字段选择固定支持的运行时，拒绝 PATH 中的任意可执行文件。 */
async function resolvePackageManagerRuntime(
  configuredPackageManager: string | undefined,
  cliPaths: {
    npmCliPath: string | undefined;
    pnpmCliPath: string | undefined;
  },
): Promise<PackageManagerRuntime> {
  const name = parseSupportedPackageManager(configuredPackageManager);
  if (!name) throw new Error("目标项目声明的包管理器不在自动执行白名单内。");
  return {
    name,
    cliPath: name === "npm"
      ? await resolveNpmCliPath(cliPaths.npmCliPath)
      : await resolvePnpmCliPath(cliPaths.pnpmCliPath),
  };
}

/** 未声明 packageManager 时保持 npm 兼容，只接受 npm 或 pnpm 的精确名称。 */
function parseSupportedPackageManager(value: string | undefined): SupportedPackageManager | undefined {
  const configured = value?.trim();
  if (!configured || /^npm(?:@|$)/.test(configured)) return "npm";
  if (/^pnpm(?:@|$)/.test(configured)) return "pnpm";
  return undefined;
}

/** 为受支持包管理器生成禁用生命周期脚本且缓存位于项目内的安装 argv。 */
async function createInstallArguments(
  packageManager: PackageManagerRuntime,
  projectRoot: string,
): Promise<string[]> {
  if (packageManager.name === "pnpm") {
    return [
      packageManager.cliPath,
      "install",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--prod=false",
      "--store-dir",
      join(projectRoot, ".ui-forge", "pnpm-store"),
    ];
  }
  const installMode = await isRegularFile(join(projectRoot, "package-lock.json"))
    ? "ci"
    : "install";
  return [
    packageManager.cliPath,
    installMode,
    "--ignore-scripts",
    "--include=dev",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(projectRoot, ".ui-forge", "npm-cache"),
  ];
}

/** 从显式配置、npm 启动环境或当前 Node 安装目录解析真实 npm CLI 文件。 */
async function resolveNpmCliPath(configured: string | undefined): Promise<string> {
  const candidates = [
    configured,
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
  for (const candidate of candidates) {
    const resolved = await realpath(candidate).catch(() => undefined);
    if (!resolved) continue;
    const stats = await lstat(resolved).catch(() => undefined);
    if (stats?.isFile()) return resolved;
  }
  throw new Error("未找到当前 Node 运行时对应的 npm CLI；依赖安装只能人工完成。");
}

/** 从显式配置或当前 Node 的 Corepack 安装解析真实 pnpm CLI 文件。 */
async function resolvePnpmCliPath(configured: string | undefined): Promise<string> {
  const candidates = [
    configured,
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "corepack", "dist", "pnpm.js"),
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "pnpm", "bin", "pnpm.cjs"),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
  for (const candidate of candidates) {
    const resolved = await realpath(candidate).catch(() => undefined);
    if (!resolved) continue;
    const stats = await lstat(resolved).catch(() => undefined);
    if (stats?.isFile()) return resolved;
  }
  throw new Error("未找到当前 Node 运行时对应的 pnpm CLI；依赖安装只能人工完成。");
}

/** 使用 taskId 为 Preview 选择稳定高位端口，使批准内容在恢复后保持不变。 */
function deterministicPreviewPort(taskId: string): number {
  let hash = 0;
  for (const character of taskId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return 42_000 + (hash % 10_000);
}

/** 判断路径当前是否是普通文件；缺失、目录和符号链接均返回 false。 */
async function isRegularFile(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => undefined);
  return stats?.isFile() === true && !stats.isSymbolicLink();
}

/** 校验批准哈希、Patch、Workspace 与全部 cwd 在执行时仍精确一致。 */
function assertApprovedCommandPlan(
  input: Parameters<D2CAgent.ProjectDeliveryValidator["validate"]>[0],
  workspaceRoot: string,
  projectRoot: string,
): void {
  const plan = input.commandPlan;
  const actualHash = calculateDeliveryCommandPlanHash(plan);
  if (actualHash !== plan.commandPlanHash
    || input.approvedCommandPlanHash !== plan.commandPlanHash) {
    throw new Error("交付命令内容或批准哈希已经变化，已拒绝执行。");
  }
  if (plan.patchSetHash !== input.patchSetHash) {
    throw new Error("交付命令计划与当前 Patch 不一致，已拒绝执行。");
  }
  if (plan.workspaceRoot !== workspaceRoot || !isWithinRoot(workspaceRoot, projectRoot)) {
    throw new Error("交付命令计划不属于当前 Workspace，必须人工处理。");
  }
  if (plan.commands.length === 0 || plan.commands.some((command) => (
    command.workspaceScope !== "within-workspace"
      || resolve(command.cwd) !== projectRoot
  ))) {
    throw new Error("交付命令工作目录位于当前 Workspace 外，已拒绝执行。");
  }
}

/** 重建当前项目的完整白名单命令，防止合法哈希包装任意 executable 或 argv。 */
function assertPreparedCommandPolicy(
  input: Parameters<D2CAgent.ProjectDeliveryValidator["validate"]>[0],
  expectedCommands: readonly D2CAgent.DeliveryCommand[],
): void {
  const expectedHash = calculateDeliveryCommandPlanHash({
    patchSetHash: input.patchSetHash,
    workspaceRoot: input.commandPlan.workspaceRoot,
    commands: expectedCommands,
  });
  if (expectedHash !== input.commandPlan.commandPlanHash) {
    throw new Error("当前项目状态对应的真实命令已经变化，请重新审阅并批准。");
  }
}

/** 安装完成后校验目标项目 CLI 未通过符号链接逃逸 Workspace。 */
async function assertPreparedLocalCommands(
  projectRoot: string,
  commands: readonly D2CAgent.DeliveryCommand[],
): Promise<void> {
  for (const command of commands) {
    if (command.purpose === "install-dependencies") continue;
    const requested = command.arguments[0];
    if (!requested) throw new Error("本地交付命令缺少运行文件。");
    const resolved = await realpath(requested).catch(() => {
      throw new Error(`未找到已批准命令对应的本地运行文件：${command.commandId}`);
    });
    assertWithinProject(projectRoot, resolved);
    const stats = await lstat(resolved);
    if (!stats.isFile()) throw new Error(`本地运行文件不是普通文件：${command.commandId}`);
  }
}

/** 从已批准计划中读取唯一用途命令。 */
function requirePreparedCommand(
  commands: readonly D2CAgent.DeliveryCommand[],
  purpose: D2CAgent.DeliveryCommand["purpose"],
): D2CAgent.DeliveryCommand {
  const matches = commands.filter((command) => command.purpose === purpose);
  if (matches.length !== 1 || !matches[0]) throw new Error(`交付命令计划缺少唯一命令：${purpose}`);
  return matches[0];
}

/** 从精确 Preview argv 读取 loopback 端口并拒绝参数漂移。 */
function parsePreparedPreviewPort(command: D2CAgent.DeliveryCommand): number {
  const portFlagIndex = command.arguments.indexOf("--port");
  const port = Number(command.arguments[portFlagIndex + 1]);
  if (portFlagIndex < 0 || !Number.isInteger(port) || port < 1 || port > 65_535
    || command.arguments[portFlagIndex - 2] !== "--host"
    || command.arguments[portFlagIndex - 1] !== "127.0.0.1"
    || command.arguments.at(-1) !== "--strictPort") {
    throw new Error("Vite Preview 命令参数已经变化，已拒绝执行。");
  }
  return port;
}

/** 将安全审计错误压缩为稳定分类，避免写入原始异常消息。 */
function classifyCommandFailure(error: unknown): string {
  if (error instanceof Error && /批准哈希|内容/.test(error.message)) return "COMMAND_HASH_MISMATCH";
  if (error instanceof Error && /Workspace|工作目录|逃逸/.test(error.message)) return "WORKSPACE_SCOPE_REJECTED";
  return "COMMAND_EXECUTION_BLOCKED";
}

/** 解析并校验根 package.json，拒绝符号链接和超大文件。 */
async function readManifest(projectRoot: string): Promise<z.infer<typeof packageManifestSchema>> {
  const manifestPath = join(projectRoot, "package.json");
  const stats = await lstat(manifestPath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximumManifestBytes) {
    throw new Error("自动构建要求根 package.json 是不超过 1 MiB 的普通文件。");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("自动构建要求根 package.json 是有效 JSON。");
  }
  return packageManifestSchema.parse(value);
}

/** 顺序运行固定本地 CLI，并让全部步骤共享一个总超时和输出上限。 */
async function runBuildCommands(
  commands: readonly D2CAgent.DeliveryCommand[],
  timeoutMs: number,
  signal?: AbortSignal,
  audit?: CommandAuditReporter,
): Promise<CommandResult> {
  const startedAt = performance.now();
  let output = "";
  for (const command of commands) {
    const elapsed = elapsedMilliseconds(startedAt);
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      return {
        exitCode: null,
        durationMs: elapsed,
        output,
        timedOut: true,
        failedCommand: structuredClone(command),
      };
    }
    const result = await runCommand({ ...command, timeoutMs: remaining }, signal, audit);
    output = appendBoundedOutput(output, `$ ${command.displayCommand}\n${result.output}`);
    if (result.exitCode !== 0 || result.timedOut) {
      return {
        exitCode: result.exitCode,
        durationMs: elapsedMilliseconds(startedAt),
        output,
        timedOut: result.timedOut,
        failedCommand: structuredClone(command),
      };
    }
  }
  return { exitCode: 0, durationMs: elapsedMilliseconds(startedAt), output, timedOut: false };
}

/** 拼接多阶段构建输出，同时保持公开日志总量上限。 */
function appendBoundedOutput(current: string, next: string): string {
  if (current.length >= maximumOutputCharacters) return current;
  const separator = current ? "\n" : "";
  return `${current}${separator}${next}`.slice(0, maximumOutputCharacters);
}

/** 使用 shell=false、脱敏环境、输出上限、超时和取消信号执行一个白名单命令。 */
async function runCommand(
  command: D2CAgent.DeliveryCommand,
  signal?: AbortSignal,
  audit?: CommandAuditReporter,
): Promise<CommandResult> {
  throwIfAborted(signal);
  const startedAt = performance.now();
  await audit?.({ type: "started", command: structuredClone(command) });
  const child = spawn(command.executable, command.arguments, {
    cwd: command.cwd,
    env: createSanitizedEnvironment(command.networkAccess, command.cwd),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timedOut = false;
  const append = (chunk: Buffer) => {
    if (output.length < maximumOutputCharacters) {
      output += chunk.toString("utf8").slice(0, maximumOutputCharacters - output.length);
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const stopForAbort = () => terminateChild(child);
  signal?.addEventListener("abort", stopForAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChild(child);
  }, command.timeoutMs);
  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", resolveExit);
    });
    throwIfAborted(signal);
    const result = { exitCode, durationMs: elapsedMilliseconds(startedAt), output, timedOut };
    await audit?.({
      type: "completed",
      command: structuredClone(command),
      exitCode,
      durationMs: result.durationMs,
    });
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stopForAbort);
  }
}

/** 启动固定本地 Vite 预览，使用 Playwright 截图并阻止所有外部网络请求。 */
async function renderVitePage(input: {
  projectRoot: string;
  manifest: z.infer<typeof packageManifestSchema>;
  command: D2CAgent.DeliveryCommand;
  audit?: CommandAuditReporter;
  previewPath: string;
  viewport: { width: number; height: number };
  signal?: AbortSignal;
}): Promise<Buffer> {
  throwIfAborted(input.signal);
  const dependencies = { ...input.manifest.devDependencies, ...input.manifest.dependencies };
  if (!dependencies.vite) throw new Error("自动页面渲染要求目标项目声明本地 Vite 依赖。");
  const port = parsePreparedPreviewPort(input.command);
  await input.audit?.({ type: "started", command: structuredClone(input.command) });
  const previewStartedAt = performance.now();
  const preview = startVitePreview(input.command, port);
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  let handleAbort: (() => void) | undefined;
  let succeeded = false;
  try {
    await waitForPreview(preview, input.signal);
    throwIfAborted(input.signal);
    browser = await chromium.launch({
      headless: true,
      env: createSanitizedEnvironment("none", input.projectRoot),
    });
    throwIfAborted(input.signal);
    handleAbort = () => { void browser?.close(); };
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    browserContext = await browser.newContext({
      viewport: input.viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    let blockedExternalRequest = false;
    await browserContext.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (isAllowedBrowserUrl(url, port)) {
        await route.continue();
        return;
      }
      blockedExternalRequest = true;
      await route.abort("blockedbyclient");
    });
    await browserContext.routeWebSocket(/.*/, async (route) => {
      const url = new URL(route.url());
      if ((url.protocol === "ws:" || url.protocol === "wss:")
        && url.hostname === "127.0.0.1" && url.port === String(port)) {
        route.connectToServer();
        return;
      }
      blockedExternalRequest = true;
      await route.close({ code: 1008, reason: "External network is blocked." });
    });
    const page = await browserContext.newPage();
    await page.goto(`${preview.url}${input.previewPath}`, {
      waitUntil: "networkidle",
      timeout: pageRenderTimeoutMs,
    });
    throwIfAborted(input.signal);
    await page.addStyleTag({
      content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
    });
    await page.evaluate("document.fonts.ready");
    throwIfAborted(input.signal);
    if (blockedExternalRequest) {
      throw new Error("页面尝试访问外部网络资源，已阻止并停止视觉验收。");
    }
    const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
    throwIfAborted(input.signal);
    succeeded = true;
    return screenshot;
  } catch (error: unknown) {
    if (input.signal?.aborted) {
      throw new DOMException("自动交付验收已由用户终止。", "AbortError");
    }
    throw error;
  } finally {
    if (handleAbort) input.signal?.removeEventListener("abort", handleAbort);
    try {
      await browserContext?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        terminateChild(preview.process);
        await input.audit?.({
          type: "completed",
          command: structuredClone(input.command),
          exitCode: succeeded ? 0 : preview.process.exitCode,
          durationMs: elapsedMilliseconds(previewStartedAt),
        });
      }
    }
  }
}

/** 使用 Node 直接启动目标项目内 Vite CLI，避免执行任意 preview 脚本。 */
function startVitePreview(command: D2CAgent.DeliveryCommand, port: number): RunningPreview {
  const child = spawn(command.executable, command.arguments, {
    cwd: command.cwd,
    env: createSanitizedEnvironment(command.networkAccess, command.cwd),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const preview: RunningPreview = { process: child, url: `http://127.0.0.1:${port}` };
  child.once("error", (error) => {
    preview.startupError = error;
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return preview;
}

/** 在限定时间内轮询本地预览入口，同时传播取消和进程提前退出。 */
async function waitForPreview(preview: RunningPreview, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + previewStartupTimeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (preview.startupError) {
      throw new Error(`Vite 预览进程启动失败：${preview.startupError.message}`);
    }
    if (preview.process.exitCode !== null) throw new Error("Vite 预览进程在页面就绪前退出。");
    try {
      if (await probePreview(preview.url, deadline, signal)) return;
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Vite 预览在 45 秒内未就绪。");
}

/** 解码受控内联 SVG 或 PNG；远程和其他 Data URL 明确转人工。 */
function decodeDesignPreview(preview: D2CAgent.DesignPreview | undefined): VisualImage {
  const match = preview?.url.match(/^data:(image\/svg\+xml|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("自动视觉验收要求设计来源提供安全的内联 SVG 或 PNG 预览。");
  const mimeType = match[1] === "image/png" ? "image/png" : "image/svg+xml";
  const encoded = match[2];
  if (!mimeType || !encoded) throw new Error("设计预览 Data URL 不完整。");
  const data = Buffer.from(encoded, "base64");
  if (data.length === 0 || data.length > 5 * 1024 * 1024) {
    throw new Error("设计预览必须位于 1 Byte 到 5 MiB 之间。");
  }
  if (mimeType === "image/png") {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!data.subarray(0, signature.length).equals(signature)) {
      throw new Error("设计 PNG 预览签名无效。");
    }
  } else {
    assertSafeSvgPreview(data.toString("utf8"));
  }
  return { data, mimeType };
}

/** 拒绝可能触发脚本、外部实体或远程资源读取的 SVG 标记。 */
function assertSafeSvgPreview(svg: string): void {
  if (!/<svg\b/i.test(svg)
    || /<\/?(?:script|foreignObject|style)\b/i.test(svg)
    || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)
    || /\bon[a-z]+\s*=/i.test(svg)
    || /(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/)/i.test(svg)
    || /url\s*\(\s*["']?(?!#|data:image\/)/i.test(svg)
    || /@import/i.test(svg)) {
    throw new Error("设计 SVG 预览包含自动视觉验收不允许的可执行或外部资源内容。");
  }
}

/** 从设计预览确定截图视口，并限定到浏览器和协议允许范围。 */
function resolveViewport(preview: D2CAgent.DesignPreview | undefined): { width: number; height: number } {
  return {
    width: clampDimension(preview?.width ?? 1440, 320, 1920),
    height: clampDimension(preview?.height ?? 900, 240, 1200),
  };
}

/** 校验同源页面路径，拒绝协议相对地址、Query 和 Fragment。 */
function validatePreviewPath(path: string): string {
  if (!/^\/(?!\/)(?:[^?#]*)$/.test(path)) throw new Error("自动渲染入口必须是同源绝对页面路径。");
  return path;
}

/** 创建只包含运行必需字段且不携带模型或设计凭证的子进程环境。 */
function createSanitizedEnvironment(
  networkAccess: D2CAgent.DeliveryCommand["networkAccess"],
  projectRoot: string,
): NodeJS.ProcessEnv {
  const runtimeHome = join(projectRoot, ".ui-forge", "delivery-home");
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    NODE_ENV: "production",
    BROWSER: "none",
    HOME: runtimeHome,
    USERPROFILE: runtimeHome,
    XDG_CACHE_HOME: join(runtimeHome, ".cache"),
    XDG_CONFIG_HOME: join(runtimeHome, ".config"),
    COREPACK_HOME: join(projectRoot, ".ui-forge", "corepack"),
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_userconfig: join(runtimeHome, ".npmrc"),
    npm_config_update_notifier: "false",
    ...(networkAccess === "none" ? { npm_config_offline: "true" } : {}),
  };
  for (const name of ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec"] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

/** 在批准后创建并校验不会逃逸项目的包管理器与浏览器私有运行目录。 */
async function ensurePrivateRuntimeDirectories(projectRoot: string): Promise<void> {
  const runtimeRoot = join(projectRoot, ".ui-forge");
  await ensurePrivateDirectory(projectRoot, runtimeRoot);
  for (const name of ["delivery-home", "corepack", "npm-cache", "pnpm-store"] as const) {
    await ensurePrivateDirectory(projectRoot, join(runtimeRoot, name));
  }
}

/** 创建单个私有目录，并拒绝已有符号链接或项目外真实路径。 */
async function ensurePrivateDirectory(projectRoot: string, path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error: unknown) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("自动交付私有运行目录不安全。");
  }
  const resolved = await realpath(path);
  assertWithinProject(projectRoot, resolved);
  if (resolved !== path) throw new Error("自动交付私有运行目录包含非规范路径。");
}

/** 对单次 Preview 健康探测设置短超时，避免一个无响应连接突破总期限。 */
async function probePreview(
  url: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(1_000, deadline - Date.now())),
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.body?.cancel();
    return response.ok;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/** 只允许内联资源和当前固定 loopback Preview 的 HTTP 请求。 */
function isAllowedBrowserUrl(url: URL, port: number): boolean {
  return url.protocol === "data:" || url.protocol === "blob:"
    || ((url.protocol === "http:" || url.protocol === "https:")
      && url.hostname === "127.0.0.1" && url.port === String(port));
}

/** 返回结构完整的人工阻塞结果，不自动回滚或修改已落盘文件。 */
function blockedOutcome(
  patchSetHash: string,
  build: D2CAgent.DeliveryBuildResult,
  reason: string,
  render?: D2CAgent.DeliveryRenderResult,
  visual?: D2CAgent.DeliveryVisualResult,
): D2CAgent.ProjectDeliveryValidationOutcome {
  return {
    status: "blocked",
    patchSetHash,
    summary: "自动交付验收已停止，目标项目需要人工处理。",
    reasons: [reason],
    manualActionRequired: true,
    build,
    ...(render ? { render } : {}),
    ...(visual ? { visual } : {}),
    blockedAt: new Date().toISOString(),
  };
}

/** 终止构建或预览子进程；已经退出时保持幂等。 */
function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
  force.unref();
  child.once("exit", () => clearTimeout(force));
}

/** 解析目标项目真实目录并拒绝非目录。 */
async function requireProjectRoot(path: string): Promise<string> {
  const root = await realpath(path);
  const stats = await lstat(root);
  if (!stats.isDirectory()) throw new Error("自动交付验收目标不是目录。");
  return root;
}

/** 拒绝本地工具真实路径逃逸出任务绑定项目。 */
function assertWithinProject(projectRoot: string, candidate: string): void {
  const path = relative(projectRoot, resolve(candidate));
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))) return;
  throw new Error("本地 Vite 运行文件逃逸出目标项目。");
}

/** 判断规范化候选目录是否等于或位于规范化根目录下。 */
function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

/** 裁剪并脱敏构建输出，避免公开绝对项目路径和 ANSI 控制序列。 */
function sanitizeOutput(output: string, projectRoot: string): string {
  return output
    .replaceAll(projectRoot, "[project]")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maximumOutputCharacters);
}

/** 把任意有限设计尺寸四舍五入并限制在安全区间。 */
function clampDimension(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/** 将性能计时转换为公开协议允许的非负整数毫秒。 */
function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** 把视觉差异率格式化为可审计百分比。 */
function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** 将未知异常转换为稳定错误文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "自动交付验收发生未知错误。";
}

/** 判断异常是否来自用户或传输层取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 收窄 Node.js 文件系统异常代码。 */
function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** 在每个可中断阶段传播用户取消。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("自动交付验收已由用户终止。", "AbortError");
}
