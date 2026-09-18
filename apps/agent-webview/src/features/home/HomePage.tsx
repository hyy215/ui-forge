/** 展示任务入口与服务端保存的真实会话导航历史。 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Empty, Spin } from "antd";
import type { TaskHistoryEntry } from "@ui-forge/shared-protocol";
import type { SessionDataSource } from "../../data-sources/sessionDataSource";
import styles from "./HomePage.module.css";
import { SettingsLink } from "../settings/SettingsLink";
import { appPaths } from "../../app/appPaths";

/** 首页只查询导航索引，不装载或启动 Codex 任务。 */
export function HomePage({
  source,
  host,
}: {
  source: SessionDataSource;
  host: "vscode" | "browser";
}) {
  const [tasks, setTasks] = useState<TaskHistoryEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    source
      .list()
      .then((page) => {
        if (active) {
          setTasks(page.tasks);
          setNext(page.nextOffset);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source]);
  const more = async () => {
    if (next === null) return;
    setLoading(true);
    try {
      const page = await source.list(next);
      setTasks((current) => [
        ...current,
        ...page.tasks.filter((task) => !current.some((entry) => entry.taskId === task.taskId)),
      ]);
      setNext(page.nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>YOUR DESIGN, IN YOUR CODEBASE</p>
        <h1>把设计带进项目。</h1>
        <p>
          添加设计链接或图片，告诉 Codex 你要实现什么。
          <br />
          在同一会话中完成实现、审查与验证。
        </p>
        <Link to={appPaths.task}>
          <Button type="primary" size="large">
            新建任务 ↗
          </Button>
        </Link>
        <SettingsLink host={host} className={styles.rulesLink}>
          调整设计与工程规则
        </SettingsLink>
      </section>
      <section className={styles.history}>
        <div className={styles.sectionHeading}>
          <h2>最近任务</h2>
          <span>页面与 CLI 共用会话</span>
        </div>
        {error && <Alert type="error" title={error} showIcon />}
        {!loading && !tasks.length && !error && (
          <Empty description="还没有任务，从一份设计开始" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        <div className={styles.taskList}>
          {tasks.map((task) => (
            <Link
              key={task.taskId}
              to={`${appPaths.task}?taskId=${encodeURIComponent(task.taskId)}`}
              className={styles.task}
            >
              <div>
                <strong>{task.title}</strong>
                <span>{task.projectPath}</span>
              </div>
              <time>{new Date(task.updatedAt).toLocaleDateString()}</time>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
        {loading && <Spin />}
        {next !== null && (
          <Button onClick={() => void more()} loading={loading}>
            加载更多
          </Button>
        )}
      </section>
    </main>
  );
}
