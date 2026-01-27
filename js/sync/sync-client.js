/**
 * SyncClient - 同步客戶端
 *
 * 功能：
 * - WebSocket + REST API 混合架構處理同步功能
 * - 工作階段管理：建立、加入、還原工作階段
 * - 狀態同步：即時狀態更新和事件通知
 * - 心跳檢測：伺服器連線狀態監控
 * - 分享代碼：產生和管理工作階段分享代碼
 */

// 防止重複載入
if (typeof window !== "undefined" && window.SyncClient) {
  console.warn("已載入，跳過重複載入");
} else {
  class SyncClient {
    constructor(config = {}) {
      // API 端點配置
      this.apiBaseUrl = config.apiBaseUrl || this.getDefaultApiUrl();

      // WebSocket 客戶端（延遲初始化）
      this.wsClient = null;
      this.wsConfig = {
        url: config.wsUrl,
        storagePrefix: "panel_sync_",
        autoReconnect: true
      };

      // 連線和狀態管理
      this.sessionId = null;
      this.clientId = null;
      this.role = window.SyncManager?.ROLE?.LOCAL;
      this.connected = false;
      this.serverOnline = true;
      this.previousServerOnline = true;
      this.initialized = false; // 標記是否已初始化
      this.sessionInvalid = false; // 標記工作階段是否已失效

      // 從 sessionStorage 載入狀態（如果有）
      this.loadState();

      // 心跳檢測定時器（本機模式也需要，用於指示器）
      this.healthCheckTimer = null;
      this.healthCheckInterval = 10000; // 10秒
      this.healthCheckMethod = "lightweight"; // "lightweight" 或 "websocket"

      // 如果有儲存的 sessionId，代表之前加入過工作階段，需要恢復
      if (this.sessionId) {
        Logger.info("偵測到儲存的工作階段，準備恢復連線");
        this.initializeSync();
      } else {
        Logger.debug("本機模式，啟動心跳檢測");
        // 本機模式也啟動心跳檢測，但使用輕量級方法
        this.startHeartbeatCheck();
      }

      // 監聽全域工作階段失效事件
      this.setupGlobalEventHandlers();
    }

    /**
     * 設定全域事件處理器（始終監聽）
     */
    setupGlobalEventHandlers() {
      // 監聽全域工作階段失效事件（來自 WebSocketClient）
      window.addEventListener("websocket_session_invalid", (event) => {
        const { reason, originalError } = event.detail;
        Logger.warn("收到全域工作階段失效事件", {
          reason,
          originalError
        });

        this.sessionInvalid = true;
        this.clearInvalidSessionData();

        window.dispatchEvent(
          new CustomEvent("sync_session_invalid", {
            detail: {
              reason,
              originalError
            }
          })
        );
      });
    }

    /**
     * 初始化同步功能（延遲初始化）
     * 只在建立或加入工作階段時呼叫
     */
    initializeSync() {
      if (this.initialized) {
        Logger.debug("同步功能已初始化，跳過");
        return;
      }

      Logger.info("初始化同步功能...");

      // 停止心跳檢測（切換到 WebSocket 狀態監聽）
      this.stopHealthCheck();

      this.wsClient = new WebSocketClient(this.wsConfig);
      this.setupWebSocketHandlers();

      // 同步模式使用 WebSocket 狀態，不需要額外的 HTTP 心跳檢測
      this.healthCheckMethod = "websocket";

      this.initialized = true;
      Logger.info("同步功能初始化完成，切換到 WebSocket 狀態監聽");
    }

    /**
     * 取得預設 API URL（自動偵測目前網域）
     * 支援 Nginx 反向代理路徑
     */
    getDefaultApiUrl() {
      const protocol = window.location.protocol;
      const host = window.location.host; // 包含 hostname 和 port

      const basePath = this.getApiBasePath();

      return `${protocol}//${host}${basePath}`;
    }

    /**
     * 取得 API 路徑前綴（參考 QR Code 的動態路徑邏輯，完全避免硬編碼）
     */
    getApiBasePath() {
      // 根據頁面路徑動態決定 API 前綴
      const pathname = window.location.pathname;

      let basePath = pathname;
      if (!basePath.endsWith("/")) {
        basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
      }

      if (!basePath.endsWith("/")) {
        basePath += "/";
      }

      // API 永遠在頁面所在目錄的 api 子目錄
      // 讓 Nginx 處理實際的路徑映射
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
          new CustomEvent("sync_connected", {
            detail: data
          })
        );
      });

      this.wsClient.on("reconnected", (data) => {
        Logger.debug("WebSocket 重新連接成功", data);
        this.connected = true;

        window.dispatchEvent(
          new CustomEvent("sync_reconnected", {
            detail: data
          })
        );
      });

      this.wsClient.on("disconnected", (data) => {
        Logger.info("WebSocket 已斷線", data);
        this.connected = false;

        window.dispatchEvent(
          new CustomEvent("sync_disconnected", {
            detail: data
          })
        );
      });

      this.wsClient.on("state_update", (data) => {
        Logger.debug("收到狀態更新", data);
        this.triggerStateUpdate(data.state);
      });

      this.wsClient.on("client_joined", (data) => {
        Logger.debug("新客戶端加入", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_joined", {
            detail: data
          })
        );
      });

      this.wsClient.on("client_left", (data) => {
        Logger.debug("客戶端退出", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_left", {
            detail: data
          })
        );
      });

      this.wsClient.on("client_reconnected", (data) => {
        Logger.debug("客戶端重新連接", data);
        window.dispatchEvent(
          new CustomEvent("sync_client_reconnected", {
            detail: data
          })
        );
      });

      this.wsClient.on("server_error", (data) => {
        Logger.error("伺服器錯誤", data);

        if (data && data.message && data.message.includes("工作階段不存在")) {
          Logger.warn("偵測到工作階段不存在錯誤，自動清理工作階段資訊");

          this.sessionInvalid = true;
          this.clearInvalidSessionData();

          window.dispatchEvent(
            new CustomEvent("sync_session_invalid", {
              detail: {
                reason: "session_not_found",
                originalError: data
              }
            })
          );
        }

        window.dispatchEvent(
          new CustomEvent("sync_server_error", {
            detail: data
          })
        );
      });

      // 實驗開始事件
      this.wsClient.on("experiment_started", (data) => {
        Logger.debug("收到實驗開始事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_started", {
            detail: data
          })
        );
      });

      // 實驗暫停事件
      this.wsClient.on("experiment_paused", (data) => {
        Logger.debug("收到實驗暫停事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_paused", {
            detail: data
          })
        );
      });

      // 實驗恢復事件
      this.wsClient.on("experiment_resumed", (data) => {
        Logger.debug("收到實驗恢復事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_resumed", {
            detail: data
          })
        );
      });

      // 實驗停止事件
      this.wsClient.on("experiment_stopped", (data) => {
        Logger.debug("收到實驗停止事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_stopped", {
            detail: data
          })
        );
      });

      // 實驗ID變化事件
      this.wsClient.on("experiment_id_changed", (data) => {
        Logger.debug("收到實驗ID變化事件", data);
        window.dispatchEvent(
          new CustomEvent("experiment_id_changed", {
            detail: data
          })
        );
      });

      this.wsClient.on("session_state", (data) => {
        Logger.debug("收到工作階段狀態", data);
        window.dispatchEvent(
          new CustomEvent("sync_session_state", {
            detail: data
          })
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

        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法建立工作階段");
        }

        // 調用 REST API 建立工作階段
        const response = await fetch(`${this.apiBaseUrl}/sync/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            createCode
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        this.sessionId = data.data.sessionId;
        this.clientId = data.data.clientId;
        this.role = data.data.role; // 伺服器回傳的角色（operator）
        this.saveState();

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role
        });

        // 回傳工作階段ID（不包含分享代碼）
        return {
          sessionId: data.data.sessionId
        };
      } catch (error) {
        Logger.error("建立工作階段失敗:", error);
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
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sessionId: this.sessionId,
              clientId: this.clientId
            })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();

        Logger.debug("分享代碼已產生:", data.data.share_code);

        return {
          shareCode: data.data.share_code,
          expiresAt: data.data.expires_at
        };
      } catch (error) {
        Logger.error("產生分享代碼失敗:", error);
        throw error;
      }
    }

    /**
     * 通過分享代碼加入工作階段
     * @param {string} shareCode - 分享代碼（6位英數字）
     * @param {string} role - 角色 ('viewer' 或 'operator')
     * @returns {Promise<boolean>}
     */
    async joinSessionByShareCode(
      shareCode,
      role = window.SyncManager?.ROLE?.VIEWER
    ) {
      try {
        // 如果之前工作階段失效，重置標記允許重新加入
        if (this.sessionInvalid) {
          this.sessionInvalid = false;
          Logger.info("重置工作階段失效標記，允許重新加入");
        }

        // 首次加入工作階段，初始化同步功能
        this.initializeSync();

        await this.checkServerHealth();
        if (!this.serverOnline) {
          throw new Error("伺服器離線，無法加入工作階段");
        }

        // 調用 REST API 加入工作階段
        const response = await fetch(`${this.apiBaseUrl}/sync/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            shareCode,
            role,
            clientId: this.clientId
          })
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

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role
        });

        // 如果有初始狀態，立即觸發更新事件
        if (data.data.state) {
          this.triggerStateUpdate(data.data.state);
        }

        return true;
      } catch (error) {
        Logger.error("加入工作階段失敗:", error);
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
        // 如果工作階段已標記為失效，不嘗試還原
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

        // 驗證工作階段是否仍然有效（調用 REST API）
        const response = await fetch(
          `${this.apiBaseUrl}/sync/session/${this.sessionId}/validate?clientId=${this.clientId}`
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

        // 連接到 WebSocket
        await this.wsClient.connect({
          sessionId: this.sessionId,
          clientId: this.clientId,
          role: this.role
        });

        Logger.info("工作階段還原成功");
        return true;
      } catch (error) {
        Logger.error("還原工作階段失敗:", error);
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
          `${this.apiBaseUrl}/sync/share-code/${shareCode}`
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data;
      } catch (error) {
        Logger.error("取得分享代碼資訊失敗:", error);
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

        if (this.role !== window.SyncManager?.ROLE?.OPERATOR) {
          throw new Error("僅操作者可以重新產生分享代碼");
        }

        const response = await fetch(
          `${this.apiBaseUrl}/sync/session/${this.sessionId}/share-code`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              clientId: this.clientId
            })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return {
          shareCode: data.data.shareCode,
          sessionId: data.data.sessionId
        };
      } catch (error) {
        Logger.error("重新產生分享代碼失敗:", error);
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
          `${this.apiBaseUrl}/sync/session/${this.sessionId}/clients`
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.data.clients;
      } catch (error) {
        Logger.error("取得客戶端列表失敗:", error);
        throw error;
      }
    }

    /**
     * 同步狀態更新（透過 WebSocket）
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

      if (this.role !== window.SyncManager?.ROLE?.OPERATOR) {
        Logger.warn("僅操作者可以發送狀態更新");
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
        const event = new CustomEvent(window.SyncEvents.STATE_UPDATE, {
          detail: parsedState
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
          signal: AbortSignal.timeout(2000) // 2秒超時（快速失敗）
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
                timestamp: new Date().toISOString()
              }
            })
          );

          Logger.debug(
            `伺服器狀態變化: ${this.previousServerOnline} → ${this.serverOnline}`
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
                error: error.message
              }
            })
          );
          Logger.warn(`伺服器狀態變化: ${wasOnline} → 離線`);
        }

        return false;
      }
    }

    /**
     * 啟動心跳檢測（本機模式用）
     */
    startHeartbeatCheck() {
      if (this.healthCheckTimer) return;

      Logger.debug("啟動心跳檢測 (10秒間隔)");

      this.checkServerHealth();

      // 定時檢查 (10秒)
      this.healthCheckTimer = setInterval(() => {
        this.checkServerHealth();
      }, this.healthCheckInterval);
    }

    /**
     * 啟動心跳檢測定時器（舊版，保留相容）
     * @deprecated 使用 startHeartbeatCheck() 替代
     */
    startHealthCheck() {
      // 同步模式不需要 HTTP 心跳檢測，直接回傳
      if (this.healthCheckMethod === "websocket") {
        Logger.debug("同步模式，使用 WebSocket 狀態監視，不啟動 HTTP 心跳檢測");
        return;
      }

      // 本機模式使用心跳檢測
      this.startHeartbeatCheck();
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

    /**
     * 儲存狀態到 sessionStorage
     */
    saveState() {
      try {
        sessionStorage.setItem("sync_sessionId", this.sessionId || "");
        sessionStorage.setItem("sync_clientId", this.clientId || "");
        sessionStorage.setItem(
          "sync_role",
          this.role || window.SyncManager?.ROLE?.VIEWER
        );
        Logger.debug("狀態已儲存至 sessionStorage");
      } catch (error) {
        Logger.error("儲存狀態失敗:", error);
      }
    }

    /**
     * 儲存角色到 sessionStorage（用於角色切換時更新）
     * @param {string} role - 角色 ('viewer', 'operator' 或 'local')
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
          sessionStorage.getItem("sync_role") ||
          window.SyncManager?.ROLE?.LOCAL;

        if (this.sessionId && this.clientId) {
          Logger.debug("從 sessionStorage 載入狀態:", {
            sessionId: this.sessionId,
            clientId: this.clientId,
            role: this.role
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
        this.role = window.SyncManager?.ROLE?.LOCAL; // 清除狀態後回到本機模式

        Logger.debug("已清除 sessionStorage 狀態");
      } catch (error) {
        Logger.error("清除狀態失敗:", error);
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
      return this.connected && this.role === window.SyncManager?.ROLE?.OPERATOR;
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
        return this.role; // 'viewer', 'operator' 或 'local'
      }

      return "idle";
    }

    /**
     * 清理無效的工作階段資料
     * 當伺服器回報工作階段不存在時呼叫
     */
    clearInvalidSessionData() {
      try {
        Logger.info("清理無效的工作階段資料");

        // 清除 sessionStorage 中的工作階段資訊（與 saveState 方法保持一致）
        sessionStorage.removeItem("sync_sessionId");
        sessionStorage.removeItem("sync_clientId");
        sessionStorage.removeItem("sync_role");

        // 重置內部狀態
        this.sessionId = null;
        this.clientId = null;
        this.role = window.SyncManager?.ROLE?.LOCAL; // 重置後回到本機模式
        this.connected = false;

        // 如果 WebSocket 連線存在，斷開它
        if (this.wsClient) {
          this.wsClient.disconnect();
        }

        Logger.info("工作階段資料清理完成");
      } catch (error) {
        Logger.error("清理工作階段資料時發生錯誤:", error);
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
