/** 为 Codex 提供任务隔离的交付报告位置和声明边界，不执行验证或写入文件。 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { NativeMethods } from "./generated/native.js";

/** 只计算任务专属报告路径；对任务标识取哈希，避免路径穿越和跨任务串读。 */
export function deliveryReportPath(temporaryDirectory: string, taskId: string): string {
  return join(
    temporaryDirectory,
    "delivery",
    createHash("sha256").update(taskId).digest("hex"),
    "report.json",
  );
}

/** 每轮提示 Codex 留存结构化声明；不改变其沙箱、审批或自主执行顺序。 */
export function deliveryContext(
  temporaryDirectory: string,
  taskId: string,
): NonNullable<NativeMethods["turn/start"]["params"]["additionalContext"]> {
  const example = {
    version: 1,
    taskId,
    generatedAt: new Date().toISOString(),
    summary: "",
    sourceFiles: [],
    checks: ["build", "interaction", "visual", "performance", "review"].map((category) => ({
      id: category,
      category,
      title: {
        build: "构建",
        interaction: "交互",
        visual: "视觉",
        performance: "性能",
        review: "审查",
      }[category],
      declaredStatus: "not-verified",
      details: "尚未验证；执行后填写检查范围、环境、操作或命令、预期结果及实测结果。",
      evidence: [],
    })),
  };
  return {
    ui_forge_delivery: {
      kind: "application",
      value: [
        `本任务的结构化交付报告固定路径：${deliveryReportPath(temporaryDirectory, taskId)}`,
        "必须保留上面完整的任务哈希目录；不要写入 delivery/report.json，也不要把临时报告移动到 delivery 根目录。若已有旧直路径报告，只能按旧格式保留，不能替代本任务固定路径。",
        "在实际实现/验证收尾时，按下面格式更新 report.json；先在同目录写临时文件再原子替换，避免半写入。只操作本任务目录，不删除其他产物。写入仍须遵守当前沙箱和审批。不要为了填报告重复运行仍有效的验证。",
        "报告是你对结果的声明，不是系统独立验收。会话结束、MCP 调用完成或命令退出 0 都不能单独证明业务需求通过。构建、交互、视觉、性能、审查分别记录，未运行写 not-verified，缺前置条件写 blocked，失败写 failed，有实际证据才写 passed。details 写验证范围、失败或阻塞原因，不填造假的分数或结论。",
        "模板中的四个大类只是起点，不是四项检查就足够。把明确需求与易回归行为拆为各自的 checks，分别保留失败、受阻和未验证项，不能用一项“交互通过”覆盖未检查的取消、错误恢复、拖拽或性能要求。不适用的类别写 not-verified 并说明范围，不为填满报告扩大任务。",
        "每项 details 记录前置状态、执行命令或真实操作、预期结果和实测结果；环境至少说明相关 URL/视口或命令工作目录，性能检查还需样本量、浏览器和计时口径。详细日志、断言结果或截图放在证据文件中。截图只能支持相应外观结论，不能代替操作结果断言；源码里有事件处理器也不能证明行为有效。",
        "generatedAt 使用实际报告生成时间；summary 最多4000字符。sourceFiles 填本次验证涉及的源码、正式测试、配置和锁文件，最多256个；每项为 {path: 工作区内规范相对路径, sha256: 该文件实际内容的64位小写SHA-256}。哈希只表明记录时的所列文件内容，不证明验证时或整个项目版本一致。验证后代码已变且未复验的项目，不能保留 passed。",
        "将检查使用的源码范围及检查时间留在实际输出中；检查期间相关源码发生变化或之后又有修复时，仅复验受影响项，未复验的结论降为 not-verified 并保留原记录。不要更新哈希后继续沿用旧的通过声明。passed 项必须引用实际证据，报告自述、文件指纹一致及空的测试日志都不构成行为通过依据。",
        "checks 最多64项，id 唯一；category 为 build/interaction/visual/performance/review/other；title 最多200字符，details 最多4000字符。每项 evidence 最多16条。文件证据必须是对象 {kind:'file',path:'绝对路径或工作区相对路径',sha256:'实际文件内容指纹'}，不能把裸字符串路径直接放入 evidence；原生证据必须是 {kind:'native',turnId:'实际轮次ID',itemId:'实际工具项ID'}。证据只能在目标工作区或 report.json 所在的本任务目录内。单文件最多16MiB、源码与证据合计最多64MiB；报告最多256KiB。不要复制私密凭据或完整设计载荷到报告。",
        "已有临时产物在本任务目录之外时，可在授权内保留原件并复制必要证据到本任务目录。有真实主线程原生标识时可用 {kind:'native',turnId:'实际轮次ID',itemId:'实际工具项ID'}；不知道ID就不填，不能猜测，也不要把命令输出里的call_id当成原生itemId。不支持跨子线程引用。不要把报告本身当作验证证据。",
        "新验证产物优先直接写到 report.json 所在目录的独立子目录。严格像素检查只在要求启用且原图、CSS视口、像素尺寸、页面状态可确认时运行；保留原图、真实截图、差异图和比较器JSON。先检查工具错误与比较条件：JSON含error、退出码2、dimensionsMatch:false或前置条件不匹配时记为blocked；仅在实际指标比较完成且pass:false时记为failed。比较器pass:true只证明本次像素指标，不能推导交互或整项任务通过。",
        "下面是待填模板，不是已执行的结果：",
        JSON.stringify(example),
      ].join("\n"),
    },
  };
}
