/** 提供跨入口复用的通信流消费与会话展示归并，不持有连接或执行状态。 */
export { readCommunicationStream } from "./readCommunicationStream.js";
export {
  applySessionEvent,
  emptyPresentation,
  requestItem,
  stringValue,
  type SessionPresentation,
} from "./sessionPresentation.js";
