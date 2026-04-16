/**
 * record/index.js - 紀錄模組公開 API
 *
 * 統一入口，提供 RecordManager、RecordView 及所有子模組的命名匯出。
 */

export { default as RecordManager } from "./record-manager.js";
export { recordView } from "./record-view.js";
export { recordStore } from "./record-store.js";
export { recordRuntime } from "./record-runtime.js";
export { recordViewFilter } from "./record-view-filter.js";
export { recordViewList } from "./record-view-list.js";
export { recordViewModal } from "./record-view-modal.js";
export { recordViewStats } from "./record-view-stats.js";
