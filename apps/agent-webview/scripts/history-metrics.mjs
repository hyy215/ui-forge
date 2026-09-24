/** Validate the opt-in benchmark arguments and summarize repeated measurements without a pass threshold. */
import { parseArgs } from "node:util";

/** Accept only an explicit fresh output directory and a bounded repeat count. */
export function parseBenchmarkOptions(args) {
  const { values } = parseArgs({
    args,
    options: { output: { type: "string" }, repeats: { type: "string", default: "3" } },
  });
  if (!values.output?.trim()) throw new Error("Use --output <new-directory> [--repeats 1..5]");
  if (!/^[1-5]$/.test(values.repeats)) throw new Error("repeats must be an integer from 1 to 5");
  return { output: values.output, repeats: Number(values.repeats) };
}

/** Preserve missing data as an error, not a zero or an apparent improvement. */
export function summarizeNumbers(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Expected nonempty finite nonnegative measurements");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1),
  };
}

/** Group the exact expected samples; never silently summarize an incomplete benchmark run. */
export function summarizeSamples(samples, repeats) {
  const groups = [];
  for (const viewport of ["desktop", "narrow"]) {
    for (const historyItems of [100, 500, 1000]) {
      const group = samples.filter(
        (sample) => sample.viewport === viewport && sample.historyItems === historyItems,
      );
      if (
        group.length !== repeats ||
        new Set(group.map((sample) => sample.repeat)).size !== repeats ||
        group.some(
          (sample) =>
            !Number.isInteger(sample.repeat) || sample.repeat < 1 || sample.repeat > repeats,
        )
      ) {
        throw new Error(`Incomplete or duplicate samples: ${viewport}/${historyItems}`);
      }
      const metrics = {};
      for (const key of [
        "readyMs",
        "scrollReturnMs",
        "typingFrameMaxMs",
        "streamMs",
        "streamTailMs",
        "frameGapMaxMs",
        "longTaskCount",
        "longTaskMaxMs",
        "approvalMs",
        "domElements",
        "heapMiB",
      ]) {
        metrics[key] = summarizeNumbers(group.map((sample) => sample[key]));
      }
      groups.push({ viewport, historyItems, metrics });
    }
  }
  if (samples.length !== repeats * 6) throw new Error("Unexpected samples");
  return groups;
}

/** Render observed medians and worst samples, with no claim about real backend throughput. */
export function renderHistoryReport(report) {
  const lines = [
    "# 长历史页面性能基线",
    "",
    `时间：${report.startedAt}；每组 ${report.repeats} 次，另有每个视口 1 次不计入结果的 100 条预热。`,
    "",
    "生产模式构建的独立模拟入口，复用任务页组件；本机 headless Chromium、无 CPU 降速、串行运行、每次使用新浏览器上下文。不是 VS Code 安装环境，不连接模型、后端或设计服务。",
    "",
    "| 视口 | 历史条目 | 就绪 ms | 返回最新 ms | 输入到下一帧最慢 ms | 流末尾呈现 ms | 流中最长帧间隔 ms | 审批响应 ms | DOM 元素 | JS 堆 MiB |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const display = (metric) => `${metric.median.toFixed(1)} / ${metric.max.toFixed(1)}`;
  for (const { viewport, historyItems, metrics } of report.summary) {
    lines.push(
      `| ${viewport} | ${historyItems} | ${["readyMs", "scrollReturnMs", "typingFrameMaxMs", "streamTailMs", "frameGapMaxMs", "approvalMs", "domElements", "heapMiB"].map((key) => display(metrics[key])).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    "每格为中位数 / 最大值；样本少，不计算 P95、不设性能通过门槛。",
    "",
    "- 历史条目按用户消息、Agent 消息、命令、文件补丁各 25% 固定生成；另加 1 条活动消息。正文较短，工具默认折叠，不覆盖大补丁、图片与超长 Markdown。",
    "- 就绪：导航开始至条目数量正确、输入可用、字体完成加载及两次 animation frame；包括本机资源加载与自动化往返，非纯 React render 时间。",
    "- 返回最新：实际点击返回按钮至滚动到底及两帧；包含 Playwright 点击等待与轮询，不作为纯浏览器输入延迟。滚动上翻使用真实 wheel 事件。",
    "- 流：100 次增量，名义间隔 20 ms；计时器会受主线程阻塞影响，实际总耗时见 JSON，不把约 2 秒总时长当渲染成本。",
    "- 输入：流中输入固定 20 个字符，每键间隔 20 ms；记录 keydown 派发至下一 animation frame 的最大值，不包括事件派发前排队，也不等于屏幕像素已呈现。",
    "- 流末尾：最后增量发出至目标消息 DOM 含结束标记后的两帧；连续帧间隔和 >50 ms long task 仅统计流阶段（含打字和固定测量开销）。",
    "- 审批：模拟请求展示后，实际点击拒绝至请求消失后的两帧；不执行命令，不验证真实审批传输权限。",
    "- DOM / JS 堆：流和审批之后采样，不强制 GC。堆为 Chromium Runtime.getHeapUsage 的 usedSize，不是进程内存或泄漏证明。",
    "- 原始数据、环境、源码 SHA-256 和浏览器错误在 report.json；dirty commit 不能重建源码，源码摘要只用于对比。截图不包含真实任务。",
    "",
    `环境：${report.environment.platform} ${report.environment.arch}；${report.environment.cpu}；Chromium ${report.environment.browser}；Node ${report.environment.node}。`,
    "",
  );
  return lines.join("\n");
}
