/**
 * SyncClient - 同步客戶端
 * 僅負責與PHP API通訊，不包含UI邏輯
 */
class SyncClient {
  constructor() {
    this.apiUrl = "./php/sync-api.php";
    this.sessionId = null;
    this.clientId = this.loadClientId(); // 從本機儲存載入裝置ID
    this.deviceToken = null; // 裝置驗證簽章
    this.role = null; // 'viewer' 或 'operator'
    this.lastUpdate = 0;
    this.pollInterval = 2000; // 2秒輪詢一次（從1秒調整為2秒以提升效能）
    this.minPollInterval = 2000; // 最小輪詢間隔（活躍時）
    this.maxPollInterval = 10000; // 最大輪詢間隔（閒置時）
    this.pollTimer = null;
    this.lastActivityTime = Date.now(); // 最後活動時間
    this.activityTimeout = 30000; // 30秒無活動視為閒置
    this.connected = false;
    this.serverOnline = null; // null=未檢查, true=線上, false=離線
    this.previousServerOnline = null; // 追蹤前一個狀態，用於偵測變化
    this.healthCheckInterval = 5000; // 5秒檢查一次伺服器（從3秒調整為5秒以提升效能）
    this.healthCheckTimer = null;
    this.pollFailureCount = 0; // 輪詢連續失敗計數
    this.maxPollFailures = 5; // 最大連續失敗次數，超過則停止輪詢
  }

  /**
   * 從本機儲存載入裝置ID
   * 如果不存在，產生一個新的
   */
  loadClientId() {
    const storedClientId = localStorage.getItem("sync_client_id");
    if (storedClientId) {
      return storedClientId;
    }

    // 產生新的裝置ID（基於時間戳 + 隨機數）
    const newClientId = this.generateClientId();
    this.saveClientId(newClientId);
  }

  /**
   * 產生唯一的裝置ID
   */
  generateClientId() {
    const timestamp = Date.now().toString(36); // 時間戳轉36進制
    const random = Math.random().toString(36).substring(2, 8); // 6位隨機字符
    return `D${timestamp}-${random}`.toUpperCase();
  }

  /**
   * 儲存裝置ID到本機儲存
   */
  saveClientId(clientId) {
    localStorage.setItem("sync_client_id", clientId);
  }

  /**
   * 清除本機儲存的裝置ID（主動斷線時調用）
   */
  clearClientId() {
    localStorage.removeItem("sync_client_id");
    this.clientId = null;
  }

  /**
   * 從本機儲存載入工作階段ID
   */
  loadSessionId() {
    const sessionId = localStorage.getItem("sync_session_id");
    Logger.debug("[SyncClient] 載入工作階段ID:", sessionId || "無");
    return sessionId || null;
  }

  /**
   * 儲存工作階段ID到本機儲存
   */
  saveSessionId(sessionId) {
    if (sessionId) {
      localStorage.setItem("sync_session_id", sessionId);
      Logger.debug("[SyncClient] 已儲存工作階段ID到 localStorage:", sessionId);
    } else {
      localStorage.removeItem("sync_session_id");
      Logger.debug("[SyncClient] 已清除 localStorage 中的工作階段ID");
    }
  }

  /**
   * 從本機儲存載入角色
   */
  loadRole() {
    const role = localStorage.getItem("sync_role");
    Logger.debug("[SyncClient] 載入角色:", role || "無");
    return role || null;
  }

  /**
   * 儲存角色到本機儲存
   */
  saveRole(role) {
    if (role) {
      localStorage.setItem("sync_role", role);
      Logger.debug("[SyncClient] 已儲存角色到 localStorage:", role);
    } else {
      localStorage.removeItem("sync_role");
      Logger.debug("[SyncClient] 已清除 localStorage 中的角色");
    }
  }

  /**
   * 建立新的同步工作階段（需要建立代碼）
   */
  async createSession(createCode) {
    try {
      // 先檢查伺服器是否線上
      await this.checkServerHealth();
      if (!this.serverOnline) {
        throw new Error("伺服器離線，無法建立工作階段");
      }

      const response = await this.sendRequest("create_session", { createCode });
      if (response.success) {
        this.sessionId = response.data.sessionId;
        this.saveSessionId(this.sessionId);
        this.connected = true;
        this.role = "operator"; // 建立者預設為操作者
        this.startPolling();
        this.startHealthCheck();

        // 回傳包含 sessionId 和 shareCode 的物件
        return {
          sessionId: response.data.sessionId,
          shareCode: response.data.shareCode, // 新增：回傳分享代碼
        };
      }
      throw new Error(response.message);
    } catch (error) {
      // 此錯誤是正常情況（無痕視窗、首次存取、工作階段過期），不顯示錯誤
      throw error;
    }
  }

  /**
   * 加入現有工作階段（支援角色選擇）
   */

  /**
   * 通過分享代碼加入工作階段（一次性使用）
   */
  async joinSessionByShareCode(shareCode, role = "viewer") {
    try {
      // 先檢查伺服器是否線上
      await this.checkServerHealth();
      if (!this.serverOnline) {
        throw new Error("伺服器離線，無法加入工作階段");
      }

      const response = await this.sendRequest("join_by_share_code", {
        shareCode,
        role,
        clientId: this.clientId, // 新增：傳送本機裝置ID給伺服器
      });
      if (response.success) {
        this.sessionId = response.data.sessionId;
        this.saveSessionId(this.sessionId);
        // 如果伺服器回傳的 clientId 與本機不同，表示是新客戶端
        if (
          response.data.clientId &&
          response.data.clientId !== this.clientId
        ) {
          this.clientId = response.data.clientId;
          this.saveClientId(this.clientId); // 儲存新的 clientId
        }
        this.deviceToken = response.data.deviceToken; // 新增：儲存裝置簽章
        this.role = response.data.role;
        this.saveRole(this.role); // 新增：儲存角色
        this.connected = true;
        this.startPolling();
        this.startHealthCheck();

        // 如果有初始狀態，立即觸發更新事件
        if (response.data.state) {
          this.triggerStateUpdate(response.data.state);
        }

        return true;
      }
      throw new Error(response.message);
    } catch (error) {
      Logger.error("通過分享代碼加入工作階段失敗:", error);
      throw error;
    }
  }

  /**
   * 取得分享代碼資訊（用於顯示剩餘有效時間）
   */
  async getShareCodeInfo(shareCode) {
    try {
      const response = await this.sendRequest("get_share_code_info", {
        shareCode,
      });
      if (response.success) {
        return response.data;
      }
      throw new Error(response.message);
    } catch (error) {
      Logger.error("取得分享代碼資訊失敗:", error);
      throw error;
    }
  }

  /**
   * 取得工作階段中的所有客戶端資訊
   * 用於恢復連線時了解工作階段的完整狀態
   */
  async getSessionClients(sessionId) {
    try {
      const response = await this.sendRequest("get_session_clients", {
        sessionId,
      });
      if (response.success) {
        return response.data;
      }
      throw new Error(response.message);
    } catch (error) {
      Logger.error("取得工作階段客戶端資訊失敗:", error);
      throw error;
    }
  }

  /**
   * 還原工作階段連線（用於同一裝置短期內重新連線）
   * 驗證 sessionId 和 clientId，允許客戶端還原之前的連線
   */
  async restoreSession(sessionId, clientId, role = "viewer") {
    try {
      // 先檢查伺服器是否線上
      await this.checkServerHealth();
      if (!this.serverOnline) {
        throw new Error("伺服器離線，無法還原工作階段");
      }

      const response = await this.sendRequest("restore_session", {
        sessionId,
        clientId,
        role,
      });
      if (response.success) {
        this.sessionId = response.data.sessionId;
        this.saveSessionId(this.sessionId);
        this.clientId = response.data.clientId;
        this.deviceToken = response.data.deviceToken; // 新增：還原裝置簽章
        this.shareCode = response.data.shareCode; // 新增：還原分享代碼
        this.role = response.data.role;
        this.saveRole(this.role); // 新增：還原並儲存角色
        this.connected = true;
        this.startPolling();
        this.startHealthCheck();

        // 如果有初始狀態，立即觸發更新事件
        if (response.data.state) {
          this.triggerStateUpdate(response.data.state);
        }

        // 回傳完整的還原資訊（包括 shareCode）
        return response.data;
      }
      throw new Error(response.message);
    } catch (error) {
      // 此錯誤是正常情況（無痕視窗、首次存取、工作階段過期），不顯示錯誤
      throw error;
    }
  }

  /**
   * 同步狀態更新（只有operator角色可以發送）
   */
  async syncState(state) {
    if (!this.connected || !this.sessionId) {
      Logger.warn("未連線到工作階段，無法同步狀態");
      return false;
    }

    if (this.role !== "operator") {
      Logger.warn("僅檢視模式無法發送狀態更新");
      return false;
    }

    try {
      const response = await this.sendRequest("sync_state", {
        sessionId: this.sessionId,
        state: JSON.stringify(state),
      });
      return response.success;
    } catch (error) {
      Logger.error("狀態同步失敗:", error);
      return false;
    }
  }

  /**
   * 開始狀態輪詢
   */
  startPolling() {
    if (this.pollTimer) return;

    const poll = async () => {
      if (!this.connected || !this.sessionId) {
        this.stopPolling();
        return;
      }

      try {
        const response = await this.sendRequest("get_state", {
          sessionId: this.sessionId,
          lastUpdate: this.lastUpdate,
        });

        if (response.success && response.data) {
          this.lastUpdate = response.data.lastUpdate;
          if (response.data.state) {
            this.triggerStateUpdate(response.data.state);
            // 有狀態更新，重置為活躍間隔
            this.lastActivityTime = Date.now();
            this.adjustPollInterval(true);
          } else {
            // 無狀態更新，檢查是否需要增加間隔
            this.adjustPollInterval(false);
          }
          // 重置失敗計數
          this.pollFailureCount = 0;
        } else {
          // 無新資料，調整間隔
          this.adjustPollInterval(false);
        }
      } catch (error) {
        Logger.error("輪詢錯誤:", error);

        // 檢查是否為工作階段不存在的錯誤
        const isSessionNotFound =
          error.message &&
          (error.message.includes("工作階段不存在") ||
            error.message.includes("not found") ||
            error.message.includes("已過期"));

        // 檢查是否為網路/伺服器連線錯誤
        const isNetworkError =
          error.message &&
          (error.message.includes("fetch") ||
            error.message.includes("network") ||
            error.message.includes("HTTP error") ||
            error.message.includes("伺服器回傳無效的回應格式") ||
            !this.serverOnline); // 如果伺服器已知離線

        if (isSessionNotFound) {
          Logger.warn("工作階段已失效，立即斷開連線:", this.sessionId);
          this.disconnect();
          return;
        }

        if (isNetworkError) {
          Logger.warn("網路連線問題，增加失敗計數:", error.message);
          this.pollFailureCount++;
        } else {
          // 其他未知錯誤，也增加失敗計數
          Logger.warn("未知輪詢錯誤，增加失敗計數:", error.message);
          this.pollFailureCount++;
        }

        // 如果連續失敗次數過多，停止輪詢並等待健康檢查還原
        if (this.pollFailureCount >= this.maxPollFailures) {
          Logger.warn(
            `輪詢連續失敗 ${this.pollFailureCount} 次，停止輪詢等待還原`
          );
          this.stopPolling();
          return;
        }
      }
    };

    // 立即執行一次，然後開始定時輪詢
    poll();
    this.pollTimer = setInterval(poll, this.pollInterval);
  }

  /**
   * 動態調整輪詢間隔
   * @param {boolean} hasActivity - 是否有活動
   */
  adjustPollInterval(hasActivity) {
    if (hasActivity) {
      // 有活動時使用最小間隔
      if (this.pollInterval !== this.minPollInterval) {
        this.pollInterval = this.minPollInterval;
        this.restartPolling();
      }
    } else {
      // 無活動時逐漸增加間隔
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      if (timeSinceActivity > this.activityTimeout) {
        // 超過閒置時間，增加間隔
        const newInterval = Math.min(
          this.pollInterval * 1.5,
          this.maxPollInterval
        );
        if (newInterval !== this.pollInterval) {
          this.pollInterval = newInterval;
          this.restartPolling();
        }
      }
    }
  }

  /**
   * 重啟輪詢以套用新的間隔
   */
  restartPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.startPolling();
    }
  }

  /**
   * 停止狀態輪詢
   */
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 觸發狀態更新事件
   */
  triggerStateUpdate(state) {
    try {
      const parsedState = typeof state === "string" ? JSON.parse(state) : state;
      const event = new CustomEvent("sync_state_update", {
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
    this.stopPolling();
    this.stopHealthCheck();
    this.connected = false;
    this.sessionId = null;
    this.role = null;
    this.lastUpdate = 0;
    this.pollFailureCount = 0; // 重置失敗計數
    // 新增：清除持久化的工作階段資訊
    this.saveSessionId(null);
    this.saveRole(null);
  }

  /**
   * 啟動伺服器健康檢查
   */
  startHealthCheck() {
    if (this.healthCheckTimer) return;

    // 立即檢查一次
    this.checkServerHealth();

    this.healthCheckTimer = setInterval(() => {
      this.checkServerHealth();
    }, this.healthCheckInterval);
  }

  /**
   * 停止伺服器健康檢查
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * 檢查伺服器是否線上
   */
  async checkServerHealth() {
    try {
      const response = await fetch(`${this.apiUrl}?action=health_check`);
      const newOnlineStatus = response.ok;

      // 如果狀態變化，觸發事件並通知 UI
      if (this.serverOnline !== newOnlineStatus) {
        this.previousServerOnline = this.serverOnline;
        this.serverOnline = newOnlineStatus;

        // 如果從離線還原到線上，且仍然連線中，重新啟動輪詢
        if (newOnlineStatus && this.connected && !this.pollTimer) {
          Logger.debug("伺服器恢復連線，重新啟動輪詢");
          this.pollFailureCount = 0; // 重置失敗計數
          this.startPolling();
        }

        // 觸發伺服器狀態變化事件
        window.dispatchEvent(
          new CustomEvent("sync_server_status_changed", {
            detail: {
              online: this.serverOnline,
              previousOnline: this.previousServerOnline,
              timestamp: new Date().toISOString(),
            },
          })
        );

        // console.log(
        //   `伺服器狀態變化: ${this.previousServerOnline} → ${this.serverOnline}`
        // );
      } else {
        this.serverOnline = newOnlineStatus;
      }

      if (!this.serverOnline && this.connected) {
        Logger.warn("伺服器離線，自動斷開連線");
        this.disconnect();
      }

      return this.serverOnline;
    } catch (error) {
      const wasOnline = this.serverOnline;
      this.serverOnline = false;

      // 如果從線上變成離線，觸發事件
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
          })
        );
        Logger.warn(`伺服器狀態變化: ${wasOnline} → 離線 (${error.message})`);
      }

      if (this.connected) {
        this.disconnect();
      }

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

    try {
      const response = await fetch(`${this.apiUrl}?${queryString}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        Logger.error("伺服器回傳非 JSON 回應:", text.substring(0, 200));
        throw new Error("伺服器回傳無效的回應格式（可能是伺服器錯誤）");
      }

      return await response.json();
    } catch (error) {
      Logger.error("API 請求失敗:", error.message);
      throw error;
    }
  }

  /**
   * 查詢客戶端是否有掛載中的工作階段
   */
  async queryClientSession(clientId) {
    return await this.sendRequest("query_client_session", { clientId });
  }

  /**
   * 取得目前工作階段ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * 取得目前角色
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
    return this.connected;
  }

  /**
   * 取得目前狀態描述
   * 區分四種狀態：
   * - offline: 伺服器離線
   * - idle: 伺服器線上但未加入工作階段
   * - viewer: 已加入工作階段（檢視者）
   * - operator: 已加入工作階段（操作者）
   */
  getStatusText() {
    // 伺服器離線
    if (this.serverOnline === false) {
      return "offline";
    }

    // 已連線到工作階段
    if (this.connected && this.sessionId) {
      return this.role; // 'viewer' 或 'operator'
    }

    // 伺服器線上但未連線
    return "idle";
  }

  /**
   * 重新產生分享代碼
   */
  async regenerateShareCode() {
    if (!this.connected || !this.sessionId) {
      throw new Error("未連線到工作階段");
    }

    if (this.role !== "operator") {
      throw new Error("僅操作者可以重新產生分享代碼");
    }

    try {
      const response = await this.sendRequest("regenerate_share_code", {
        sessionId: this.sessionId,
        clientId: this.clientId,
      });
      if (response.success && response.data) {
        return {
          shareCode: response.data.shareCode,
          sessionId: response.data.sessionId,
        };
      }
      throw new Error(response.message || "重新產生分享代碼失敗");
    } catch (error) {
      Logger.error("重新產生分享代碼錯誤:", error);
      throw error;
    }
  }
}

// 匯出
export default SyncClient;
