/**
 * SyncClient - 多裝置同步客戶端
 *
 * 負責 WebSocket + REST API 混合架構的同步、工作階段管理、狀態同步、
 * 心跳檢測與分享代碼管理，支援多客戶端協同同步。
 */

import { SYNC_EVENTS } from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";
import { WebSocketClient } from "../core/websocket-client.js";

class SyncClient {
  /**
   * 建構函數
   * @param {Object} config - 配置選項
   */
  constructor(config = {}) {
    this.roleConfig = {
      VIEWER: "viewer",
      OPERATOR: "operator",
      LOCAL: "local",
      ...config.roleConfig,
    };
    // API 端點配置
    this.apiBaseUrl = config.apiBaseUrl || this.getDefaultApiUrl();

    // WebSocket 客戶端（延遲初始化）
    this.wsClient = null;
    this.wsConfig = {
      url: config.wsUrl,
      storagePrefix: "panel_sync_",
      autoReconnect: true,
    };
    this.timeSyncManager = config.timeSyncManager || null;

    // 連線和狀態管理
    this.sessionId = null;
    this.clientId = null;
    this.role = this.roleConfig.LOCAL;
    this.connected = false;
    this.serverOnline = true;
    this.previousServerOnline = true;
    this.initialized = false;
    this.sessionInvalid = false;
    this.connectionAttempted = false;

    // 從 sessionStorage 載入狀態
    this.loadState();

    // 心跳檢測定時器
    this.healthCheckTimer = null;
    this.healthCheckInterval = 30000; // 從 10000ms 增加到 30000ms (30秒)
    this.healthCheckMethod = "lightweight";
    this.lastHealthCheckTime = 0; // 快取最後檢查時刻
    this.healthCheckCacheTtl = 3000; // 3 秒內回傳快取結果

    // 如果有儲存的 sessionId，代表之前加入過工作階段
    if (this.sessionId) {
      Logger.info("偵測到儲存的工作階段，準備恢復連線");
    } else {
      this.startHeartbeatCheck();
    }

    // 監聽全域工作階段失效事件
    this.setupGlobalEventHandlers();
  }

  /**
   * 設定全域事件處理器
   */
  setupGlobalEventHandlers() {
    window.addEventListener(
      SYNC_EVENTS.WEBSOCKET_SESSION_INVALID,
      (event) => {
        const { reason, originalError } = event.detail;
        Logger.warn("收到全域工作階段失效事件", { reason, originalError });

        this.sessionInvalid = true;
        this.clearInvalidSessionData();

        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.SESSION_INVALID, {
            detail: { reason, originalError },
          }),
        );
      },
    );
  }

  /**
   * 初始化同步功能
   */
  initializeSync() {
    if (this.initialized) {
      Logger.debug("同步功能已初始化，跳過");
      return;
    }

    const initStart = performance.now();

    Logger.info("初始化同步功能...");

    this.stopHealthCheck();

    this.wsClient = new WebSocketClient({
      ...this.wsConfig,
      roleConfig: this.roleConfig,
      timeSyncManager: this.timeSyncManager,
    });
    this.setupWebSocketHandlers();

    this.healthCheckMethod = "websocket";

    this.initialized = true;
    const duration = performance.now() - initStart;
    Logger.info(
      `同步功能初始化完成，切換到 WebSocket 狀態監聽 (<orange>${duration.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 取得預設 API URL
   * @returns {string}
   */
  getDefaultApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const basePath = this.getApiBasePath();
    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 API 路徑前綴
   * @returns {string}
   */
  getApiBasePath() {
    const pathname = window.location.pathname;
    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }
    if (!basePath.endsWith("/")) {
      basePath += "/";
    }
    return basePath + "api";
  }

  /**
   * 設定 WebSocket 事件處理器
   */
  setupWebSocketHandlers() {
    this.wsClient.on("authenticated", (data) => {
      Logger.debug("WebSocket 認證成功", data);
      this.connected = true;
      this.sessionId = data.sessionId;
      this.clientId = data.clientId;
      this.role = data.role;
      this.saveState();

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CONNECTED, { detail: data }),
      );
    });

    this.wsClient.on("reconnected", (data) => {
      Logger.debug("WebSocket 重新連接成功", data);
      this.connected = true;

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.RECONNECTED, { detail: data }),
      );
    });

    this.wsClient.on("disconnected", (data) => {
      Logger.info("WebSocket 已斷線", data);
      this.connected = false;

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.DISCONNECTED, { detail: data }),
      );
    });

    this.wsClient.on(WS_PROTOCOL.S2C.SESSION_STATE_UPDATE, (data) => {
      Logger.debug("收到狀態更新", data);
      this.triggerStateUpdate(data.state);
    });

    this.wsClient.on("client_joined", (data) => {
      Logger.debug("新客戶端加入", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CLIENT_JOINED, { detail: data }),
      );
    });

    this.wsClient.on("client_left", (data) => {
      Logger.debug("客戶端退出", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CLIENT_LEFT, { detail: data }),
      );
    });

    this.wsClient.on("client_reconnected", (data) => {
      Logger.debug("客戶端重新連接", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CLIENT_RECONNECTED, {
          detail: data,
        }),
      );
    });

    this.wsClient.on("server_error", (data) => {
      Logger.error("伺服器錯誤", data);

      if (data && data.message && data.message.includes("工作階段不存在")) {
        Logger.warn("偵測到工作階段不存在錯誤，自動清理工作階段資訊");

        this.sessionInvalid = true;
        this.clearInvalidSessionData();

        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.SESSION_INVALID, {
            detail: {
              reason: "session_not_found",
              originalError: data,
            },
          }),
        );
      }

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SERVER_ERROR, { detail: data }),
      );
    });

    this.wsClient.on(SYNC_EVENTS.EXPERIMENT_STARTED, (data) => {
      Logger.debug("收到實驗開始事件", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STARTED, {
          detail: data,
        }),
      );
    });

    this.wsClient.on(SYNC_EVENTS.EXPERIMENT_PAUSED, (data) => {
      Logger.debug("收到實驗暫停事件", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_PAUSED, { detail: data }),
      );
    });

    this.wsClient.on(SYNC_EVENTS.EXPERIMENT_RESUMED, (data) => {
      Logger.debug("收到實驗恢復事件", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_RESUMED, {
          detail: data,
        }),
      );
    });

    this.wsClient.on(SYNC_EVENTS.EXPERIMENT_STOPPED, (data) => {
      Logger.debug("收到實驗停止事件", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STOPPED, {
          detail: data,
        }),
      );
    });

    this.wsClient.on(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, (data) => {
      Logger.debug("收到實驗ID變化事件", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, {
          detail: data,
        }),
      );
    });

    this.wsClient.on("session_state", (data) => {
      Logger.debug("收到工作階段狀態", data);
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SESSION_STATE, { detail: data }),
      );

      // 若工作階段中儲存有實驗狀態，重新派發為 STATE_UPDATE 以觸發各頁面的恢復邏輯
      // （例：Board 重連時自動恢復進行中的實驗）
      const experimentState = data?.experimentState;
      if (experimentState?.type) {
        Logger.debug("工作階段含有實驗狀態，觸發恢復事件", experimentState);
        // 延遲一個 tick，確保所有模組（FlowManager、SyncManager 等）已就緒
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
              detail: { ...experimentState, _sessionRestore: true },
            }),
          );
        }, 0);
      }

      // ================= 電源狀態恢復邏輯 =================
      // 當工作階段有儲存電源狀態時，派發事件讓 PowerControl 進行恢復
      // 但若工作階段沒有實驗狀態，則視為尚未進入實驗流程，電源應回到預設關閉
      const lastState = data?.state;
      if (lastState && typeof lastState.powerState === "boolean") {
        const hasExperimentState = Boolean(experimentState?.type);
        const powerState = hasExperimentState ? lastState.powerState : false;
        const isPowerVideoPlaying = hasExperimentState
          ? typeof lastState.isPowerVideoPlaying === "boolean"
            ? lastState.isPowerVideoPlaying
            : false
          : false;

        document.dispatchEvent(
          new CustomEvent("syncPowerState", {
            detail: {
              powerState,
              isPowerVideoPlaying,
              clientId: lastState.clientId,
              // _sessionRestore 標誌用於通知 PowerControl 跳過 anti-echo 檢查
              // 允許工作階段恢復時的自我事件通過處理，避免狀態被誤判為重複
              _sessionRestore: true,
            },
          }),
        );

        if (!hasExperimentState) {
          Logger.debug("工作階段未含實驗狀態，電源已重置為預設關閉");
        }
      }
    });
  }

  // ==================== 工作階段管理 ====================

  /**
   * 建立新的工作階段
   * @param {string} createCode - 建立代碼
   * @returns {Promise<{sessionId: string}>}
   */
  async createSession(createCode) {
    this.initializeSync();

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法建立工作階段");
    }

    const response = await fetch(`${this.apiBaseUrl}/sync/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createCode }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    this.sessionId = data.data.sessionId;
    this.clientId = data.data.clientId;
    this.role = data.data.role;
    this.saveState();

    if (!this.wsClient) {
      this.initializeSync();
    }

    await this.wsClient.connect({
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
    });

    return { sessionId: data.data.sessionId };
  }

  /**
   * 產生分享代碼
   * @returns {Promise<{shareCode: string, expiresAt: string}>}
   */
  async generateShareCode() {
    if (!this.sessionId || !this.clientId) {
      throw new Error("尚未加入工作階段");
    }

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法產生分享代碼");
    }

    const response = await fetch(
      `${this.apiBaseUrl}/sync/generate_share_code`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: this.sessionId,
          clientId: this.clientId,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    Logger.debug("分享代碼已產生:", data.data.share_code);

    return {
      shareCode: data.data.share_code,
      expiresAt: data.data.expires_at,
    };
  }

  /**
   * 通過分享代碼加入工作階段
   * @param {string} shareCode - 分享代碼
   * @param {string} role - 角色
   * @returns {Promise<boolean>}
   */
  async joinSessionByShareCode(
    shareCode,
    role = null,
  ) {
    const resolvedRole = role || this.roleConfig.VIEWER;
    if (this.sessionInvalid) {
      this.sessionInvalid = false;
      Logger.info("重置工作階段失效標記，允許重新加入");
    }

    this.initializeSync();

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法加入工作階段");
    }

    const response = await fetch(`${this.apiBaseUrl}/sync/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareCode, role: resolvedRole, clientId: this.clientId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    this.sessionId = data.data.sessionId;
    this.clientId = data.data.clientId;
    this.role = data.data.role;
    this.saveState();

    await this.wsClient.connect({
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
    });

    if (data.data.state) {
      this.triggerStateUpdate(data.data.state);
    }

    return true;
  }

  /**
   * 加入公開頻道（無需分享代碼）
   * @param {string} channelName - 頻道名稱 "A" | "B" | "C"
   * @param {string} role - 角色（預設 operator）
   * @returns {Promise<boolean>}
   */
  async joinPublicChannel(
    channelName,
    role = null,
  ) {
    const resolvedRole = role || this.roleConfig.OPERATOR;
    this.initializeSync();

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法加入頻道");
    }

    const response = await fetch(`${this.apiBaseUrl}/sync/channel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName, role: resolvedRole, clientId: this.clientId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    this.sessionId = data.data.sessionId;
    this.clientId = data.data.clientId;
    this.role = data.data.role;
    this.saveState();

    await this.wsClient.connect({
      sessionId: this.sessionId,
      clientId: this.clientId,
      role: this.role,
    });

    return true;
  }

  /**
   * 關閉公開頻道（中斷所有連線）
   * @param {string} sessionId - 公開頻道 sessionId（可選）
   * @returns {Promise<Object>}
   */
  async closePublicChannel(sessionId = null) {
    const targetSessionId = sessionId || this.sessionId;
    if (!targetSessionId || !targetSessionId.startsWith("__CH_")) {
      throw new Error("目前不在公開頻道");
    }

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法關閉頻道");
    }

    const response = await fetch(`${this.apiBaseUrl}/sync/channel/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: targetSessionId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data || {};
  }

  /**
   * 關閉指定工作階段
   * @param {string} sessionId - 工作階段 ID
   * @returns {Promise<Object>}
   */
  async closeSession(sessionId = null) {
    const targetSessionId = sessionId || this.sessionId;
    if (!targetSessionId) {
      throw new Error("目前沒有可關閉的工作階段");
    }

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法關閉工作階段");
    }

    const response = await fetch(
      `${this.apiBaseUrl}/sync/session/${encodeURIComponent(targetSessionId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data || {};
  }

  /**
   * 還原工作階段
   * @returns {Promise<boolean>}
   */
  async restoreSession() {
    if (this.sessionInvalid) {
      Logger.debug("工作階段已失效，跳過還原");
      return false;
    }

    if (!this.sessionId || !this.clientId) {
      Logger.debug("沒有可還原的工作階段");
      return false;
    }

    await this.checkServerHealth();
    if (!this.serverOnline) {
      throw new Error("伺服器離線，無法還原工作階段");
    }

    // 公開頻道不存在於 DB，跳過 validate 直接重連
    const isPublicChannel = this.sessionId.startsWith("__CH_");
    if (!isPublicChannel) {
      const response = await fetch(
        `${this.apiBaseUrl}/sync/session/${this.sessionId}/validate?clientId=${this.clientId}`,
      );

      if (!response.ok) {
        Logger.info("工作階段已失效，清除狀態");
        this.clearState();
        return false;
      }

      const data = await response.json();

      if (!data.data.valid) {
        Logger.warn("工作階段驗證失敗，清除狀態");
        this.clearState();
        return false;
      }
    } else {
      Logger.debug("公開頻道，跳過 DB 驗證直接重連", {
        sessionId: this.sessionId,
      });
    }

    // 如果 WebSocket 已連線且已認證，跳過重複連線
    if (
      this.wsClient &&
      this.wsClient.isAuthenticated &&
      this.wsClient.ws &&
      this.wsClient.ws.readyState === WebSocket.OPEN
    ) {
      Logger.debug("WebSocket 已連線且已認證，跳過重複連線");
    } else {
      // 確保 wsClient 已初始化
      if (!this.wsClient) {
        this.initializeSync();
      }
      await this.wsClient.connect({
        sessionId: this.sessionId,
        clientId: this.clientId,
        role: this.role,
      });
    }

    Logger.info("工作階段還原成功");
    return true;
  }

  /**
   * 取得分享代碼資訊
   * @param {string} shareCode - 分享代碼
   * @returns {Promise<Object>}
   */
  async getShareCodeInfo(shareCode) {
    const response = await fetch(
      `${this.apiBaseUrl}/sync/share-code/${shareCode}`,
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * 重新產生分享代碼
   * @returns {Promise<{shareCode: string, sessionId: string}>}
   */
  async regenerateShareCode() {
    if (!this.connected || !this.sessionId) {
      throw new Error("未連線到工作階段");
    }

    if (this.role !== this.roleConfig.OPERATOR) {
      throw new Error("僅操作者可以重新產生分享代碼");
    }

    const response = await fetch(
      `${this.apiBaseUrl}/sync/session/${this.sessionId}/share-code`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: this.clientId }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      shareCode: data.data.shareCode,
      sessionId: data.data.sessionId,
    };
  }

  /**
   * 取得工作階段中的所有客戶端
   * @returns {Promise<Array>}
   */
  async getSessionClients() {
    if (!this.sessionId) {
      throw new Error("未連線到工作階段");
    }

    const response = await fetch(
      `${this.apiBaseUrl}/sync/session/${this.sessionId}/clients`,
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.data.clients;
  }

  // ==================== 狀態同步 ====================

  /**
   * 同步狀態更新
   * @param {Object} state - 狀態物件
   * @returns {boolean}
   */
  syncState(state) {
    if (!this.initialized || !this.wsClient) {
      Logger.debug("本機模式，跳過狀態同步");
      return false;
    }
    if (!this.connected || !this.sessionId) {
      Logger.warn("未連線，無法同步狀態");
      return false;
    }

    if (this.role !== this.roleConfig.OPERATOR) {
      Logger.warn("僅操作者可以發送狀態更新");
      return false;
    }

    this.wsClient.updateState(state);
    return true;
  }

  /**
   * 觸發狀態更新事件
   * @param {Object|string} state - 狀態資料
   */
  triggerStateUpdate(state) {
    try {
      const parsedState = typeof state === "string" ? JSON.parse(state) : state;
      const event = new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: parsedState,
      });
      window.dispatchEvent(event);
    } catch (error) {
      Logger.error("狀態解析錯誤:", error);
    }
  }

  /**
   * 斷開連線
   */
  disconnect() {
    Logger.info("斷開連線");
    this.stopHealthCheck();
    if (this.wsClient) {
      this.wsClient.disconnect();
    }
    this.connected = false;
    this.clearState();
  }

  // ==================== 狀態管理 ====================

  /**
   * 儲存狀態到 sessionStorage
   */
  saveState() {
    sessionStorage.setItem("sync_sessionId", this.sessionId || "");
    sessionStorage.setItem("sync_clientId", this.clientId || "");
    sessionStorage.setItem(
      "sync_role",
      this.role || this.roleConfig.LOCAL,
    );
    Logger.debug("狀態已儲存至 sessionStorage");
  }

  /**
   * 儲存角色到 sessionStorage
   * @param {string} role - 角色
   */
  saveRole(role) {
    try {
      this.role = role;
      sessionStorage.setItem("sync_role", role);
      Logger.debug("角色已儲存至 sessionStorage:", role);
    } catch (error) {
      Logger.error("儲存角色失敗:", error);
    }
  }

  /**
   * 從 sessionStorage 載入狀態
   */
  loadState() {
    try {
      this.sessionId = sessionStorage.getItem("sync_sessionId") || null;
      this.clientId = sessionStorage.getItem("sync_clientId") || null;
      this.role =
        sessionStorage.getItem("sync_role") || this.roleConfig.LOCAL;

      if (this.sessionId && this.clientId) {
        Logger.debug("從 sessionStorage 載入狀態:", {
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role,
        });
      }
    } catch (error) {
      Logger.error("載入狀態失敗:", error);
    }
  }

  /**
   * 清除 sessionStorage 狀態
   */
  clearState() {
    try {
      sessionStorage.removeItem("sync_sessionId");
      sessionStorage.removeItem("sync_clientId");
      sessionStorage.removeItem("sync_role");

      this.sessionId = null;
      this.clientId = null;
      this.role = this.roleConfig.LOCAL;
      this.connectionAttempted = false;

      Logger.debug("已清除 sessionStorage 狀態");
    } catch (error) {
      Logger.error("清除狀態失敗:", error);
    }
  }

  /**
   * 清理無效的工作階段資料
   */
  clearInvalidSessionData() {
    Logger.info("清理無效的工作階段資料");

    this.stopHealthCheck();
    this.clearState();

    this.connected = false;

    if (this.wsClient) {
      this.wsClient.disconnect();
    }

    Logger.info("工作階段資料清理完成");
  }

  // ==================== 健康檢查 ====================

  /**
   * 檢查伺服器健康狀態
   * @returns {Promise<boolean>}
   */
  async checkServerHealth() {
    // 快取：3 秒內有相同結果直接回傳，避免重複 HEAD 請求
    const now = Date.now();
    if (now - this.lastHealthCheckTime < this.healthCheckCacheTtl) {
      return this.serverOnline;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/health`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });

      this.lastHealthCheckTime = Date.now();

      const newOnlineStatus = response.ok;

      if (this.serverOnline !== newOnlineStatus) {
        this.previousServerOnline = this.serverOnline;
        this.serverOnline = newOnlineStatus;

        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.SERVER_STATUS_CHANGED, {
            detail: {
              online: this.serverOnline,
              previousOnline: this.previousServerOnline,
              timestamp: new Date().toISOString(),
            },
          }),
        );

        Logger.debug(
          `伺服器狀態變化: ${this.previousServerOnline} → ${this.serverOnline}`,
        );
      }

      return this.serverOnline;
    } catch (error) {
      this.lastHealthCheckTime = Date.now(); // 失敗也更新快取，避免連續 2 秒 timeout
      const wasOnline = this.serverOnline;
      this.serverOnline = false;

      if (wasOnline !== false) {
        this.previousServerOnline = wasOnline;
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.SERVER_STATUS_CHANGED, {
            detail: {
              online: false,
              previousOnline: wasOnline,
              timestamp: new Date().toISOString(),
              error: error.message,
            },
          }),
        );
        Logger.warn(`伺服器狀態變化: ${wasOnline} → 離線`);
      }

      return false;
    }
  }

  /**
   * 啟動心跳檢測
   */
  startHeartbeatCheck() {
    if (this.healthCheckTimer) return;

    Logger.debug("啟動心跳檢測 (30秒間隔)");

    this.checkServerHealth();

    this.healthCheckTimer = setInterval(() => {
      this.checkServerHealth();
    }, this.healthCheckInterval);
  }

  /**
   * 停止心跳檢測定時器
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ==================== Getter 方法 ====================

  /**
   * 取得工作階段 ID
   * @returns {string|null}
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * 取得客戶端 ID
   * @returns {string|null}
   */
  getClientId() {
    return this.clientId;
  }

  /**
   * 取得角色
   * @returns {string}
   */
  getRole() {
    return this.role;
  }

  /**
   * 檢查是否可以操作
   * @returns {boolean}
   */
  canOperate() {
    return this.connected && this.role === this.roleConfig.OPERATOR;
  }

  /**
   * 檢查是否已連線
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.wsClient !== null;
  }

  /**
   * 取得狀態描述文字
   * @returns {'offline'|'idle'|'viewer'|'operator'}
   */
  getStatusText() {
    if (this.connected && this.sessionId) {
      return this.role;
    }

    if (this.sessionId && !this.connected) {
      return this.connectionAttempted ? "offline" : "idle";
    }

    if (this.serverOnline === false && !this.connected) {
      return "offline";
    }

    return "idle";
  }
}

// ES6 模組匯出
export default SyncClient;
export { SyncClient };
