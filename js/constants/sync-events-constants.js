/**
 * Sync Events Constants - 同步事件名稱常數
 * 統一定義所有同步事件名稱，確保發送端和接收端使用相同的事件名稱
 */

import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";

export const SYNC_EVENTS = {
  // 工作階段事件
  SESSION_CREATED: "sync_session_created",
  SESSION_JOINED: "sync_session_joined",
  SESSION_LEFT: "sync_session_left",
  SESSION_RESTORED: "sync_session_restored",
  SESSION_JOINED_BY_CODE: "sync_session_joined_by_code",

  // 分享代碼事件
  SHARE_CODE_GENERATED: "sync_share_code_generated",

  // WebSocket 連線事件
  CONNECTED: "sync_connected",
  DISCONNECTED: "sync_disconnected",

  // 伺服器狀態事件
  SERVER_STATUS_CHANGED: "sync_server_status_changed",

  // 同步面板事件
  SHOW_SYNC_PANEL: "show_sync_panel",

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

  // 錯誤事件
  DATA_CLEARED: "data_cleared", // WebSocket斷開時清除同步數據

  // UI 本機事件（非同步）
  POWER_STATE_CHANGED: "power_state_changed",
  USER_SETTINGS_RESET: "user_settings_reset",

  // WebSocket 事件（非同步）
  WEBSOCKET_SESSION_INVALID: "websocket_session_invalid",

  // 工作階段失效與狀態事件
  SESSION_INVALID: "sync_session_invalid",
  SESSION_STATE: "sync_session_state",
  SESSION_STATE_REFRESHED: "sync_session_state_refreshed",

  // 連線輔助事件
  RECONNECTED: "sync_reconnected",
  CLIENT_JOINED: "sync_client_joined",
  CLIENT_LEFT: "sync_client_left",
  CLIENT_RECONNECTED: "sync_client_reconnected",
  SERVER_ERROR: "sync_server_error",

  // 面板顯示事件
  SHOW_SESSIONS: "sync_show_sessions",
  CONNECTION_LOST: "sync_connection_lost",

  // 本機 DOM 事件（dispatched on document，僅限頁面內部使用，非 WebSocket 同步）
  EXPERIMENT_STATE_CHANGE_LOCAL: "experiment_state_change_local",
  EXPERIMENT_STATE_ID_CHANGED: "experimentState:experimentIdChanged",
  EXPERIMENT_STATE_PARTICIPANT_CHANGED: "experimentState:participantNameChanged",

  // 同步狀態廣播事件（由 ExperimentSyncCore 派發，使用端直接監聽）
  STATE_BROADCAST: "state_broadcast",

  // 同步資料事件（來自遠端裝置的狀態同步）
  COMBINATION_SELECTED: "combination_selected",
  GESTURE_MARKED: "gesture_marked",
};

// 同步資料類型常數
export const SYNC_DATA_TYPES = {
  // 實驗管理
  EXPERIMENT_INITIALIZE: "experiment_initialize",
  EXPERIMENT_STARTED: "experiment_started",
  EXPERIMENT_PAUSED: "experiment_paused",
  EXPERIMENT_RESUMED: "experiment_resumed",
  EXPERIMENT_STOPPED: "experiment_stopped",

  // 實驗資訊更新
  PARTICIPANT_NAME_UPDATE: "participant_name_update",
  EXPERIMENT_ID_UPDATE: WS_PROTOCOL.C2S.EXPERIMENT_ID_UPDATE,
  COMBINATION_SELECTED: "combination_selected",

  // 動作與步驟
  ACTION_COMPLETED: "action_completed",
  ACTION_CANCELLED: "action_cancelled",
  STEP_COMPLETED: "step_completed",
  STEP_CANCELLED: "step_cancelled",
  BUTTON_PRESSED: "button_pressed",

  // 電源狀態
  POWER_STATE_UPDATE: "power_state_update",

  // 動作廣播類型
  BUTTON_ACTION: "button_action",

  // 手勢操作
  GESTURE_MARKED: "gesture_marked",
  GESTURE_STEP_COMPLETED: "gesture_step_completed",
};

/**
 * 取得事件名稱（用於動態事件分發）
 */
export function getEventName(eventKey) {
  return SYNC_EVENTS[eventKey] || eventKey;
}
