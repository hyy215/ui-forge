/** 展示 ui-forge 定位、交付流程和核心能力概述。 */
import { Button, Tag } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { appPaths } from "../../app/appPaths";
import styles from "./HomePage.module.css";

const capabilities = [
  {
    index: "01",
    title: "读取设计上下文",
    description: "读取并标准化 MasterGo 设计结构、布局和官方矢量数据，形成受控设计上下文。",
  },
  {
    index: "02",
    title: "生成安全 SVG 预览",
    description: "从受控矢量与布局数据确定性合成安全 SVG，供用户在分析前检查设计。",
  },
  {
    index: "03",
    title: "检查项目与组件候选",
    description: "确认设计后检查 React + TypeScript 与 Ant Design 项目，并提取平台无关组件候选。",
  },
  {
    index: "04",
    title: "生成结构化方案",
    description: "结合结构证据与视觉判断，生成仅供审阅的组件结论和前端实现方案。",
  },
  {
    index: "05",
    title: "生成候选代码 Patch",
    description: "用户确认方案后重新校验文件版本，并生成绑定 Plan 与内容哈希的可审阅代码 Diff。",
  },
];

/** 渲染客户端首页并引导用户进入 D2C 设计分析任务。 */
export function HomePage() {
  const navigate = useNavigate();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} to={appPaths.home} aria-label="ui-forge 首页">
          <span>UF</span>
          <strong>ui-forge</strong>
        </Link>
        <Tag color="blue">MVP · Patch 审阅模式</Tag>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>DESIGN TO CODE REVIEW AGENT</p>
          <h1>从设计稿到<br />可审阅的代码 Patch。</h1>
          <p className={styles.summary}>
            ui-forge 集成在 VS Code 中，读取 MasterGo 设计并生成安全 SVG 预览；确认设计后，
            检查目标项目、判断组件候选并生成结构化方案；确认方案后生成候选代码 Patch。
          </p>
          <div className={styles.actions}>
            <Button type="primary" size="large" onClick={() => navigate(appPaths.taskWorkflow)}>
              开始分析设计
            </Button>
            <span>当前版本不会修改项目文件</span>
          </div>
        </div>

        <aside className={styles.workflowCard} aria-label="当前工作流概览">
          <div className={styles.workflowHeader}>
            <span>当前工作流</span>
            <i>审阅模式</i>
          </div>
          <ol>
            <li><span>1</span><div><strong>输入设计链接</strong><small>MasterGo 页面或节点</small></div></li>
            <li><span>2</span><div><strong>读取并生成预览</strong><small>标准化结构 · 安全 SVG</small></div></li>
            <li><span>3</span><div><strong>确认设计并检查项目</strong><small>精确口令 · 支持性校验</small></div></li>
            <li><span>4</span><div><strong>判断组件并生成方案</strong><small>视觉判断 · 结构化方案</small></div></li>
            <li><span>5</span><div><strong>确认方案并生成代码</strong><small>文件哈希 · 候选 Patch</small></div></li>
          </ol>
        </aside>
      </section>

      <section className={styles.capabilitySection} aria-labelledby="capability-title">
        <div className={styles.sectionHeading}>
          <div>
            <p>CORE CAPABILITIES</p>
            <h2 id="capability-title">从设计输入到候选代码 Patch</h2>
          </div>
          <span>当前支持 React + TypeScript、Ant Design 单页面或页面区域</span>
        </div>
        <div className={styles.capabilityGrid}>
          {capabilities.map((capability) => (
            <article key={capability.index}>
              <span>{capability.index}</span>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
