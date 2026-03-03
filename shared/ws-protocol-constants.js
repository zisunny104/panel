/**
 * WS 傳輸協議訊息類型常數 — 唯一真相來源
 *
 * 涵蓋 WebSocket 通訊層的所有 .type 字串，Server 與 Client 共用此檔。
 *
 * 載入方式：
 *   Server (Node.js ES module)：import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js"
 *   Browser：<script type="module" src="shared/ws-protocol-constants.js"> → globalThis.WS_PROTOCOL
 */

export const WS_PROTOCOL = {
  /** Client → Server 訊息類型 */
  C2S: {
    AUTH: "auth",
    HEARTBEAT: "heartbeat",
    STATE_UPDATE: "state_update",
    GET_SESSION_STATE: "get_session_state",
    PING: "ping",
  },

  /** Server → Client 訊息類型 */
  S2C: {
    CONNECTED: "connected",
    AUTH_SUCCESS: "auth_success",
    CLEAR_SYNC_DATA: "clear_sync_data",
    HEARTBEAT_ACK: "heartbeat_ack",
    PONG: "pong",
    SESSION_STATE: "session_state",
    SESSION_STATE_UPDATE: "session_state_update",
    STATE_UPDATE_ACK: "state_update_ack",
    CLIENT_JOINED: "client_joined",
    CLIENT_LEFT: "client_left",
    CLIENT_RECONNECTED: "client_reconnected",
    EXPERIMENT_STARTED: "experiment_started",
    EXPERIMENT_PAUSED: "experiment_paused",
    EXPERIMENT_RESUMED: "experiment_resumed",
    EXPERIMENT_STOPPED: "experiment_stopped",
    EXPERIMENT_ID_CHANGED: "experiment_id_changed",
    ERROR: "error",
  },
};

// 暴露至全域（瀏覽器 = window.WS_PROTOCOL，Node.js = global.WS_PROTOCOL）
globalThis.WS_PROTOCOL = WS_PROTOCOL;
