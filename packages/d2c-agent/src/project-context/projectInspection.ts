/** 定义目标项目进入 D2C 规划前的受支持能力检查结果。 */

/** 表示没有有效工程文件、可在执行阶段初始化的目标目录。 */
export interface EmptyProjectInspection {
  kind: "empty";
  projectRoot: string;
}

/** 表示已识别为 React 与 Ant Design 工程的目标项目。 */
export interface ReactAntdProjectInspection {
  kind: "react_antd";
  projectRoot: string;
  packageJsonPath: string;
  reactVersion?: string;
  antdVersion?: string;
}

/** 表示非空但不满足当前 D2C 技术栈约束的目标项目。 */
export interface UnsupportedProjectInspection {
  kind: "unsupported";
  projectRoot: string;
  reasons: string[];
}

/** 目标项目检查能够产生的全部确定性分类。 */
export type ProjectInspection =
  | EmptyProjectInspection
  | ReactAntdProjectInspection
  | UnsupportedProjectInspection;
