/**
 * 實驗相關常數統一入口
 * 集中管理實驗流程、組合與動作處理所需的事件與預設值。
 */

import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";

// ========== 動作處理 ==========
export const EXPERIMENT_ACTION_HANDLER_EVENTS = {
  ACTION_VALIDATED: "action:validated",
  ACTION_COMPLETED: "action:completed",
  ACTION_ENTERED: "action:entered",
  ACTION_FAILED: "action:failed",
  SEQUENCE_COMPLETED: "action:sequence_completed",
  AUTO_PROGRESS: "action:auto_progress",
  ERROR: "action:error",
};

export const EXPERIMENT_ACTION_HANDLER_DEFAULTS = {
  AUTO_PROGRESS_DELAY_MS: 3000,
  COMPLETION_COOLDOWN_MS: 3000,
};

// ========== 流程管理 ==========
export const EXPERIMENT_FLOW_STATE = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
  COMPLETED: "completed",
};

export const EXPERIMENT_FLOW_EVENTS = {
  STARTED: "flow:started",
  PAUSED: "flow:paused",
  RESUMED: "flow:resumed",
  STOPPED: "flow:stopped",
  COMPLETED: "flow:completed",
  LOCKED: "flow:locked",
  UNLOCKED: "flow:unlocked",
  STEP_CHANGED: "flow:step_changed",
  UNIT_CHANGED: "flow:unit_changed",
  UNIT_COMPLETED: "flow:unit_completed",
  STATE_CHANGED: "flow:state_changed",
  ERROR: "flow:error",
};

export const EXPERIMENT_FLOW_DOM_EVENTS = {
  VISIBILITY_CHANGE: "visibilitychange",
};

// ========== 組合管理 ==========
export const EXPERIMENT_COMBINATION_EVENTS = {
  COMBINATION_LOADED: "combination:loaded",
  COMBINATION_SELECTED: "combination:selected",
  COMBINATION_CHANGED: "combination:changed",
  UNITS_RANDOMIZED: "combination:units_randomized",
  ERROR: "combination:error",
};

// ========== 向後相容別名 ==========
export const ACTION_HANDLER_EVENTS = EXPERIMENT_ACTION_HANDLER_EVENTS;
export const ACTION_HANDLER_DEFAULTS = EXPERIMENT_ACTION_HANDLER_DEFAULTS;
export const EXPERIMENT_FLOW_STATE_CONSTANTS = EXPERIMENT_FLOW_STATE;
export const EXPERIMENT_FLOW_EVENT_CONSTANTS = EXPERIMENT_FLOW_EVENTS;
export const EXPERIMENT_FLOW_DOM_EVENT_CONSTANTS =
  EXPERIMENT_FLOW_DOM_EVENTS;
export const EXPERIMENT_COMBINATION_EVENT_CONSTANTS =
  EXPERIMENT_COMBINATION_EVENTS;

// ========== 實驗中樞 ==========
export const EXPERIMENT_HUB_CONSTANTS = {
  MODE: {
    LOCAL: "local",
    HUB: "hub",
    VIEWER: "viewer",
  },
  EVENT: {
    ID_CHANGED: "hub:id_changed",
    MODE_CHANGED: "hub:mode_changed",
    CONNECTED: "hub:connected",
    DISCONNECTED: "hub:disconnected",
    MESSAGE_RECEIVED: "hub:message_received",
    SYNC_REQUIRED: "hub:sync_required",
    ERROR: "hub:error",
  },
  STORAGE_KEY: "experiment_hub_ids",
  DEFAULTS: {
    CLIENT_ID: "panel_device",
    AUTO_RECONNECT: true,
    RECONNECT_INTERVAL_MS: 5000,
    SYNC_CLIENT_READY_POLL_INTERVAL_MS: 100,
    SYNC_CLIENT_READY_TIMEOUT_MS: 30000,
  },
  MESSAGE_TYPES: {
    EXPERIMENT_ID_REGISTER: WS_PROTOCOL.C2S.EXPERIMENT_ID_REGISTER,
    EXPERIMENT_ID_UPDATE: WS_PROTOCOL.C2S.EXPERIMENT_ID_UPDATE,
    SEND_FAILED: "send_failed",
  },
  WS_CLIENT_EVENTS: {
    AUTHENTICATED: "authenticated",
    DISCONNECTED: "disconnected",
    RECONNECTED: "reconnected",
  },
};
