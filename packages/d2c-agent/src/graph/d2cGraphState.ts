/** 定义当前 D2C Graph 节点间共享但不向包外暴露的内部状态。 */

import type { DesignInspection } from "../design-context/designInspection.js";
import type { DesignSource } from "../design-context/designSource.js";
import type { DesignComponentRecognition } from "../design-components/designComponentRecognition.js";
import type { ComponentCatalog } from "../design-components/componentCatalog.js";
import type { D2CTask } from "../d2cTask.js";
import type { ProjectInspection } from "../project-context/projectInspection.js";
import type { ProjectContextAnalysis } from "../project-context/projectContextAnalysis.js";
import type { PlanningResult } from "../planning/planningResult.js";

/** 单一 D2C Graph 内各节点共享的状态。 */
export interface D2CGraphState {
  task?: D2CTask;
  designSource?: DesignSource;
  inspection?: DesignInspection;
  projectInspection?: ProjectInspection;
  componentCatalog?: ComponentCatalog;
  designSystemWarnings?: string[];
  projectContextAnalysis?: ProjectContextAnalysis;
  componentRecognition?: DesignComponentRecognition;
  plan?: PlanningResult;
}
