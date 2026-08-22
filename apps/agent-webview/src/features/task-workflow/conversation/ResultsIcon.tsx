/** 提供窄屏设计与分析结果入口使用的局部图标。 */

/** 渲染打开设计与方案结果的紧凑线框图标。 */
export function ResultsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16">
    <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.5 7h7M6.5 10h7M6.5 13h4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
  </svg>;
}
