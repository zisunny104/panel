/**
 * ExperimentHub Client - 專注於實驗相關的同步客戶端
 * 處理實驗狀態、ID等實驗特定同步功能
 * 工作階段連線由 SyncClient 負責
 */

import { SyncEvents } from "./sync-events-constants.js";

class ExperimentHubClient {
  constructor() {
    this.apiUrl = "./php/experiment-hub.php";
    this.role = null;
    this.connected = false;
    this.serverOnline = null;
    this.eventSource = null; // SSE 連線
    this.syncClientReady = false; // 追蹤 SyncClient 準備狀態
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.listenersSetup = false; // 防止重複設置監聽器

    // 快速更新限制器
    this.fastUpdateLimiter = new Map();

    // 設置事件監聽器，等待SyncClient準備完成
    // 注意：不在構造函數中調用initializeConnection()，等待setupSyncClientListener中的觸發
    this.setupSyncClientListener();
  }

  /**
   * 檢查 Session 是否已準備完成
   */
  checkSessionReady() {
    const sessionId = this.getSessionId();
    const clientId = this.getClientId();
    const isReady = !!(sessionId && clientId);
    if (isReady) {
      Logger.debug("[ExperimentHubClient] Session 檢查通過", {
        sessionId: sessionId?.substring(0, 8) + "...",
        clientId: clientId?.substring(0, 8) + "...",
      });
    }
    return isReady;
  }

  /**
   * 設置 SyncClient 準備完成事件監聽 (只執行一次)
   */
  setupSyncClientListener() {
    // 防止重複設置監聽器
    if (this.listenersSetup) {
      Logger.debug("[ExperimentHubClient] 監聽器已設置，跳過重複設置");
      return;
    }
    this.listenersSetup = true;

    // 事件處理器
    const onSessionAvailable = () => {
      Logger.debug("[ExperimentHubClient] 偵測到工作階段可用");
      this.syncClientReady = true;
      this.reconnectAttempts = 0; // 重置重試計數
      this.connectToStream();
    };

    // 立即檢查一次（以防事件已在綁定前發出）
    if (this.checkSessionReady()) {
      Logger.debug("[ExperimentHubClient] Session 已就緒，立即連接");
      setTimeout(() => onSessionAvailable(), 0);
    }

    // 監聽 SyncClient 初始化完成事件
    window.addEventListener(SyncEvents.CLIENT_INITIALIZED, onSessionAvailable);

    // 監聽工作階段還原完成事件
    window.addEventListener(SyncEvents.SESSION_RESTORED, onSessionAvailable);

    // 監聽工作階段建立事件
    window.addEventListener(SyncEvents.SESSION_CREATED, onSessionAvailable);

    // 監聽工作階段加入事件
    window.addEventListener(SyncEvents.SESSION_JOINED, onSessionAvailable);

    // 監聽伺服器狀態變化 - 伺服器恢復時檢查是否需要重連
    window.addEventListener(SyncEvents.SERVER_STATUS_CHANGED, (event) => {
      const isOnline =
        event.detail?.isOnline || event.detail?.status === "online";
      if (isOnline && !this.connected) {
        Logger.debug("[ExperimentHubClient] 伺服器恢復連線，檢查SSE連接");
        this.initializeConnection();
      }
    });
  }

  /**
   * 初始化連線 - 只在sessionId/clientId都可用時才連接
   */
  initializeConnection() {
    const sessionId = this.getSessionId();
    const clientId = this.getClientId();

    // 先檢查是否已經有session信息
    if (sessionId && clientId) {
      this.syncClientReady = true;
      this.reconnectAttempts = 0;
      Logger.debug(
        `[ExperimentHubClient] 已獲得sessionId: ${sessionId.substring(0, 8)}...`
      );
      this.connectToStream();
      return;
    }

    // 如果沒有sessionId，繼續等待
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      Logger.debug(
        `[ExperimentHubClient] ⏳ 等待sessionId/clientId準備完成 (嘗試 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );
      setTimeout(() => {
        this.initializeConnection();
      }, 500);
    } else {
      Logger.debug(
        "[ExperimentHubClient] 超過重試次數限制，SSE連接將在檢測到session後自動建立"
      );
    }
  }

  /**
   * 連接到SSE流以接收即時更新
   */
  connectToStream() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const sessionId = this.getSessionId();
    const clientId = this.getClientId();

    if (!sessionId || !clientId) {
      Logger.debug(
        `[ExperimentHubClient] ⏳ sessionId/clientId 尚未準備 (sessionId: ${
          sessionId ? "✓" : "✗"
        }, clientId: ${clientId ? "✓" : "✗"})`
      );
      return;
    }

    // 重置重試計數器
    this.reconnectAttempts = 0;

    const streamUrl = `${
      this.apiUrl
    }?action=stream&sessionId=${encodeURIComponent(
      sessionId
    )}&clientId=${encodeURIComponent(clientId)}`;

    Logger.debug(`[ExperimentHubClient] 正在連接到SSE流...`);

    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onopen = (event) => {
      Logger.info("[ExperimentHubClient] SSE流連線已建立");
      this.connected = true;
      this.reconnectAttempts = 0; // 連接成功，重置計數器
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        Logger.debug("[ExperimentHubClient] 📨 收到SSE訊息:", data);
        this.handleUpdateEvent(data);
      } catch (error) {
        Logger.error(
          "[ExperimentHubClient] 解析SSE訊息失敗:",
          error,
          event.data
        );
      }
    };

    this.eventSource.onerror = (event) => {
      Logger.error("[ExperimentHubClient] SSE流連線錯誤");
      this.connected = false;
      this.triggerConnectionLost();

      // 嘗試自動重新連接（改進：無限重試，增加延遲上限至60秒）
      this.reconnectAttempts++;
      // 前3次快速重試，之後才逐漸增加延遲
      let waitTime;
      if (this.reconnectAttempts <= 3) {
        waitTime = 300 * this.reconnectAttempts; // 300ms, 600ms, 900ms
      } else {
        // 之後每次增加 500ms，但上限 60 秒
        waitTime = Math.min(900 + 500 * (this.reconnectAttempts - 3), 60000);
      }
      Logger.debug(
        `[ExperimentHubClient] 將在 ${waitTime}ms 後重新嘗試連接 (嘗試 ${this.reconnectAttempts})`
      );
      this.reconnectTimer = setTimeout(() => {
        this.connectToStream();
      }, waitTime);
    };

    // 處理特定事件類型
    this.eventSource.addEventListener("update", (event) => {
      try {
        const data = JSON.parse(event.data);
        Logger.debug("[ExperimentHubClient] 📡 收到update事件:", data);
        this.handleUpdateEvent(data);
      } catch (error) {
        Logger.error("[ExperimentHubClient] 解析update事件失敗:", error);
      }
    });
  }

  /**
   * 斷開SSE流連線
   */
  disconnectFromStream() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      Logger.debug("[ExperimentHubClient] 斷開SSE流連線");
      this.eventSource.close();
      this.eventSource = null;
      this.connected = false;
    }
  }

  /**
   * 重新連接到SSE流
   */
  reconnectToStream() {
    Logger.debug("[ExperimentHubClient] 重新連接到SSE流");
    this.disconnectFromStream();
    this.connectToStream();
  }

  /**
   * 主動觸發連接（當session變得可用時）
   */
  tryConnect() {
    Logger.debug("[ExperimentHubClient] 📞 手動觸發連接嘗試");
    this.reconnectAttempts = 0;
    this.syncClientReady = true;
    this.connectToStream();
  }

  /**
   * 從 SyncClient 取得工作階段ID
   */
  getSessionId() {
    return window.syncManager?.core?.syncClient?.sessionId || null;
  }

  /**
   * 從 SyncClient 取得客戶端ID
   */
  getClientId() {
    return window.syncManager?.core?.syncClient?.clientId || null;
  }

  /**
   * 處理來自伺服器的SSE事件
   */
  handleServerEvent(eventType, data) {
    switch (eventType) {
      case "state_update":
        if (data.state) {
          this.triggerStateUpdate(data.state);
        }
        break;

      case "update":
        this.handleUpdateEvent(data);
        break;

      case "message":
        Logger.debug("收到伺服器訊息:", data);
        break;
    }
  }

  /**
   * 處理更新事件
   */
  handleUpdateEvent(updateData) {
    const { type, data, timestamp, priority } = updateData;

    // 檢查是否是自己的更新（避免回音）
    if (data.deviceId === this.getClientId()) {
      return;
    }

    switch (type) {
      case "experiment_id_update":
        Logger.debug(`[ExperimentHubClient] 📨 收到實驗ID更新:`, data);
        this.triggerExperimentIdUpdate(data);
        break;

      case "state_sync":
        if (data.state) {
          this.triggerStateUpdate(data.state);
        }
        break;

      case "experiment_state_change":
        this.triggerExperimentStateChange(data);
        break;

      default:
        Logger.debug("收到未知更新類型:", type, data);
    }
  }

  /**
   * 檢查快速更新限制
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
   * 斷開連線（由 SyncClient 負責處理）
   */
  disconnect() {
    this.connected = false;
    this.role = null;
  }

  /**
   * 檢查伺服器健康狀態
   */
  async checkServerHealth() {
    try {
      const response = await fetch(`${this.apiUrl}?action=health_check`);
      this.serverOnline = response.ok;
      return this.serverOnline;
    } catch (error) {
      this.serverOnline = false;
      return false;
    }
  }

  /**
   * 發送API請求
   */
  async sendRequest(action, params = {}) {
    const queryString = new URLSearchParams({
      action,
      ...params,
    }).toString();

    const response = await fetch(`${this.apiUrl}?${queryString}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await response.text();
      Logger.error("伺服器回傳非JSON回應:", text.substring(0, 200));
      throw new Error("伺服器回傳無效的回應格式");
    }

    return await response.json();
  }

  /**
   * 註冊實驗ID到中樞
   */
  async registerExperimentId(experimentId, source = "client") {
    try {
      Logger.debug(
        `[ExperimentHubClient] 📝 正在註冊實驗ID到中樞: ${experimentId} (來自: ${source})`
      );
      const response = await this.sendRequest("register_experiment_id", {
        experiment_id: experimentId,
        source,
      });

      if (response.success) {
        Logger.debug(
          `[ExperimentHubClient] 實驗ID已成功註冊到中樞: ${experimentId}`
        );
      } else {
        Logger.warn(
          `[ExperimentHubClient] 實驗ID註冊失敗 (伺服器回應失敗): ${experimentId}`
        );
      }

      return response.success;
    } catch (error) {
      Logger.error(
        `[ExperimentHubClient] 註冊實驗ID失敗: ${error.message}`,
        error
      );
      return false;
    }
  }

  /**
   * 從中樞取得實驗ID
   */
  async getExperimentId() {
    try {
      const response = await this.sendRequest("get_experiment_id");
      return response.success ? response.experiment_id : null;
    } catch (error) {
      Logger.error("取得實驗ID失敗:", error);
      return null;
    }
  }

  // 事件觸發方法
  triggerStateUpdate(state) {
    const event = new CustomEvent("experiment_hub_state_update", {
      detail: state,
    });
    window.dispatchEvent(event);
  }

  triggerExperimentIdUpdate(data) {
    Logger.debug(`[ExperimentHubClient] 📡 觸發實驗ID更新事件:`, data);
    const event = new CustomEvent("experiment_hub_id_update", {
      detail: data,
    });
    window.dispatchEvent(event);
    Logger.debug(`[ExperimentHubClient] 已發送 experiment_hub_id_update 事件`);
  }

  triggerExperimentStateChange(data) {
    const event = new CustomEvent("experiment_hub_state_change", {
      detail: data,
    });
    window.dispatchEvent(event);
  }

  triggerConnectionLost() {
    const event = new CustomEvent("experiment_hub_connection_lost");
    window.dispatchEvent(event);
  }

  getRole() {
    return this.role;
  }

  canOperate() {
    return this.connected && this.role === "operator";
  }

  isConnected() {
    return this.connected;
  }

  getStatusText() {
    if (this.serverOnline === false) {
      return "offline";
    }
    if (this.connected && this.getSessionId()) {
      return this.role;
    }
    return "idle";
  }
}

// 匯出
export default ExperimentHubClient;
