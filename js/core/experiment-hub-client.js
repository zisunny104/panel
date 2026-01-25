/**
 * ExperimentHubClient - 實驗中樞客戶端 (WebSocket 版本)
 *
 * 架構說明：
 * - 與 SyncClient 共用同一個 WebSocket 連線
 * - 處理實驗相關的即時通訊（實驗 ID 同步、實驗狀態變更等）
 * - 使用 REST API 進行實驗 ID 的註冊和查詢
 *
 * URL 自動偵測：
 * - 測試環境: localhost
 * - 生產環境: 自動使用目前網域
 * - Port 固定: 7645
 */

// 防止重複載入
if (typeof window !== "undefined" && window.ExperimentHubClient) {
  console.warn("已載入，跳過重複載入");
} else {
  // 類別定義
  class ExperimentHubClient {
    constructor(config = {}) {
      // API 端點配置
      this.apiBaseUrl = config.apiBaseUrl || this.getDefaultApiUrl();

      // WebSocket 客戶端（由 SyncClient 提供）
      this.wsClient = null;

      // 狀態
      this.connected = false;
      this.role = window.SyncManager?.ROLE?.VIEWER;
      this.syncClientReady = false;

      // 快速更新限制器（防止過度頻繁的更新）
      this.fastUpdateLimiter = new Map();

      // 等待 SyncClient 就緒
      this.waitForSyncClient();
    }

    /**
     * 取得預設 API URL（支援 Nginx 反向代理）
     */
    getDefaultApiUrl() {
      const protocol = window.location.protocol;
      const host = window.location.host; // 包含 hostname 和 port

      // 根據環境決定 API 路徑前綴
      const basePath = this.getApiBasePath();

      return `${protocol}//${host}${basePath}`;
    }

    /**
     * 取得 API 路徑前綴（參考 QR Code 的動態路徑邏輯，完全避免硬編碼）
     */
    getApiBasePath() {
      // 根據頁面路徑動態決定 API 前綴（完全動態，無硬編碼）
      const pathname = window.location.pathname;

      // 取得頁面所在的目錄路徑
      let basePath = pathname;
      if (!basePath.endsWith("/")) {
        // 如果包含檔名，移除檔名部分
        basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
      }

      // 確保以 / 結尾
      if (!basePath.endsWith("/")) {
        basePath += "/";
      }

      // API 永遠在頁面所在目錄的 api 子目錄
      // 讓 Nginx 處理實際的路徑映射
      return basePath + "api";
    }

    /**
     * 等待 SyncClient 就緒
     * SyncClient 會在全域提供 WebSocket 連線
     */
    waitForSyncClient() {
      const checkInterval = setInterval(() => {
        // 檢查 window.syncManager 是否就緒
        if (window.syncManager?.core?.syncClient) {
          clearInterval(checkInterval);
          this.onSyncClientReady();
        }
      }, 100);

      // 30 秒後停止檢查
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!this.syncClientReady) {
          Logger.warn("SyncClient 就緒超時");
        }
      }, 30000);
    }

    /**
     * SyncClient 就緒回調
     */
    onSyncClientReady() {
      Logger.info("SyncClient 就緒");
      this.syncClientReady = true;

      // 取得 SyncClient 的 WebSocket 客戶端
      const syncClient = window.syncManager.core.syncClient;
      this.wsClient = syncClient.wsClient;

      // 設定事件處理器
      this.setupEventHandlers();

      // 檢查是否已經連線
      if (syncClient.isConnected()) {
        this.connected = true;
        this.role = syncClient.getRole();
      }
    }

    /**
     * 設定 WebSocket 事件處理器
     */
    setupEventHandlers() {
      if (!this.wsClient) return;

      // 監聽實驗相關事件
      this.wsClient.on("experiment_started", (data) => {
        Logger.debug("實驗開始", data);
        this.triggerExperimentStateChange({ state: "started", ...data });
      });

      this.wsClient.on("experiment_paused", (data) => {
        Logger.debug("實驗暫停", data);
        this.triggerExperimentStateChange({ state: "paused", ...data });
      });

      this.wsClient.on("experiment_resumed", (data) => {
        Logger.debug("實驗恢復", data);
        this.triggerExperimentStateChange({ state: "resumed", ...data });
      });

      this.wsClient.on("experiment_stopped", (data) => {
        Logger.debug("實驗停止", data);
        this.triggerExperimentStateChange({ state: "stopped", ...data });
      });

      this.wsClient.on("experiment_id_update", (data) => {
        Logger.debug("實驗 ID 更新", data);
        // 檢查是否是自己的更新（避免回音）
        if (data.clientId !== this.getClientId()) {
          this.triggerExperimentIdUpdate(data);
        }
      });

      // 監聽連線狀態
      this.wsClient.on("authenticated", (data) => {
        this.connected = true;
        this.role = data.role;
        Logger.debug("WebSocket 已認證", data);
      });

      this.wsClient.on("disconnected", () => {
        this.connected = false;
        Logger.info("WebSocket 已斷線");
        this.triggerConnectionLost();
      });

      this.wsClient.on("reconnected", (data) => {
        this.connected = true;
        this.role = data.role;
        Logger.info("WebSocket 已重新連線", data);
      });
    }

    /**
     * 註冊實驗 ID（使用 SyncClient 的同步機制）
     * @param {string} experimentId - 實驗 ID
     * @param {string} source - 來源（'client', 'server', 'sync' 等）
     * @returns {Promise<boolean>}
     */
    async registerExperimentId(experimentId, source = "client") {
      try {
        Logger.debug(
          `註冊實驗 ID: ${experimentId} (來自: ${source})`
        );

        // 使用 SyncClient 的 syncState 方法來廣播實驗ID更新
        // 這樣伺服器會通過 sync_state_update 事件處理，而不是直接的 WebSocket 訊息
        if (window.syncClient && window.syncClient.syncState) {
          const updateData = {
            type: "experimentIdUpdate",
            device_id: this.getClientId(),
            experimentId: experimentId,
            source: source,
            timestamp: new Date().toISOString()
          };

          Logger.debug(
            `透過 SyncClient 廣播實驗ID更新: ${experimentId}`
          );

          const syncResult = window.syncClient.syncState(updateData);
          if (!syncResult) {
            Logger.debug(
              "本機模式或未連線，跳過同步廣播"
            );
          }
        } else {
          Logger.debug("SyncClient 不可用，無法廣播");
        }

        return true;
      } catch (error) {
        Logger.error("註冊實驗 ID 失敗:", error);
        return false;
      }
    }

    /**
     * 取得實驗 ID
     * @returns {Promise<string|null>}
     */
    async getExperimentId() {
      try {
        // 從 ExperimentStateManager 取得
        if (window.experimentStateManager) {
          return window.experimentStateManager.getExperimentId();
        }

        Logger.warn("ExperimentStateManager 不存在");
        return null;
      } catch (error) {
        Logger.error("取得實驗 ID 失敗:", error);
        return null;
      }
    }

    /**
     * 發送實驗操作（透過 WebSocket）
     * @param {string} action - 操作類型 ('start', 'pause', 'resume', 'stop')
     * @param {Object} data - 額外資料
     */
    sendExperimentAction(action, data = {}) {
      if (!this.wsClient || !this.connected) {
        Logger.warn("未連線，無法發送實驗操作");
        return false;
      }

      if (this.role !== window.SyncManager?.ROLE?.OPERATOR) {
        Logger.warn("僅操作者可以發送實驗操作");
        return false;
      }

      this.wsClient.sendExperimentAction(action, {
        ...data,
        sessionId: this.getSessionId(),
        clientId: this.getClientId()
      });

      return true;
    }

    /**
     * 檢查快速更新限制
     * @param {string} updateType - 更新類型
     * @returns {boolean} - 是否允許更新
     */
    checkFastUpdateLimit(updateType) {
      const now = Date.now();
      const key = `${this.getSessionId()}_${updateType}`;
      const lastUpdate = this.fastUpdateLimiter.get(key);

      if (!lastUpdate || now - lastUpdate > 1000) {
        this.fastUpdateLimiter.set(key, now);
        return true;
      }

      return false;
    }

    /**
     * 斷開連線
     */
    disconnect() {
      this.connected = false;
      this.role = window.SyncManager?.ROLE?.VIEWER;
    }

    // ==================== 輔助方法 ====================

    /**
     * 從 SyncClient 取得工作階段 ID
     */
    getSessionId() {
      return window.syncManager?.core?.syncClient?.getSessionId() || null;
    }

    /**
     * 從 SyncClient 取得客戶端 ID
     */
    getClientId() {
      return window.syncManager?.core?.syncClient?.getClientId() || null;
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
      return this.connected;
    }

    /**
     * 取得狀態文字
     */
    getStatusText() {
      if (!window.syncManager?.core?.syncClient) {
        return "offline";
      }

      const syncClient = window.syncManager.core.syncClient;

      if (syncClient.serverOnline === false) {
        return "offline";
      }

      if (this.connected && this.getSessionId()) {
        return this.role;
      }

      return "idle";
    }

    // ==================== 事件觸發方法 ====================

    /**
     * 觸發狀態更新事件
     */
    triggerStateUpdate(state) {
      const event = new CustomEvent("experiment_hub_state_update", {
        detail: state
      });
      window.dispatchEvent(event);
    }

    /**
     * 觸發實驗 ID 更新事件
     */
    triggerExperimentIdUpdate(data) {
      Logger.debug("觸發實驗 ID 更新事件:", data);
      const event = new CustomEvent("experiment_hub_id_update", {
        detail: data
      });
      window.dispatchEvent(event);
    }

    /**
     * 觸發實驗狀態變更事件
     */
    triggerExperimentStateChange(data) {
      const event = new CustomEvent("experiment_hub_state_change", {
        detail: data
      });
      window.dispatchEvent(event);
    }

    /**
     * 觸發連線中斷事件
     */
    triggerConnectionLost() {
      const event = new CustomEvent("experiment_hub_connection_lost");
      window.dispatchEvent(event);
    }
  }

  // UMD 模式：同時支援全域和 ES6 模組
  if (typeof window !== "undefined") {
    window.ExperimentHubClient = ExperimentHubClient;
  }
} // 閉合防止重複載入的條件

// 僅在模組環境中匯出（避免普通 script 語法錯誤）
if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentHubClient;
}





