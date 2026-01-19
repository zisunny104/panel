/**
 * WebSocket 客戶端
 *
 * 功能:
 * - 管理 WebSocket 連接生命週期
 * - 支援重新整理後自動恢復連接（使用 sessionStorage）
 * - 心跳保持連接
 * - 自動重連機制
 * - 訊息路由與事件分發
 */

class WebSocketClient {
  constructor(options = {}) {
    // 配置
    this.config = {
      url: options.url || this.getDefaultWebSocketUrl(),
      heartbeatInterval: options.heartbeatInterval || 30000, // 30秒
      reconnectInterval: options.reconnectInterval || 3000, // 3秒
      maxReconnectAttempts: options.maxReconnectAttempts || 5,
      storagePrefix: options.storagePrefix || "panel_", // sessionStorage 前綴
      autoReconnect: options.autoReconnect !== false,
    };

    // 連接狀態
    this.ws = null;
    this.wsConnectionId = null;
    this.clientId = null;
    this.sessionId = null;
    this.role = null;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;

    // 定時器
    this.heartbeatTimer = null;
    this.reconnectTimer = null;

    // 事件處理器
    this.eventHandlers = new Map();

    // 訊息佇列（未連接時暫存）
    this.messageQueue = [];

    // 綁定方法
    this.handleOpen = this.handleOpen.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  /**   * 取得預設 WebSocket URL（自動偵測目前網域）
   * 測試環境：ws://localhost:7645/ws
   * 生產環境：wss://yourdomain.com:7645/ws 或 ws://yourdomain.com:7645/ws
   */
  getDefaultWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const port = "7645";
    return `${protocol}//${host}:${port}/ws`;
  }

  /**   * 初始化連接
   * @param {Object} authData - 認證資料 { sessionId, clientId?, role? }
   */
  async connect(authData = {}) {
    // 1. 檢查是否有儲存的連接資訊
    const savedData = this.loadFromStorage();

    // 2. 合併認證資料（優先使用傳入的，再使用儲存的）
    this.sessionId = authData.sessionId || savedData.sessionId;
    this.clientId = authData.clientId || savedData.clientId;
    this.role = authData.role || savedData.role || "viewer";

    // 3. 檢查必要欄位
    if (!this.sessionId) {
      throw new Error("缺少 sessionId，無法連接");
    }

    // 4. 建立 WebSocket 連接
    Logger.info(
      "[WebSocketClient] 正在連接到 WebSocket 伺服器...",
      this.config.url
    );

    try {
      this.ws = new WebSocket(this.config.url);

      // 設定事件處理器
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
   * 連接開啟處理
   */
  handleOpen(event) {
    Logger.info("[WebSocketClient] WebSocket 連接已建立");
    this.reconnectAttempts = 0;

    // 等待 'connected' 訊息後再進行認證
    // (伺服器會先發送 connected 訊息)
  }

  /**
   * 訊息接收處理
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      const { type, data, timestamp } = message;

      Logger.debug(`[WebSocketClient] 收到訊息 [${type}]:`, data);

      // 路由訊息到對應處理器
      switch (type) {
        case "connected":
          this.handleConnected(data);
          break;

        case "auth_success":
          this.handleAuthSuccess(data);
          break;

        case "heartbeat_ack":
          this.handleHeartbeatAck(data);
          break;

        case "session_state":
          this.emit("session_state", data);
          break;

        case "session_state_update":
          this.emit("state_update", data);
          break;

        case "client_joined":
          this.emit("client_joined", data);
          break;

        case "client_left":
          this.emit("client_left", data);
          break;

        case "client_reconnected":
          this.emit("client_reconnected", data);
          break;

        case "experiment_started":
        case "experiment_paused":
        case "experiment_resumed":
        case "experiment_stopped":
        case "experiment_id_update":
          this.emit(`experiment_${type.split("_")[1]}`, data);
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
   * 處理 connected 訊息
   */
  handleConnected(data) {
    this.wsConnectionId = data.wsConnectionId;
    Logger.debug(`[WebSocketClient] WebSocket 連接 ID: ${this.wsConnectionId}`);

    // 連接成功後立即認證
    this.authenticate();
  }

  /**
   * 發送認證訊息
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
    });

    this.send({
      type: "auth",
      data: {
        sessionId: this.sessionId,
        clientId: this.clientId,
        role: this.role,
      },
    });
  }

  /**
   * 處理認證成功
   */
  handleAuthSuccess(data) {
    const { sessionId, clientId, role, roomInfo, isReconnect, serverTime } =
      data;

    // 更新狀態
    this.sessionId = sessionId;
    this.clientId = clientId;
    this.role = role;
    this.isAuthenticated = true;

    // 儲存到 sessionStorage
    this.saveToStorage();

    // 進行一次性校時（如果伺服器有提供時間戳）
    if (serverTime && window.timeSyncManager) {
      window.timeSyncManager.syncWithWebSocket(serverTime);
    }

    // 啟動心跳
    this.startHeartbeat();

    // 發送已連接的佇列訊息
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
   * 連接關閉處理
   */
  handleClose(event) {
    Logger.info(
      `[WebSocketClient] WebSocket 連接已關閉 [${event.code}]: ${event.reason}`
    );

    this.isAuthenticated = false;
    this.stopHeartbeat();

    this.emit("disconnected", { code: event.code, reason: event.reason });

    // 自動重連
    if (
      this.config.autoReconnect &&
      this.reconnectAttempts < this.config.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    }
  }

  /**
   * 錯誤處理
   */
  handleError(event) {
    Logger.error("[WebSocketClient] WebSocket 錯誤:", event);
    this.emit("error", event);
  }

  /**
   * 處理伺服器錯誤訊息
   */
  handleServerError(data) {
    Logger.error("[WebSocketClient] 伺服器錯誤:", data);
    this.emit("server_error", data);
  }

  /**
   * 排程重新連接
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * this.reconnectAttempts;

    Logger.info(
      `[WebSocketClient] 將在 ${delay}ms 後嘗試重新連接 (第 ${this.reconnectAttempts} 次)`
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
   * 啟動心跳
   */
  startHeartbeat() {
    this.stopHeartbeat(); // 清除舊的定時器

    this.heartbeatTimer = setInterval(() => {
      if (this.isAuthenticated) {
        this.send({
          type: "heartbeat",
          data: {
            clientId: this.clientId,
            timestamp: Date.now(),
          },
        });
      }
    }, this.config.heartbeatInterval);

    Logger.debug(
      `[WebSocketClient] 心跳已啟動 (間隔: ${this.config.heartbeatInterval}ms)`
    );
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 處理心跳確認
   */
  handleHeartbeatAck(data) {
    // console.log('心跳確認', data);
  }

  /**
   * 發送訊息
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      Logger.warn("[WebSocketClient] WebSocket 未連接，訊息已加入佇列");
      this.messageQueue.push(message);
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      Logger.error("[WebSocketClient] 發送訊息失敗:", error);
      return false;
    }
  }

  /**
   * 發送已連接的佇列訊息
   */
  flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

    Logger.debug(
      `[WebSocketClient] 發送佇列中的 ${this.messageQueue.length} 條訊息`
    );

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  /**
   * 更新工作階段狀態
   */
  updateState(state) {
    this.send({
      type: "state_update",
      data: {
        sessionId: this.sessionId,
        clientId: this.clientId,
        state,
      },
    });
  }

  /**
   * 取得工作階段狀態
   */
  getSessionState() {
    this.send({
      type: "get_session_state",
      data: {
        sessionId: this.sessionId,
      },
    });
  }

  /**
   * 發送實驗操作
   */
  sendExperimentAction(action, data = {}) {
    this.send({
      type: "experiment_action",
      data: {
        sessionId: this.sessionId,
        action,
        ...data,
      },
    });
  }

  /**
   * 註冊事件處理器
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * 移除事件處理器
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
   * 觸發事件
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
   * 儲存連接資訊到 sessionStorage
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
   * 從 sessionStorage 載入連接資訊
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
   * 清除 sessionStorage
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
   * 手動重新連接
   */
  reconnect() {
    Logger.info("[WebSocketClient] 手動重新連接...");
    this.reconnectAttempts = 0;
    this.close();
    this.connect({
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
    });
  }

  /**
   * 關閉連接
   */
  close() {
    Logger.info("[WebSocketClient] 正在關閉 WebSocket 連接...");

    this.config.autoReconnect = false; // 禁用自動重連
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
   * 完全斷開連接並清除資料
   */
  disconnect() {
    this.close();
    this.clearStorage();
    Logger.info("[WebSocketClient] 已完全斷開連接");
  }

  /**
   * 取得連接狀態
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

// 導出（支援 ES6 模組和全域變數）
if (typeof module !== "undefined" && module.exports) {
  module.exports = WebSocketClient;
} else {
  window.WebSocketClient = WebSocketClient;
}
