/**
 * SyncManager Core - 核心邏輯
 * 負責初始化、URL偵測、狀態管理、與sync-client通訊
 * 使用時間同步確保多裝置間的時序一致性
 */
import SyncClient from "./sync-client.js";
import TimeSyncManager from "../core/time-sync-manager.js";

export class SyncManagerCore {
  constructor() {
    this.syncClient = new SyncClient();
    this.currentRole = "viewer"; // 預設為僅檢視
    this.timeSyncManager = window.timeSyncManager || new TimeSyncManager();

    // 自動偵測目前URL - 支援任何部署環境
    this.baseUrl = this.getBaseUrl();

    // 離線隊列 - 儲存離線時的狀態更新
    this.offlineQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * 取得基礎URL - 自動適應部署環境
   */
  getBaseUrl() {
    const protocol = window.location.protocol; // http: 或 https:
    const host = window.location.host; // hostname:port
    let pathname = window.location.pathname; // /path/to/file.html 或 /

    // 確保 pathname 以 / 結尾
    if (!pathname.endsWith("/")) {
      // 如果 pathname 包含檔名，移除檔名
      pathname = pathname.substring(0, pathname.lastIndexOf("/") + 1);
    }

    // 確保最後以 / 結尾
    if (!pathname.endsWith("/")) {
      pathname += "/";
    }

    // 組合完整基礎URL
    const baseUrl = `${protocol}//${host}${pathname}`;
    return baseUrl;
  }

  /**
   * 產生包含完整URL的 QR code 內容
   * @param {string} code - 可以是 sessionId 或 shareCode
   * @param {string} role - 'viewer' 或 'operator'
   */
  generateQRContent(code, role = "viewer") {
    // 確保 baseUrl 以 / 結尾
    let url = this.baseUrl;
    if (!url.endsWith("/")) {
      url += "/";
    }

    // 生成完整URL（自動包含 index.html）
    // 確保分享代碼正確進行 URL 編碼
    const encodedCode = encodeURIComponent(code);
    const qrUrl = `${url}index.html?shareCode=${encodedCode}&role=${encodeURIComponent(
      role
    )}`;
    Logger.debug("產生的 QR URL:", qrUrl);
    return qrUrl;
  }

  /**
   * 處理建立工作階段
   */
  async createSession(createCode) {
    Logger.debug("[Sync] 開始建立工作階段", { createCode });

    try {
      const result = await this.syncClient.createSession(createCode);
      Logger.debug("[Sync] 工作階段建立成功", {
        sessionId: result.sessionId,
        shareCode: result.shareCode,
      });

      this.currentRole = "operator"; // 建立者預設為操作者

      // result 是一個包含 sessionId 和 shareCode 的物件
      this.currentSessionId = result.sessionId;
      this.currentShareCode = result.shareCode;

      // 連線成功後，處理離線隊列
      setTimeout(() => this.processOfflineQueue(), 1000);

      return result; // 回傳完整物件給調用者
    } catch (error) {
      Logger.error("[Sync] 工作階段建立失敗", error);
      throw error;
    }
  }

  /**
   * 通過分享代碼加入工作階段
   */
  async joinSessionByShareCode(shareCode, role = "viewer") {
    try {
      await this.syncClient.joinSessionByShareCode(shareCode, role);
      this.currentRole = role;
      this.currentShareCode = shareCode; // 記錄使用過的分享代碼

      Logger.debug(
        `[SyncCore] 成功加入工作階段 - 代碼: ${shareCode}, 角色: ${role}, 工作階段ID: ${this.syncClient.sessionId}`
      );

      // 連線成功後，處理離線隊列
      setTimeout(() => this.processOfflineQueue(), 1000);

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 還原工作階段連線（同一裝置短期內）
   */
  async restoreSession(sessionId, clientId, role = "viewer") {
    try {
      const result = await this.syncClient.restoreSession(
        sessionId,
        clientId,
        role
      );
      this.currentRole = role;
      // 新增：取得還原的分享代碼
      if (result && result.shareCode) {
        this.currentShareCode = result.shareCode;
      }

      // 觸發工作階段還原事件
      window.dispatchEvent(
        new CustomEvent("sync_session_restored", {
          detail: {
            sessionId: sessionId,
            clientId: clientId,
            role: role,
            shareCode: result?.shareCode,
          },
        })
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 取得分享代碼資訊
   */
  async getShareCodeInfo(shareCode) {
    try {
      return await this.syncClient.getShareCodeInfo(shareCode);
    } catch (error) {
      throw error;
    }
  }

  /**
   * 取得目前連線狀態文本
   * 區分四種狀態：
   * - offline: PHP伺服器無法連線
   * - idle: PHP伺服器正常，但未加入多螢幕同步
   * - viewer: 已加入工作階段（檢視者）
   * - operator: 已加入工作階段（操作者）
   */
  getStatusText() {
    return this.syncClient.getStatusText();
  }

  /**
   * 檢查是否已連線
   */
  isConnected() {
    return this.syncClient.isConnected();
  }

  /**
   * 取得目前工作階段ID
   */
  getSessionId() {
    return this.syncClient.getSessionId();
  }

  /**
   * 取得目前角色
   */
  getRole() {
    return this.syncClient.getRole();
  }

  /**
   * 中斷連線
   */
  disconnect() {
    this.syncClient.disconnect();
    // 如果是主動中斷（非自動），清空session備份
    // 注意：自動中斷時不清空，以便還原
  }

  /**
   * 清空Session備份（主動中斷連線時呼叫）
   */
  clearSessionBackup() {
    if (window.syncManager?.ui) {
      window.syncManager.ui.clearSessionBackup();
    }
  }

  /**
   * 同步狀態
   * 如果離線，會加入隊列等待連線還原後發送
   * 優化：去重檢查確保不發送完全相同的狀態
   */
  async syncState(state) {
    // 去重：檢查隊列中是否已有相同的狀態
    const isDuplicate = this._isDuplicateState(state);
    if (isDuplicate) {
      Logger.debug(`跳過重複的狀態更新 (type=${state.type})`);
      return false;
    }

    // 如果未連線到工作階段，將狀態加入離線隊列
    if (!this.syncClient.isConnected()) {
      this.addToOfflineQueue(state);
      return false;
    }

    // 如果已連線但角色不是操作者，才顯示警告
    if (!this.syncClient.canOperate()) {
      Logger.warn("目前模式無法發送狀態更新（非操作者角色）");
      return false;
    }

    try {
      const result = await this.syncClient.syncState(state);
      // 成功發送後，嘗試處理離線隊列
      if (result) {
        this.processOfflineQueue();
      }
      return result;
    } catch (error) {
      Logger.warn("同步狀態失敗，加入離線隊列:", error);
      this.addToOfflineQueue(state);
      return false;
    }
  }

  /**
   * 檢查是否為重複的狀態更新
   * @private
   */
  _isDuplicateState(newState) {
    // 對於某些狀態類型進行更嚴格的去重
    const strictDeduplicationTypes = [
      "experiment_started",
      "experiment_stopped",
      "experiment_paused",
      "experiment_resumed",
    ];

    if (!strictDeduplicationTypes.includes(newState.type)) {
      return false;
    }

    // 檢查隊列中是否已有相同類型且相同裝置的狀態
    const lastSimilar = this.offlineQueue.find(
      (item) =>
        item.state.type === newState.type &&
        item.state.device_id === newState.device_id
    );

    if (lastSimilar) {
      // 如果時間戳相差不到 1 秒，認為是重複
      const timeDiff = Math.abs(
        (newState.timestamp || Date.now()) -
          (lastSimilar.state.timestamp || lastSimilar.addedAt)
      );
      return timeDiff < 1000;
    }

    return false;
  }

  /**
   * 檢查連線狀態（定期檢查用）
   */
  async checkConnection() {
    await this.syncClient.checkServerHealth();
  }

  /**
   * 將狀態加入離線隊列
   */
  addToOfflineQueue(state) {
    // 確保狀態有時間戳（使用同步的伺服器時間）
    if (!state.timestamp) {
      // 優先使用同步的伺服器時間，如果未初始化則使用本地時間
      state.timestamp = this.timeSyncManager.isSynchronized()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
    }

    // 去重：相同類型且相同設備ID的更新，保留最新的
    const duplicateIndex = this.offlineQueue.findIndex(
      (item) =>
        item.state.type === state.type &&
        item.state.device_id === state.device_id
    );

    if (duplicateIndex !== -1) {
      // 如果新狀態時間戳更新，替換舊狀態
      if (state.timestamp > this.offlineQueue[duplicateIndex].state.timestamp) {
        Logger.debug(`替換舊的離線隊列項目 (type=${state.type}，時間戳已更新)`);
        this.offlineQueue[duplicateIndex] = {
          state: state,
          addedAt: Date.now(),
          retryCount: 0,
        };
      } else {
        Logger.debug(`忽略較舊的離線隊列項目 (type=${state.type})`);
        return; // 忽略較舊的更新
      }
    } else {
      this.offlineQueue.push({
        state: state,
        addedAt: Date.now(),
        retryCount: 0,
      });
    }

    // 按時間戳排序（較舊的在前）
    this.offlineQueue.sort((a, b) => a.state.timestamp - b.state.timestamp);

    Logger.debug(
      `📋 已加入離線隊列，目前隊列長度: ${this.offlineQueue.length}`
    );
  }

  /**
   * 處理離線隊列 - 按時間戳順序發送隊列中的狀態
   * 優化：使用更快的發送速度（50ms 而非 100ms），提高用戶體驗
   */
  async processOfflineQueue() {
    if (this.isProcessingQueue || this.offlineQueue.length === 0) {
      return;
    }

    if (!this.syncClient.isConnected() || !this.syncClient.canOperate()) {
      return;
    }

    this.isProcessingQueue = true;
    const startTime = Date.now();
    Logger.debug(`開始處理離線隊列，共 ${this.offlineQueue.length} 個項目`);

    // 時間戳校正回歸：按時間戳重新排序
    const sortedItems = [...this.offlineQueue].sort((a, b) => {
      const timeA = a.state.timestamp || a.addedAt || 0;
      const timeB = b.state.timestamp || b.addedAt || 0;
      return timeA - timeB; // 較舊的在前
    });

    // 檢查是否有時間戳問題
    const timeCorrections = this._analyzeTimeCorrections(sortedItems);
    if (timeCorrections.hasIssues) {
      Logger.debug("偵測到時間戳問題，但繼續處理:", timeCorrections);
    }

    this.offlineQueue = []; // 清空隊列，避免重複處理
    let successCount = 0;
    let failCount = 0;

    for (const item of sortedItems) {
      try {
        const result = await this.syncClient.syncState(item.state);
        if (result) {
          successCount++;
          Logger.debug(
            `離線隊列項目發送成功: ${
              item.state.type || "unknown"
            } (時間戳: ${new Date(
              item.state.timestamp || item.addedAt
            ).toISOString()})`
          );
        } else {
          failCount++;
          Logger.debug(`離線隊列項目發送失敗: ${item.state.type || "unknown"}`);
          // 重新加入隊列，但增加重試計數
          item.retryCount++;
          if (item.retryCount < 3) {
            this.offlineQueue.push(item);
          } else {
            Logger.warn(
              `離線隊列項目重試次數過多，放棄: ${item.state.type || "unknown"}`
            );
          }
        }
      } catch (error) {
        failCount++;
        Logger.error(`離線隊列項目發送異常:`, error);
        // 重新加入隊列，但增加重試計數
        item.retryCount++;
        if (item.retryCount < 3) {
          this.offlineQueue.push(item);
        } else {
          Logger.warn(
            `離線隊列項目重試次數過多，放棄: ${item.state.type || "unknown"}`
          );
        }
      }

      // 優化：使用更快的發送延遲（50ms），提高吞吐量
      if (sortedItems.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const duration = Date.now() - startTime;
    this.isProcessingQueue = false;

    Logger.debug(
      `離線隊列處理完成 (成功: ${successCount}, 失敗: ${failCount}, 耗時: ${duration}ms，剩餘: ${this.offlineQueue.length})`
    );
  }

  /**
   * 分析時間戳校正問題
   * @private
   */
  _analyzeTimeCorrections(sortedItems) {
    const corrections = {
      hasIssues: false,
      duplicateTimestamps: [],
      timeJumps: [],
      totalItems: sortedItems.length,
    };

    if (sortedItems.length < 2) return corrections;

    let lastTimestamp = null;
    const timestampCounts = new Map();

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const timestamp = item.state.timestamp || item.addedAt || 0;

      // 檢查重複時間戳
      if (!timestampCounts.has(timestamp)) {
        timestampCounts.set(timestamp, 0);
      }
      timestampCounts.set(timestamp, timestampCounts.get(timestamp) + 1);

      if (timestampCounts.get(timestamp) > 1) {
        corrections.duplicateTimestamps.push({
          timestamp,
          count: timestampCounts.get(timestamp),
          types: [item.state.type],
        });
        corrections.hasIssues = true;
      }

      // 檢查時間跳躍（如果時間戳倒退超過1秒）
      if (lastTimestamp !== null && timestamp - lastTimestamp < -1000) {
        corrections.timeJumps.push({
          index: i,
          from: lastTimestamp,
          to: timestamp,
          jump: timestamp - lastTimestamp,
          type: item.state.type,
        });
        corrections.hasIssues = true;
      }

      lastTimestamp = timestamp;
    }

    return corrections;
  }

  /**
   * 檢查伺服器健康狀態
   */
  async checkServerHealth() {
    return await this.syncClient.checkServerHealth();
  }

  /**
   * 清理資源
   */
  cleanup() {
    this.syncClient.disconnect();
  }
}

export default SyncManagerCore;
