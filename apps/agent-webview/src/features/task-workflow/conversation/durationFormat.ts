/** 统一第二步界面中的秒级耗时展示，避免暴露无意义的毫秒精度。 */

/** 将非负毫秒数格式化为最低精度为秒的紧凑文本。 */
export function formatDurationInSeconds(durationMs: number): string {
  const safeDurationMs = Math.max(0, durationMs);
  if (safeDurationMs === 0) return "0s";
  if (safeDurationMs < 1_000) return "<1s";
  return `${Math.round(safeDurationMs / 1_000)}s`;
}
