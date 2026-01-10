/**
 * 系統常數定義
 */

// 工作階段常數
export const SESSION_CONSTANTS = {
  ID_LENGTH: 6,
  // TIMEOUT 和 CLEANUP_INTERVAL 從 SERVER_CONFIG 讀取
};

// 分享代碼常數
export const SHARE_CODE_CONSTANTS = {
  LENGTH: 6,
  BASE_LENGTH: 5, // 5位數字
  CHECKSUM_LENGTH: 1, // 1位校驗碼
  // TIMEOUT 從 SERVER_CONFIG 讀取
};

// 客戶端常數
export const CLIENT_CONSTANTS = {
  PREFIX: "D",
  // HEARTBEAT_INTERVAL 和 HEARTBEAT_TIMEOUT 從 SERVER_CONFIG 讀取
};

// 實驗ID常數
export const EXPERIMENT_ID_CONSTANTS = {
  LENGTH: 6,
  // VALID_CREATE_CODE 從 SERVER_CONFIG 讀取
};

// WebSocket消息類型
export const WS_MESSAGE_TYPES = {
  // 連線管理
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  HEARTBEAT: "heartbeat",

  // 工作階段管理
  SESSION_JOINED: "session_joined",
  SESSION_LEFT: "session_left",
  SESSION_UPDATED: "session_updated",

  // 狀態同步
  STATE_UPDATE: "state_update",
  STATE_BROADCAST: "state_broadcast",

  // 實驗管理
  EXPERIMENT_START: "experiment_start",
  EXPERIMENT_UPDATE: "experiment_update",
  EXPERIMENT_COMPLETE: "experiment_complete",

  // 錯誤處理
  ERROR: "error",
};

// HTTP響應碼
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

// 錯誤碼
export const ERROR_CODES = {
  INVALID_SESSION_ID: "INVALID_SESSION_ID",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  INVALID_SHARE_CODE: "INVALID_SHARE_CODE",
  SHARE_CODE_EXPIRED: "SHARE_CODE_EXPIRED",
  SHARE_CODE_NOT_FOUND: "SHARE_CODE_NOT_FOUND",
  INVALID_CREATE_CODE: "INVALID_CREATE_CODE",
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",
  INVALID_EXPERIMENT_ID: "INVALID_EXPERIMENT_ID",
  DATABASE_ERROR: "DATABASE_ERROR",
};
