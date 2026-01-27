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
  SESSION_JOINED_BY_CODE: "sync_session_joined_by_code",

  // 分享代碼事件
  SHARE_CODE_GENERATED: "sync_share_code_generated",

  // 伺服器狀態事件
  SERVER_STATUS_CHANGED: "sync_server_status_changed",
  SERVER_ONLINE: "sync_server_online",
  SERVER_OFFLINE: "sync_server_offline",

  // 同步面板事件
  SHOW_SYNC_PANEL: "show_sync_panel",
  PANEL_UPDATED: "sync_panel_updated",

  // 狀態同步事件
  STATE_UPDATE: "sync_state_update",

  // 客戶端初始化事件
  CLIENT_INITIALIZED: "sync_client_initialized",

  // 實驗相關事件
  EXPERIMENT_STARTED: "experiment_started",
  EXPERIMENT_PAUSED: "experiment_paused",
  EXPERIMENT_RESUMED: "experiment_resumed",
  EXPERIMENT_STOPPED: "experiment_stopped",

  // 實驗 ID 事件
  EXPERIMENT_ID_CHANGED: "experiment_id_changed",

  // 實驗日誌事件
  EXPERIMENT_COMBINATION_SELECTED: "combination_selected", // 組合選擇記錄

  // 步驟生命周期事件
  STEP_STARTED: "step_started",
  STEP_COMPLETED: "step_completed",
  STEP_CANCELLED: "step_cancelled",

  // 動作生命周期事件
  ACTION_COMPLETED: "action_completed",
  ACTION_CANCELLED: "action_cancelled",

  // 面板按鈕事件
  BUTTON_PRESSED: "button_pressed",

  // 錯誤事件
  DATA_CLEARED: "data_cleared", // WebSocket斷開時清除同步數據

  // UI 本地事件（非同步）
  POWER_STATE_CHANGED: "power_state_changed",
  USER_SETTINGS_RESET: "user_settings_reset",

  // 實驗中心事件（非同步）
  EXPERIMENT_HUB_STATE_UPDATE: "experiment_hub_state_update",
  EXPERIMENT_HUB_ID_UPDATE: "experiment_hub_id_update",
  EXPERIMENT_HUB_STATE_CHANGE: "experiment_hub_state_change",
  EXPERIMENT_HUB_CONNECTION_LOST: "experiment_hub_connection_lost",

  // WebSocket 事件（非同步）
  WEBSOCKET_SESSION_INVALID: "websocket_session_invalid"
};

// 同步資料類型常數
export const SyncDataTypes = {
  // 實驗管理
  EXPERIMENT_INITIALIZE: "experimentInitialize",
  EXPERIMENT_STARTED: "experiment_started",
  EXPERIMENT_PAUSED: "experiment_paused",
  EXPERIMENT_RESUMED: "experiment_resumed",
  EXPERIMENT_STOPPED: "experiment_stopped",

  // 實驗資訊更新
  PARTICIPANT_NAME_UPDATE: "participantNameUpdate",
  EXPERIMENT_ID_UPDATE: "experimentIdUpdate",
  COMBINATION_SELECTED: "combination_selected",

  // 動作與步驟
  ACTION_COMPLETED: "action_completed",
  ACTION_CANCELLED: "action_cancelled",
  STEP_COMPLETED: "step_completed",
  STEP_CANCELLED: "step_cancelled",
  BUTTON_PRESSED: "button_pressed",

  // 電源狀態
  POWER_STATE_UPDATE: "powerState",
  POWER_STATE_CHANGED: "power_state_changed",

  // 日誌更新
  LOG_UPDATE: "log_update",

  // 手勢操作
  GESTURE_MARKED: "gesture_marked",
  GESTURE_STEP_COMPLETED: "gesture_step_completed",

  // 工作階段狀態
  SESSION_STATE_UPDATE: "sessionState",

  // 狀態請求
  REQUEST_EXPERIMENT_STATE: "request_experiment_state",

  // 實驗狀態變化
  EXPERIMENT_STATE_CHANGE: "experiment_state_change"
};

// 暴露至全域以供非 module 腳本使用（例如直接載入的 panel 腳本）
if (typeof window !== "undefined") {
  window.SyncEvents = SyncEvents;
  window.SyncDataTypes = SyncDataTypes;
}

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
