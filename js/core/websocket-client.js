/**
 * WebSocketClient - WebSocket 客戶端
 *
 * 功能:
 * - 管理 WebSocket 連接生命週期
 * - 支援重新整理後自動恢復連接（使用 sessionStorage）
 * - 心跳保持連接
 * - 自動重連機制
 * - 訊息路由與事件分發
 */

import { SYNC_EVENTS, SYNC_ROLE_CONFIG } from "../constants/index.js";
import { Logger } from "./console-manager.js";
import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";

class WebSocketClient {
  /**
   * 建立 WebSocketClient。
   * @param {Object} options - 連線與行為設定。
   * @param {string} [options.url] - WebSocket 連線網址。
   * @param {Object} [options.roleConfig] - 角色識別值。
   * @param {number} [options.heartbeatInterval] - 心跳間隔（毫秒）。
   * @param {number} [options.reconnectInterval] - 重連間隔基準（毫秒）。
   * @param {number} [options.maxReconnectAttempts] - 最大重連次數。
   * @param {string} [options.storagePrefix] - sessionStorage 前綴。
   * @param {boolean} [options.autoReconnect=true] - 是否自動重連。
   * @param {number} [options.maxMessageQueueSize=500] - 佇列最大長度。
   */
  constructor(options = {}) {
    this.config = {
      url: options.url || this.getDefaultWebSocketUrl(),
      heartbeatInterval: options.heartbeatInterval || 30000,
      reconnectInterval: options.reconnectInterval || 3000,
      maxReconnectAttempts: options.maxReconnectAttempts || 5,
      storagePrefix: options.storagePrefix || "panel_",
      autoReconnect: options.autoReconnect !== false,
    };

    this.roleConfig = {
      ...SYNC_ROLE_CONFIG,
      ...options.roleConfig,
    };
    this.timeSyncManager = options.timeSyncManager || null;

    this.ws = null;
    this.wsConnectionId = null;
    this.clientId = null;
    this.sessionId = null;
    this.role = null;
    this.clientType = null;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;

    this.heartbeatTimer = null;
    this.reconnectTimer = null;

    this.eventHandlers = new Map();

    this.messageQueue = [];
    this.maxMessageQueueSize = options.maxMessageQueueSize || 500;

    this.handleOpen = this.handleOpen.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  /**
   * 取得預設 WebSocket URL。
   * 會依目前網域與頁面路徑自動組合 ws / wss 端點。
   * @returns {string}
   */
  getDefaultWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const basePath = this.getWebSocketBasePath();

    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 WebSocket 路徑前綴。
   * @returns {string}
   */
  getWebSocketBasePath() {
    const pathname = window.location.pathname;

    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    return basePath + "ws";
  }

  /**
   * 初始化並建立連接。
   * @param {Object} authData - 認證資料。
   * @param {string} authData.sessionId - 工作階段 ID。
   * @param {string} [authData.clientId] - 客戶端 ID。
   * @param {string} [authData.role] - 角色。
   * @param {string} [authData.clientType] - 客戶端類型。
   * @returns {Promise<void>}
   */
  async connect(authData = {}) {
    const savedData = this.loadFromStorage();

    this.sessionId = authData.sessionId || savedData.sessionId;
    this.clientId = authData.clientId || savedData.clientId;
    this.role = authData.role || savedData.role || this.roleConfig.VIEWER;
    this.clientType =
      authData.clientType ||
      savedData.clientType ||
      this.detectClientType();

    if (!this.sessionId) {
      throw new Error("缺少 sessionId，無法連接");
    }

    if (this.ws) {
      const oldWs = this.ws;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        oldWs.close(1000, "Replaced by new connection");
      }
      this.ws = null;
      Logger.debug("[WebSocketClient] 已清除舊連接");
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    Logger.info(
      "[WebSocketClient] 正在連接到 WebSocket 伺服器...",
      this.config.url,
    );

    try {
      this.ws = new WebSocket(this.config.url);

      this.ws.onopen = this.handleOpen;
      this.ws.onmessage = this.handleMessage;
      this.ws.onclose = this.handleClose;
      this.ws.onerror = this.handleError;
    } catch (error) {
      Logger.error("[WebSocketClient] WebSocket 連接失敗:", error);
      throw error;
    }
  }

  /**
   * 處理連線開啟事件。
   * @param {Event} event - WebSocket open event。
   */
  handleOpen(event) {
    Logger.info("[WebSocketClient] WebSocket 連接已建立");
    this.reconnectAttempts = 0;
  }

  /**
   * 處理收到的訊息。
   * @param {MessageEvent} event - WebSocket message event。
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const { type, data } = message;

      const highFrequencyTypes = new Set([
        WS_PROTOCOL.S2C.HEARTBEAT_ACK,
        WS_PROTOCOL.S2C.SESSION_STATE_UPDATE,
        WS_PROTOCOL.S2C.STATE_UPDATE_ACK,
      ]);
      if (highFrequencyTypes.has(type)) {
        Logger.debug(`[WebSocketClient] 收到訊息 [${type}]`);
      } else {
        Logger.debug(`[WebSocketClient] 收到訊息 [${type}]:`, data);
      }

      switch (type) {
        case WS_PROTOCOL.S2C.CONNECTED:
          this.handleConnected(data);
          break;

        case WS_PROTOCOL.S2C.AUTH_SUCCESS:
          this.handleAuthSuccess(data);
          break;

        case WS_PROTOCOL.S2C.CLEAR_SYNC_DATA:
          Logger.warn("[WebSocketClient] 處理 clear_sync_data 訊息");
          this.handleClearSyncData(data);
          break;

        case WS_PROTOCOL.S2C.HEARTBEAT_ACK:
          this.handleHeartbeatAck(data);
          break;

        case WS_PROTOCOL.S2C.SESSION_STATE:
          this.emit(WS_PROTOCOL.S2C.SESSION_STATE, data);
          break;

        case WS_PROTOCOL.S2C.SESSION_STATE_UPDATE:
          this.emit(WS_PROTOCOL.S2C.SESSION_STATE_UPDATE, data);
          break;

        case WS_PROTOCOL.S2C.CLIENT_JOINED:
          this.emit("client_joined", data);
          break;

        case WS_PROTOCOL.S2C.CLIENT_LEFT:
          this.emit("client_left", data);
          break;

        case WS_PROTOCOL.S2C.CLIENT_RECONNECTED:
          this.emit("client_reconnected", data);
          break;

        case WS_PROTOCOL.S2C.STATE_UPDATE_ACK:
          Logger.debug("[WebSocketClient] 伺服器確認狀態更新", data);
          break;

        case WS_PROTOCOL.S2C.EXPERIMENT_STARTED:
        case WS_PROTOCOL.S2C.EXPERIMENT_PAUSED:
        case WS_PROTOCOL.S2C.EXPERIMENT_RESUMED:
        case WS_PROTOCOL.S2C.EXPERIMENT_STOPPED:
        case WS_PROTOCOL.S2C.EXPERIMENT_ID_CHANGED:
          this.emit(type, data);
          break;

        case "error":
          this.handleServerError(data);
          break;

        default:
          Logger.warn(`[WebSocketClient] 未知的訊息類型: ${type}`);
      }
    } catch (error) {
      Logger.error("[WebSocketClient] 解析訊息失敗:", error, event.data);
    }
  }

  /**
   * 處理連線成功通知。
   * @param {Object} data - 伺服器傳回的 connected 資料。
   */
  handleConnected(data) {
    this.wsConnectionId = data.wsConnectionId;
    Logger.debug(`[WebSocketClient] WebSocket 連接 ID: ${this.wsConnectionId}`);
    this.authenticate();
  }

  /**
   * 送出認證訊息。
   */
  authenticate() {
    if (!this.sessionId) {
      Logger.error("[WebSocketClient] 無法認證：缺少 sessionId");
      return;
    }

    Logger.debug("[WebSocketClient] 正在認證...", {
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
      clientType: this.clientType,
    });

    this.send({
      type: WS_PROTOCOL.C2S.AUTH,
      data: {
        sessionId: this.sessionId,
        clientId: this.clientId,
        role: this.role,
        clientType: this.clientType,
      },
    });
  }

  /**
   * 處理認證成功。
   * @param {Object} data - 驗證成功資料。
   */
  handleAuthSuccess(data) {
    const { sessionId, clientId, role, roomInfo, isReconnect, serverTime } =
      data;

    this.sessionId = sessionId;
    this.clientId = clientId;
    this.role = role;
    this.isAuthenticated = true;

    this.saveToStorage();

    if (serverTime) {
      this.timeSyncManager?.syncWithWebSocket?.(serverTime);
    }

    this.startHeartbeat();

    this.flushMessageQueue();

    if (isReconnect) {
      Logger.info("[WebSocketClient] 重新連接成功！已恢復狀態");
      this.emit("reconnected", { clientId, sessionId, role });
    } else {
      Logger.info("[WebSocketClient] 認證成功！");
      this.emit("authenticated", { clientId, sessionId, role, roomInfo });
    }
  }

  /**
   * 處理清除同步資料命令。
   * @param {Object} data - 清除命令資料。
   */
  handleClearSyncData(data) {
    const { reason, message } = data;

    Logger.warn(
      `[WebSocketClient] 接收到清除同步數據命令 [${reason}]: ${message}`,
    );

    this.config.autoReconnect = false;
    Logger.debug("[WebSocketClient] 已停用自動重連");

    this.clearLocalSyncData();

    const clearEvent = new CustomEvent(SYNC_EVENTS.DATA_CLEARED, {
      detail: {
        reason,
        message,
        timestamp: Date.now(),
      },
    });

    Logger.debug("[WebSocketClient] 準備派發 sync_data_cleared 事件", {
      reason,
      message,
    });

    window.dispatchEvent(clearEvent);
    Logger.info("[WebSocketClient] 已派發 window.sync_data_cleared 事件");

    this.emit("sync_data_cleared", {
      reason,
      message,
      timestamp: Date.now(),
    });

    Logger.info(
      `[WebSocketClient] 已派發內部 sync_data_cleared 事件 [${reason}]`,
    );

    Logger.debug("[WebSocketClient] 500ms 後斷開連線...");
    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        Logger.info("[WebSocketClient] 斷開 WebSocket 連線");
        this.ws.close(1000, "Session not found, clearing sync data");
      }
    }, 500);
  }

  /**
   * 清除舊版固定前綴的本機同步資訊。
   * 這個方法保留是為了清理早期版本寫入的 sessionStorage 鍵。
   */
  clearLocalSyncData() {
    try {
      ["sessionId", "clientId", "role", "timestamp"].forEach((key) => {
        sessionStorage.removeItem(`syncClientState_${key}`);
      });

      Logger.info("[WebSocketClient] 本機同步數據已清除");
    } catch (error) {
      Logger.error("[WebSocketClient] 清除本機同步數據失敗:", error);
    }
  }

  /**
   * 處理連線關閉事件。
   * @param {CloseEvent} event - WebSocket close event。
   */
  handleClose(event) {
    Logger.info(
      `[WebSocketClient] WebSocket 連接已關閉 [${event.code}]: ${event.reason}`,
    );

    this.isAuthenticated = false;
    this.stopHeartbeat();

    this.emit("disconnected", { code: event.code, reason: event.reason });

    if (
      this.config.autoReconnect &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    }
  }

  /**
   * 處理 WebSocket 錯誤。
   * @param {Event} event - WebSocket error event。
   */
  handleError(event) {
    Logger.error("[WebSocketClient] WebSocket 錯誤:", event);
    this.emit("error", event);
  }

  /**
   * 處理伺服器錯誤訊息。
   * @param {Object} data - 錯誤資料。
   */
  handleServerError(data) {
    Logger.error("[WebSocketClient] 伺服器錯誤:", data);

    if (data && data.message && data.message.includes("工作階段不存在")) {
      Logger.warn("[WebSocketClient] 偵測到工作階段不存在錯誤，發送清理事件");
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.WEBSOCKET_SESSION_INVALID, {
          detail: {
            reason: "session_not_found",
            originalError: data,
          },
        }),
      );
    }

    this.emit("server_error", data);
  }

  /**
   * 排程重新連接。
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * this.reconnectAttempts;

    Logger.info(
      `[WebSocketClient] 將在 ${delay}ms 後嘗試重新連接 (第 ${this.reconnectAttempts} 次)`,
    );

    this.reconnectTimer = setTimeout(() => {
      Logger.debug("[WebSocketClient] 正在重新連接...");
      this.connect({
        sessionId: this.sessionId,
        clientId: this.clientId,
        role: this.role,
      });
    }, delay);
  }

  /**
   * 啟動心跳。
   */
  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.isAuthenticated) {
        this.send({
          type: WS_PROTOCOL.C2S.HEARTBEAT,
          data: {
            clientId: this.clientId,
            timestamp: Date.now(),
          },
        });
      }
    }, this.config.heartbeatInterval);

    Logger.debug(
      `[WebSocketClient] 心跳已啟動 (間隔: ${this.config.heartbeatInterval}ms)`,
    );
  }

  /**
   * 停止心跳。
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 處理心跳確認。
   */
  handleHeartbeatAck(data) {
  }

  /**
   * 送出訊息；若尚未連線則先加入佇列。
   * @param {Object} message - 要送出的訊息。
   * @returns {boolean}
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.messageQueue.length >= this.maxMessageQueueSize) {
        Logger.warn(
          `[WebSocketClient] 消息佇列已達最大限制 (${this.maxMessageQueueSize}/${this.maxMessageQueueSize})，舊消息可能被丟棄`,
          { queueSize: this.messageQueue.length },
        );
        this.messageQueue.shift();
      }

      this.messageQueue.push(message);
      Logger.debug(
        `[WebSocketClient] WebSocket 未連接，訊息已加入佇列 (佇列大小: ${this.messageQueue.length}/${this.maxMessageQueueSize})`,
      );
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      Logger.error("[WebSocketClient] 發送訊息失敗:", error);
      this.messageQueue.push(message);
      return false;
    }
  }

  /**
   * 發送已累積的佇列訊息。
   */
  flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

    Logger.debug(
      `[WebSocketClient] 發送佇列中的 ${this.messageQueue.length} 條訊息`,
    );

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  /**
   * 更新工作階段狀態。
   * @param {Object} state - 要同步的狀態。
   */
  updateState(state) {
    this.send({
      type: WS_PROTOCOL.C2S.STATE_UPDATE,
      data: {
        sessionId: this.sessionId,
        clientId: this.clientId,
        state,
      },
    });
  }

  /**
   * 註冊事件處理器。
   * @param {string} event - 事件名稱。
   * @param {Function} handler - 處理函數。
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * 移除事件處理器。
   * @param {string} event - 事件名稱。
   * @param {Function} handler - 處理函數。
   */
  off(event, handler) {
    if (!this.eventHandlers.has(event)) return;

    const handlers = this.eventHandlers.get(event);
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * 觸發事件。
   * @param {string} event - 事件名稱。
   * @param {*} data - 事件資料。
   */
  emit(event, data) {
    if (!this.eventHandlers.has(event)) return;

    const handlers = this.eventHandlers.get(event);
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        Logger.error(`[WebSocketClient] 事件處理器錯誤 [${event}]:`, error);
      }
    });
  }

  /**
   * 儲存連接資訊到 sessionStorage。
   */
  saveToStorage() {
    const prefix = this.config.storagePrefix;

    try {
      sessionStorage.setItem(`${prefix}clientId`, this.clientId);
      sessionStorage.setItem(`${prefix}sessionId`, this.sessionId);
      sessionStorage.setItem(`${prefix}role`, this.role);

      Logger.debug("[WebSocketClient] 連接資訊已儲存至 sessionStorage");
    } catch (error) {
      Logger.error("[WebSocketClient] 儲存至 sessionStorage 失敗:", error);
    }
  }

  /**
   * 從 sessionStorage 載入連接資訊。
   * @returns {{clientId?: string, sessionId?: string, role?: string}}
   */
  loadFromStorage() {
    const prefix = this.config.storagePrefix;

    try {
      const clientId = sessionStorage.getItem(`${prefix}clientId`);
      const sessionId = sessionStorage.getItem(`${prefix}sessionId`);
      const role = sessionStorage.getItem(`${prefix}role`);

      if (clientId && sessionId) {
        Logger.debug("[WebSocketClient] 從 sessionStorage 恢復連接資訊:", {
          clientId,
          sessionId,
          role,
        });
        return { clientId, sessionId, role };
      }
    } catch (error) {
      Logger.error("[WebSocketClient] 從 sessionStorage 載入失敗:", error);
    }

    return {};
  }

  /**
   * 清除 sessionStorage 中的連接資訊。
   */
  clearStorage() {
    const prefix = this.config.storagePrefix;

    try {
      sessionStorage.removeItem(`${prefix}clientId`);
      sessionStorage.removeItem(`${prefix}sessionId`);
      sessionStorage.removeItem(`${prefix}role`);

      Logger.debug("[WebSocketClient] 已清除 sessionStorage");
    } catch (error) {
      Logger.error("[WebSocketClient] 清除 sessionStorage 失敗:", error);
    }
  }

  /**
   * 手動重新連接。
   */
  reconnect() {
    Logger.info("[WebSocketClient] 手動重新連接...");
    this.reconnectAttempts = 0;
    this.close();
    this.connect({
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
      clientType: this.clientType,
    });
  }

  detectClientType() {
    const path = (window.location.pathname || "").toLowerCase();
    return path.includes("board.html") ? "board" : "panel";
  }

  /**
   * 關閉連接但保留儲存資訊。
   */
  close() {
    Logger.info("[WebSocketClient] 正在關閉 WebSocket 連接...");

    this.config.autoReconnect = false; // 停用自動重連
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Client closing");
      this.ws = null;
    }

    this.isAuthenticated = false;
  }

  /**
   * 完全斷開連接並清除儲存資料。
   */
  disconnect() {
    this.close();
    this.clearStorage();
    Logger.info("[WebSocketClient] 已完全斷開連接");
  }

  /**
   * 取得目前連接狀態快照。
   * @returns {Object}
   */
  getState() {
    return {
      connected: this.ws && this.ws.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      wsConnectionId: this.wsConnectionId,
      clientId: this.clientId,
      sessionId: this.sessionId,
      role: this.role,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// ES6 模組匯出
export default WebSocketClient;
export { WebSocketClient };
