/**
 * RealtimeCommunication - 即時通訊管理器
 * 處理Server-Sent Events、輪詢和心跳檢測
 */

class RealtimeCommunication {
  constructor(apiUrl, sessionId, clientId) {
    this.apiUrl = apiUrl;
    this.sessionId = sessionId;
    this.clientId = clientId;
    this.eventSource = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1秒

    // SSE 失敗降級和輪詢相關
    this.pollingInterval = null;
    this.pollingEnabled = false;
    this.lastKnownState = 0;
    this.messageBuffer = []; // 暫存未發送的訊息
    this.maxBufferSize = 50;
    this.lastHeartbeat = Date.now();
    this.heartbeatTimeout = 60000; // 60秒無訊息視為連線死亡
    this.heartbeatCheckInterval = null;

    // 事件處理器
    this.onMessage = null;
    this.onUpdate = null;
    this.onStateUpdate = null;
    this.onConnectionError = null;
  }

  /**
   * 開始Server-Sent Events流
   */
  startEventStream() {
    // 關鍵修復：關閉舊連線，避免連線洩漏
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // 停止輪詢（SSE已連線）
    this.stopPolling();

    const url = `${this.apiUrl}?action=stream&sessionId=${this.sessionId}&clientId=${this.clientId}&lastUpdate=${this.lastKnownState}`;
    this.eventSource = new EventSource(url);
    this.lastHeartbeat = Date.now();

    this.eventSource.onopen = () => {
      Logger.debug("SSE連線已建立");
      this.reconnectAttempts = 0;
      this.connected = true;
      this.pollingEnabled = false; // 禁用輪詢
      this.startHeartbeatCheck(); // 開始心跳檢測
      this.processMessageBuffer(); // 重新整理待發送的暫存訊息
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.lastHeartbeat = Date.now();
        if (this.onMessage) this.onMessage("message", data);
      } catch (error) {
        Logger.error("解析SSE訊息失敗:", error);
      }
    };

    this.eventSource.addEventListener("update", (event) => {
      try {
        const data = JSON.parse(event.data);
        this.lastHeartbeat = Date.now();
        if (this.onUpdate) this.onUpdate(data);
      } catch (error) {
        Logger.error("解析SSE更新失敗:", error);
      }
    });

    this.eventSource.addEventListener("state_update", (event) => {
      try {
        const data = JSON.parse(event.data);
        this.lastHeartbeat = Date.now();
        if (this.onStateUpdate) this.onStateUpdate(data);
      } catch (error) {
        Logger.error("解析狀態更新失敗:", error);
      }
    });

    this.eventSource.addEventListener("ping", (event) => {
      this.lastHeartbeat = Date.now(); // 心跳包
    });

    this.eventSource.onerror = (error) => {
      Logger.error("SSE連線錯誤:", error);
      this.handleConnectionError();
    };
  }

  /**
   * 啟動心跳檢測（檢測連線是否死亡）
   */
  startHeartbeatCheck() {
    if (this.heartbeatCheckInterval) clearInterval(this.heartbeatCheckInterval);

    this.heartbeatCheckInterval = setInterval(() => {
      if (!this.connected || !this.eventSource) return;

      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

      if (timeSinceLastHeartbeat > this.heartbeatTimeout) {
        Logger.warn(
          `SSE心跳超時 (${timeSinceLastHeartbeat}ms)，準備降級到輪詢`
        );
        this.handleConnectionError();
      }
    }, 15000); // 每15秒檢查一次
  }

  /**
   * 停止心跳檢測
   */
  stopHeartbeatCheck() {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = null;
    }
  }

  /**
   * 啟動輪詢備援機制（SSE失敗時自動降級）
   */
  startPolling() {
    if (this.pollingEnabled || this.pollingInterval) return;

    this.pollingEnabled = true;
    Logger.warn("SSE失敗，切換到輪詢模式（降級備援）");

    this.pollingInterval = setInterval(async () => {
      if (!this.sessionId || !this.pollingEnabled) {
        this.stopPolling();
        return;
      }

      try {
        const response = await this.sendRequest("poll_updates", {
          sessionId: this.sessionId,
          lastUpdate: this.lastKnownState,
          clientId: this.clientId,
        });

        if (response.success && response.updates) {
          this.lastHeartbeat = Date.now(); // 收到資料，更新心跳

          // 處理所有待發送的暫存訊息
          for (const update of response.updates) {
            this.lastKnownState = update.timestamp || Date.now();
            if (this.onUpdate) this.onUpdate(update);
          }

          // 嘗試還原SSE連線（如果失敗則繼續輪詢）
          if (response.canRestoreSSE && this.connected === false) {
            Logger.info("伺服器可還原SSE，嘗試重新連線");
            this.startEventStream();
          }
        }
      } catch (error) {
        Logger.error("輪詢更新失敗:", error);
      }
    }, 2000); // 2秒輪詢一次（比原先0.1秒更優化）
  }

  /**
   * 停止輪詢
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.pollingEnabled = false;
  }

  /**
   * 重新整理訊息暫存（連線還原時重發暫存的訊息）
   */
  async processMessageBuffer() {
    if (!this.messageBuffer || this.messageBuffer.length === 0) {
      return;
    }

    Logger.info(`處理 ${this.messageBuffer.length} 條暫存訊息`);
    const buffer = [...this.messageBuffer]; // 複製暫存
    this.messageBuffer = []; // 清空原暫存

    for (const message of buffer) {
      try {
        if (message.type === "broadcast_state") {
          if (this.onBroadcastState)
            await this.onBroadcastState(message.state, message.priority);
        } else if (message.type === "broadcast_update") {
          if (this.onBroadcastUpdate)
            await this.onBroadcastUpdate(
              message.updateType,
              message.data,
              message.priority
            );
        }
        // 重發間隔，避免伺服器過載
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        Logger.error("重發暫存訊息失敗，將重新加入暫存:", error);
        this.messageBuffer.push(message); // 重新加入暫存
      }
    }

    if (this.messageBuffer.length > 0) {
      Logger.warn(`仍有 ${this.messageBuffer.length} 條未發送的暫存訊息`);
    }
  }

  /**
   * 處理連線錯誤
   */
  handleConnectionError() {
    this.connected = false;
    this.stopHeartbeatCheck(); // 停止舊的心跳檢測

    this.reconnectAttempts++;
    // 指數退避，但最大延遲限制為 30 秒
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    Logger.warn(
      `SSE連線斷開，${delay}ms後重連 (第${this.reconnectAttempts}次)`
    );

    // 立即啟動輪詢備援（不等待重連延遲）
    this.startPolling();

    setTimeout(() => {
      if (this.sessionId) {
        this.startEventStream();
      }
    }, delay);

    if (this.onConnectionError) this.onConnectionError();
  }

  /**
   * 斷開連線
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
    this.reconnectAttempts = 0;
    this.stopPolling();
    this.stopHeartbeatCheck();
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
   * 加入訊息到暫存
   */
  addToBuffer(message) {
    this.messageBuffer.push(message);
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer.shift(); // 清除最舊的訊息
    }
  }

  /**
   * 取得連線狀態
   */
  isConnected() {
    return this.connected;
  }
}

// 匯出
export default RealtimeCommunication;
