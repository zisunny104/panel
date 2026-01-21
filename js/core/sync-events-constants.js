/**
 * Sync Events Constants - 同步事件名稱常數
 * 統一定義所有同步事件名稱，確保發送端和接收端使用相同的事件名稱
 */

export const SyncEvents = {
  // 工作階段事件
  SESSION_CREATED: "sync_session_created",
  SESSION_JOINED: "sync_session_joined",
  SESSION_LEFT: "sync_session_left",
  SESSION_RESTORED: "sync_session_restored",
  SESSION_ENDED: "sync_session_ended",
  SYNC_DATA_CLEARED: "sync_data_cleared",

  // 伺服器狀態事件
  SERVER_STATUS_CHANGED: "sync_server_status_changed",
  SERVER_ONLINE: "sync_server_online",
  SERVER_OFFLINE: "sync_server_offline",
  SERVER_HEALTH_CHECK_FAILED: "sync_server_health_check_failed",

  // 同步面板事件
  SHOW_PANEL: "sync_show_panel",
  HIDE_PANEL: "sync_hide_panel",
  PANEL_UPDATED: "sync_panel_updated",

  // 狀態同步事件
  STATE_UPDATE: "sync_state_update",
  STATE_SYNC_FAILED: "sync_state_sync_failed",

  // 客戶端初始化事件
  CLIENT_INITIALIZED: "sync_client_initialized",

  // 實驗相關事件
  EXPERIMENT_STARTED: "remote_experiment_started",
  EXPERIMENT_PAUSED: "remote_experiment_paused",
  EXPERIMENT_RESUMED: "remote_experiment_resumed",
  EXPERIMENT_STOPPED: "remote_experiment_stopped",

  // 實驗 ID 事件
  EXPERIMENT_ID_UPDATE: "experimentIdUpdate",
  EXPERIMENT_ID_UPDATED: "experiment_id_updated",

  // 實驗日誌事件
  EXPERIMENT_ACTION: "remote_experiment_action",
  EXPERIMENT_COMBINATION_SELECTED: "remote_combination_selected",

  // 按鈕動作事件
  BUTTON_ACTION: "remote_button_action",

  // 網路恢復事件
  NETWORK_RECOVERY_ATTEMPT: "sync_network_recovery_attempt",
  NETWORK_RECOVERED: "sync_network_recovered",

  // QR 相關事件
  QR_GENERATED: "sync_qr_generated",
  QR_SCANNED: "sync_qr_scanned",

  // 錯誤事件
  SYNC_ERROR: "sync_error",
  CONNECTION_ERROR: "sync_connection_error",
};

/**
 * 取得事件名稱（用於動態事件分發）
 */
export function getEventName(eventKey) {
  return SyncEvents[eventKey] || eventKey;
}

/**
 * 檢查事件是否為同步事件
 */
export function isSyncEvent(eventName) {
  return Object.values(SyncEvents).includes(eventName);
}

/**
 * 取得所有同步事件列表
 */
export function getAllSyncEvents() {
  return Object.values(SyncEvents);
}

export default SyncEvents;
