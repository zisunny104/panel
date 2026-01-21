/**
 * SyncClient - 同步客戶端 (WebSocket + REST API 混合架構)
 *
 * 架構說明：
 * - REST API: 工作階段的建立、加入、查詢等操作
 * - WebSocket: 即時狀態同步、客戶端上下線通知
 * - sessionStorage: 用於同一分頁內的狀態恢復（重新整理後自動恢復連線）
 *
 * URL 自動偵測：
 * - 測試環境: localhost
 * - 生產環境: 自動使用目前網域
 * - Port 固定: 7645
 */

// 防止重複載入
if (typeof window !== "undefined" && window.SyncClient) {
  console.warn("[SyncClient] 已載入，跳過重複載入");
} else {
  // 類別定義
  class SyncClient {
    constructor(config = {}) {
      // API 端點配置
      this.apiBaseUrl = config.apiBaseUrl || this.getDefaultApiUrl();

      // WebSocket 客戶端（延遲初始化）
      this.wsClient = null;
      this.wsConfig = {
        url: config.wsUrl,
        storagePrefix: "panel_sync_",
        autoReconnect: true,
      };

      // 狀態
      this.sessionId = null;
      this.clientId = null;
      this.role = "viewer";
      this.connected = false;
      this.serverOnline = true;
      this.previousServerOnline = true;
      this.initialized = false; // 標記是否已初始化

      // 從 sessionStorage 載入狀態（如果有）
      this.loadState();

      // 健康檢查定時器（本機模式也需要，用於指示器）
      this.healthCheckTimer = null;
      this.healthCheckInterval = 10000; // 10秒（輕量級即時檢查）
      this.healthCheckMethod = "lightweight"; // "lightweight" 或 "websocket"

      // 如果有儲存的 sessionId，代表之前加入過工作階段，需要恢復
      if (this.sessionId) {
        Logger.info("[SyncClient] 偵測到儲存的工作階段，準備恢復連線");
        this.initializeSync();
      } else {
        Logger.debug("[SyncClient] 本機模式，啟動輕量級健康檢查");
        // 本機模式也啟動健康檢查，但使用輕量級方法
        this.startLightweightHealthCheck();
      }
    }

    /**
     * 初始化同步功能（延遲初始化）
     * 只在建立或加入工作階段時呼叫
     */
    initializeSync() {
      if (this.initialized) {
        Logger.debug("[SyncClient] 同步功能已初始化，跳過");
        return;
      }

      Logger.info("[SyncClient] 初始化同步功能...");

      // 停止輕量級健康檢查（切換到 WebSocket 狀態監聆）
      this.stopHealthCheck();

      // 建立 WebSocket 客戶端
      this.wsClient = new WebSocketClient(this.wsConfig);

      // 設定 WebSocket 事件處理
      this.setupWebSocketHandlers();

      // 同步模式使用 WebSocket 狀態，不需要額外的 HTTP 健康檢查
      this.healthCheckMethod = "websocket";

      this.initialized = true;
      Logger.info("[SyncClient] 同步功能初始化完成，切換到 WebSocket 狀態監聴");
    }

    /**
     * 取得預設 API URL（自動偵測目前網域）
     * 支援 Nginx 反向代理路徑
     */
    getDefaultApiUrl() {
      const protocol = window.location.protocol;
      const host = window.location.host; // 包含 hostname 和 port

      // 根據環境決定 API 路徑前綴
      const basePath = this.getApiBasePath();

      return `${protocol}//${host}${basePath}`;
    }

    /**
     * 取得 API 路徑前綴（可由外部配置覆蓋）
     */
    getApiBasePath() {
      // 預設使用 /api，可通過全域配置覆蓋
      return window.PANEL_API_BASE_PATH || "/api";
    }

    /**
     * 設定 WebSocket 事件處理器
     */
    setupWebSocketHandlers() {
      // 認證成功
      this.wsClient.on("authenticated", (data) => {
        Logger.debug("[SyncClient] WebSocket 認證成功", data);
        this.connected = true;
        this.sessionId = data.sessionId;
        this.clientId = data.clientId;
        this.role = data.role;
        this.saveState();

        // 觸發連線成功事件
        window.dispatchEvent(
          new CustomEvent("sync_connected", {
            detail: data,
          }),
        );
      });

      // 重新連接成功
      this.wsClient.on("reconnected", (data) => {
        Logger.debug("[SyncClient] WebSocket 重新連接成功", data);
        this.connected = true;

        window.dispatchEvent(
          new CustomEvent("sync_reconnected", {
            detail: data,
          }),
        );
      });

      // 斷線
      this.wsClient.on("disconnected", (data) => {
        Logger.info("[SyncClient] WebSocket 已斷線", data);
        this.connected = false;

        window.dispatchEvent(
          new CustomEvent("sync_disconnected", {
            detail: data,
          }),
        );
      });

      // 狀態更新
      this.wsClient.on("state_update", (data) => {
        Logger.debug("[SyncClient] 收到狀態更新", data);
        this.triggerStateUpdate(data.state);
      });

      // 客戶端加入
      this.wsClient.on("client_joined", (data) => {
        Logger.debug("[SyncClient] 新客戶端加入", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_joined", {
            detail: data,
          }),
        );
      });

      // 客戶端離開
      this.wsClient.on("client_left", (data) => {
        Logger.debug("[SyncClient] 客戶端離開", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_left", {
            detail: data,
          }),
        );
      });

      // 客戶端重新連接
      this.wsClient.on("client_reconnected", (data) => {
        Logger.debug("[SyncClient] 客戶端重新連接", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_reconnected", {
            detail: data,
          }),
        );
      });

      // 伺服器錯誤
      this.wsClient.on("server_error", (data) => {
        Logger.error("[SyncClient] 伺服器錯誤", data);

        // 檢查是否為工作階段不存在錯誤
        if (data && data.message && data.message.includes("工作階段不存在")) {
          Logger.warn(
            "[SyncClient] 偵測到工作階段不存在錯誤，自動清理工作階段資訊",
          );

          // 清理工作階段相關的儲存資訊
          this.clearInvalidSessionData();

          // 觸發工作階段失效事件
          window.dispatchEvent(
            new CustomEvent("sync_session_invalid", {
              detail: {
                reason: "session_not_found",
                originalError: data,
              },
            }),
          );
        }

        window.dispatchEvent(
          new CustomEvent("sync_server_error", {
            detail: data,
          }),
        );
      });

      // 實驗事件 - experiment_started
      this.wsClient.on("experiment_started", (data) => {
        Logger.debug("[SyncClient] 收到實驗開始事件", data);
        window.dispatchEvent(
          new CustomEvent("remote_experiment_started", {
            detail: data,
          }),
        );
      });

      // 實驗事件 - experiment_paused
      this.wsClient.on("experiment_paused", (data) => {
        Logger.debug("[SyncClient] 收到實驗暫停事件", data);
        window.dispatchEvent(
          new CustomEvent("remote_experiment_paused", {
            detail: data,
          }),
        );
      });

      // 實驗事件 - experiment_resumed
      this.wsClient.on("experiment_resumed", (data) => {
        Logger.debug("[SyncClient] 收到實驗恢復事件", data);
        window.dispatchEvent(
          new CustomEvent("remote_experiment_resumed", {
            detail: data,
          }),
        );
      });

      // 實驗事件 - experiment_stopped
      this.wsClient.on("experiment_stopped", (data) => {
        Logger.debug("[SyncClient] 收到實驗停止事件", data);
        window.dispatchEvent(
          new CustomEvent("remote_experiment_stopped", {
            detail: data,
          }),
        );
      });

      // 實驗事件 - experiment_id_update
      this.wsClient.on("experiment_id_update", (data) => {
        Logger.debug("[SyncClient] 收到實驗ID更新事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_id_updated", {
            detail: data,
          }),
        );
      });

      // 工作階段狀態更新
      this.wsClient.on("session_state", (data) => {
        Logger.debug("[SyncClient] 收到工作階段狀態", data);
        window.dispatchEvent(
          new CustomEvent("sync_session_state", {
            detail: data,
          }),
        );
      });
    }

    /**
     * 建立新的工作階段（建立者直接加入）
     * @param {string} createCode - 建立代碼（格式：A12B-C34D-E56F）
     * @returns {Promise<{sessionId: string}>}
     */
    async createSession(createCode) {
      try {
        // 首次建立工作階段，初始化同步功能
        this.initializeSync();

        // 檢查伺服器狀態
        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法建立工作階段");
        }

        // 調用 REST API 建立工作階段
        const response = await fetch(`${this.apiBaseUrl}/sync/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            createCode,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        // 儲存工作階段資訊
        this.sessionId = data.data.sessionId;
        this.clientId = data.data.clientId;
        this.role = data.data.role; // 伺服器回傳的角色（operator）
        this.saveState();

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role,
        });

        // 回傳工作階段ID（不包含分享代碼）
        return {
          sessionId: data.data.sessionId,
        };
      } catch (error) {
        Logger.error("[SyncClient] 建立工作階段失敗:", error);
        throw error;
      }
    }

    /**
     * 產生分享代碼（在工作階段建立後）
     * @returns {Promise<{shareCode: string, expiresAt: string}>}
     */
    async generateShareCode() {
      try {
        if (!this.sessionId || !this.clientId) {
          throw new Error("尚未加入工作階段");
        }

        // 檢查伺服器狀態
        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法產生分享代碼");
        }

        // 調用 REST API 產生分享代碼
        const response = await fetch(
          `${this.apiBaseUrl}/sync/generate_share_code`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
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

        Logger.debug("[SyncClient] 分享代碼已產生:", data.data.share_code);

        return {
          shareCode: data.data.share_code,
          expiresAt: data.data.expires_at,
        };
      } catch (error) {
        Logger.error("[SyncClient] 產生分享代碼失敗:", error);
        throw error;
      }
    }

    /**
     * 通過分享代碼加入工作階段
     * @param {string} shareCode - 分享代碼（6位英數字）
     * @param {string} role - 角色 ('viewer' 或 'operator')
     * @returns {Promise<boolean>}
     */
    async joinSessionByShareCode(shareCode, role = "viewer") {
      try {
        // 首次加入工作階段，初始化同步功能
        this.initializeSync();

        // 檢查伺服器狀態
        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法加入工作階段");
        }

        // 調用 REST API 加入工作階段
        const response = await fetch(`${this.apiBaseUrl}/sync/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shareCode,
            role,
            clientId: this.clientId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        // 儲存工作階段資訊
        this.sessionId = data.data.sessionId;
        this.clientId = data.data.clientId;
        this.role = data.data.role;
        this.saveState();

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role,
        });

        // 如果有初始狀態，立即觸發更新事件
        if (data.data.state) {
          this.triggerStateUpdate(data.data.state);
        }

        return true;
      } catch (error) {
        Logger.error("[SyncClient] 加入工作階段失敗:", error);
        throw error;
      }
    }

    /**
     * 還原工作階段（重新整理後自動恢復）
     * 使用 sessionStorage 中的資訊
     * @returns {Promise<boolean>}
     */
    async restoreSession() {
      try {
        // 檢查是否有儲存的狀態
        if (!this.sessionId || !this.clientId) {
          Logger.debug("[SyncClient] 沒有可還原的工作階段");
          return false;
        }

        // 檢查伺服器狀態
        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法還原工作階段");
        }

        // 驗證工作階段是否仍然有效（調用 REST API）
        const response = await fetch(
          `${this.apiBaseUrl}/sync/session/${this.sessionId}/validate?clientId=${this.clientId}`,
        );

        if (!response.ok) {
          Logger.info("[SyncClient] 工作階段已失效，清除狀態");
          this.clearState();
          return false;
        }

        const data = await response.json();

        if (!data.data.valid) {
          Logger.warn("[SyncClient] 工作階段驗證失敗，清除狀態");
          this.clearState();
          return false;
        }

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role,
        });

        Logger.info("[SyncClient] 工作階段還原成功");
        return true;
      } catch (error) {
        Logger.error("[SyncClient] 還原工作階段失敗:", error);
        this.clearState();
        return false;
      }
    }

    /**
     * 取得分享代碼資訊
     * @param {string} shareCode - 分享代碼
     * @returns {Promise<Object>}
     */
    async getShareCodeInfo(shareCode) {
      try {
        const response = await fetch(
          `${this.apiBaseUrl}/sync/share-code/${shareCode}`,
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data;
      } catch (error) {
        Logger.error("[SyncClient] 取得分享代碼資訊失敗:", error);
        throw error;
      }
    }

    /**
     * 重新產生分享代碼
     * @returns {Promise<{shareCode: string, sessionId: string}>}
     */
    async regenerateShareCode() {
      try {
        if (!this.connected || !this.sessionId) {
          throw new Error("未連線到工作階段");
        }

        if (this.role !== "operator") {
          throw new Error("僅操作者可以重新產生分享代碼");
        }

        const response = await fetch(
          `${this.apiBaseUrl}/sync/session/${this.sessionId}/share-code`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              clientId: this.clientId,
            }),
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
      } catch (error) {
        Logger.error("[SyncClient] 重新產生分享代碼失敗:", error);
        throw error;
      }
    }

    /**
     * 取得工作階段中的所有客戶端
     * @returns {Promise<Array>}
     */
    async getSessionClients() {
      try {
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
      } catch (error) {
        Logger.error("[SyncClient] 取得客戶端列表失敗:", error);
        throw error;
      }
    }

    /**
     * 同步狀態更新（透過 WebSocket）
     * @param {Object} state - 狀態物件
     * @returns {boolean}
     */
    syncState(state) {
      // 檢查是否已初始化同步功能
      if (!this.initialized || !this.wsClient) {
        Logger.debug("[SyncClient] 本機模式，跳過狀態同步");
        return false;
      }
      if (!this.connected || !this.sessionId) {
        Logger.warn("[SyncClient] 未連線，無法同步狀態");
        return false;
      }

      if (this.role !== "operator") {
        Logger.warn("[SyncClient] 僅操作者可以發送狀態更新");
        return false;
      }

      // 透過 WebSocket 發送狀態更新
      this.wsClient.updateState(state);
      return true;
    }

    /**
     * 觸發狀態更新事件
     * @param {Object|string} state - 狀態資料
     */
    triggerStateUpdate(state) {
      try {
        const parsedState =
          typeof state === "string" ? JSON.parse(state) : state;
        const event = new CustomEvent("sync_state_update", {
          detail: parsedState,
        });
        window.dispatchEvent(event);
      } catch (error) {
        Logger.error("[SyncClient] 狀態解析錯誤:", error);
      }
    }

    /**
     * 斷開連線
     */
    disconnect() {
      Logger.info("[SyncClient] 斷開連線");
      this.wsClient.disconnect();
      this.connected = false;
      this.clearState();
    }

    /**
     * 檢查伺服器健康狀態（輕量級）
     * 使用 HEAD 請求，只檢查狀態碼，不傳輸資料
     * @returns {Promise<boolean>}
     */
    async checkServerHealth() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/health`, {
          method: "HEAD", // 使用 HEAD 更輕量
          signal: AbortSignal.timeout(2000), // 2秒超時（快速失敗）
        });

        const newOnlineStatus = response.ok;

        // 如果狀態變化，觸發事件
        if (this.serverOnline !== newOnlineStatus) {
          this.previousServerOnline = this.serverOnline;
          this.serverOnline = newOnlineStatus;

          window.dispatchEvent(
            new CustomEvent("sync_server_status_changed", {
              detail: {
                online: this.serverOnline,
                previousOnline: this.previousServerOnline,
                timestamp: new Date().toISOString(),
              },
            }),
          );

          Logger.debug(
            `[SyncClient] 伺服器狀態變化: ${this.previousServerOnline} → ${this.serverOnline}`,
          );
        }

        this.serverOnline = newOnlineStatus;
        return this.serverOnline;
      } catch (error) {
        const wasOnline = this.serverOnline;
        this.serverOnline = false;

        if (wasOnline !== false) {
          this.previousServerOnline = wasOnline;
          window.dispatchEvent(
            new CustomEvent("sync_server_status_changed", {
              detail: {
                online: false,
                previousOnline: wasOnline,
                timestamp: new Date().toISOString(),
                error: error.message,
              },
            }),
          );
          Logger.warn(`[SyncClient] 伺服器狀態變化: ${wasOnline} → 離線`);
        }

        return false;
      }
    }

    /**
     * 啟動輕量級健康檢查（本機模式用）
     */
    startLightweightHealthCheck() {
      if (this.healthCheckTimer) return;

      Logger.debug("[SyncClient] 啟動輕量級健康檢查 (10秒間隔)");

      // 立即檢查一次
      this.checkServerHealth();

      // 定時檢查 (10秒)
      this.healthCheckTimer = setInterval(() => {
        this.checkServerHealth();
      }, this.healthCheckInterval);
    }

    /**
     * 啟動健康檢查定時器（舊版，保留相容）
     */
    startHealthCheck() {
      // 同步模式不需要 HTTP 健康檢查，直接回傳
      if (this.healthCheckMethod === "websocket") {
        Logger.debug(
          "[SyncClient] 同步模式，使用 WebSocket 狀態監視，不啟動 HTTP 健康檢查",
        );
        return;
      }

      // 本機模式使用輕量級健康檢查
      this.startLightweightHealthCheck();
    }

    /**
     * 停止健康檢查定時器
     */
    stopHealthCheck() {
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }
    }

    /**
     * 儲存狀態到 sessionStorage
     */
    saveState() {
      try {
        sessionStorage.setItem("sync_sessionId", this.sessionId || "");
        sessionStorage.setItem("sync_clientId", this.clientId || "");
        sessionStorage.setItem("sync_role", this.role || "viewer");
        Logger.debug("[SyncClient] 狀態已儲存至 sessionStorage");
      } catch (error) {
        Logger.error("[SyncClient] 儲存狀態失敗:", error);
      }
    }

    /**
     * 儲存角色到 sessionStorage（用於角色切換時更新）
     * @param {string} role - 角色 ('viewer' 或 'operator')
     */
    saveRole(role) {
      try {
        this.role = role;
        sessionStorage.setItem("sync_role", role);
        Logger.debug("[SyncClient] 角色已儲存至 sessionStorage:", role);
      } catch (error) {
        Logger.error("[SyncClient] 儲存角色失敗:", error);
      }
    }

    /**
     * 從 sessionStorage 載入狀態
     */
    loadState() {
      try {
        this.sessionId = sessionStorage.getItem("sync_sessionId") || null;
        this.clientId = sessionStorage.getItem("sync_clientId") || null;
        this.role = sessionStorage.getItem("sync_role") || "viewer";

        if (this.sessionId && this.clientId) {
          Logger.debug("[SyncClient] 從 sessionStorage 載入狀態:", {
            sessionId: this.sessionId,
            clientId: this.clientId,
            role: this.role,
          });
        }
      } catch (error) {
        Logger.error("[SyncClient] 載入狀態失敗:", error);
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
        this.role = "viewer";

        Logger.debug("[SyncClient] 已清除 sessionStorage 狀態");
      } catch (error) {
        Logger.error("[SyncClient] 清除狀態失敗:", error);
      }
    }

    // ==================== Getter 方法 ====================

    /**
     * 取得工作階段 ID
     */
    getSessionId() {
      return this.sessionId;
    }

    /**
     * 取得客戶端 ID
     */
    getClientId() {
      return this.clientId;
    }

    /**
     * 取得角色
     */
    getRole() {
      return this.role;
    }

    /**
     * 檢查是否可以操作
     */
    canOperate() {
      return this.connected && this.role === "operator";
    }

    /**
     * 檢查是否已連線
     */
    isConnected() {
      return this.connected && this.wsClient !== null;
    }

    /**
     * 取得狀態描述文字
     * @returns {'offline'|'idle'|'viewer'|'operator'}
     */
    getStatusText() {
      if (this.serverOnline === false) {
        return "offline";
      }

      if (this.connected && this.sessionId) {
        return this.role; // 'viewer' 或 'operator'
      }

      return "idle";
    }

    /**
     * 取得 WebSocket 狀態（用於除錯）
     */
    getWebSocketState() {
      return this.wsClient.getState();
    }

    /**
     * 清理無效的工作階段資料
     * 當伺服器回報工作階段不存在時呼叫
     */
    clearInvalidSessionData() {
      try {
        Logger.info("[SyncClient] 清理無效的工作階段資料");

        // 清除 localStorage 中的工作階段資訊
        localStorage.removeItem("sync_session_id");
        localStorage.removeItem("sync_session_backup");
        localStorage.removeItem("sync_client_id");

        // 清除 sessionStorage 中的工作階段資訊
        sessionStorage.removeItem("sync_session_id");
        sessionStorage.removeItem("sync_client_id");
        sessionStorage.removeItem("sync_role");

        // 重置內部狀態
        this.sessionId = null;
        this.clientId = null;
        this.role = "viewer";
        this.connected = false;

        // 如果 WebSocket 連線存在，斷開它
        if (this.wsClient) {
          this.wsClient.disconnect();
        }

        Logger.info("[SyncClient] 工作階段資料清理完成");
      } catch (error) {
        Logger.error("[SyncClient] 清理工作階段資料時發生錯誤:", error);
      }
    }
  }

  // UMD 模式：同時支援全域和 ES6 模組
  if (typeof window !== "undefined") {
    window.SyncClient = SyncClient;
  }
} // 閉合防止重複載入的條件

// 僅在模組環境中匯出（避免普通 script 語法錯誤）
if (typeof module !== "undefined" && module.exports) {
  module.exports = SyncClient;
}
