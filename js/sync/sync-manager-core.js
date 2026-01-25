/**
 * SyncManager Core - 核心邏輯
 * 負責初始化、URL偵測、狀態管理、與sync-client通訊
 * 使用時間同步確保多裝置間的時序一致性
 */

import { SyncEvents } from "../core/sync-events-constants.js";

export class SyncManagerCore {
  constructor() {
    // 初始化外部依賴（SyncClient / TimeSyncManager）
    this._initDependencies();

    // 預設角色
    this.currentRole = window.SyncManager?.ROLE?.VIEWER; // 預設為僅檢視

    // 自動偵測目前URL - 支援任何部署環境
    this.baseUrl = this.getBaseUrl();

    // 離線佇列 - 儲存離線時的狀態更新
    this.offlineQueue = [];
    this.isProcessingQueue = false;
  }

  // ================== Initialization / URL helpers ==================

  /**
   * 初始化外部依賴（SyncClient / TimeSyncManager）
   * 將依賴提取到此處，便於檢查與單元測試
   * @private
   */
  _initDependencies() {
    // 使用全域物件而非 import（避免循環依賴）
    const { SyncClient, TimeSyncManager } = window;

    if (!SyncClient) {
      throw new Error("SyncClient 未載入，請確認 script 載入順序");
    }

    this.syncClient = new SyncClient();
    // 允許外部已經建立 timeSyncManager 的情況
    this.timeSyncManager =
      window.timeSyncManager ||
      (TimeSyncManager ? new TimeSyncManager() : null);
  }

  /**
   * 取得基礎URL - 使用 URL API 簡化並自動適應部署環境
   */
  getBaseUrl() {
    try {
      const u = new URL(window.location.href);
      let basePath = u.pathname;

      // 移除可能的檔名（若 pathname 未以 / 結尾）
      if (!basePath.endsWith("/")) {
        basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1) || "/";
      }

      return `${u.origin}${basePath}`;
    } catch (error) {
      // 若 URL API 不可用（極端瀏覽器情況），回退到較舊的方式
      const protocol = window.location.protocol; // http: 或 https:
      const host = window.location.host; // hostname:port
      let pathname = window.location.pathname; // /path/to/file.html 或 /

      if (!pathname.endsWith("/")) {
        pathname = pathname.substring(0, pathname.lastIndexOf("/") + 1);
      }
      if (!pathname.endsWith("/")) {
        pathname += "/";
      }

      return `${protocol}//${host}${pathname}`;
    }
  }

  /**
   * 產生包含完整URL的 QR Code 內容
   * @param {string} code - 可以是 sessionId 或 shareCode
   * @param {string} role - 'viewer' 或 'operator'
   */
  generateQRContent(
    code,
    role = window.SyncManager?.ROLE?.VIEWER,
    target = window.SyncManager?.PAGE?.PANEL
  ) {
    // 確保 baseUrl 以 / 結尾
    let url = this.baseUrl;
    if (!url.endsWith("/")) {
      url += "/";
    }

    // 產生完整URL（可指定 target: 'index' 或 'experiment'）
    const encodedCode = encodeURIComponent(code);
    let qrUrl;
    if (target === window.SyncManager?.PAGE?.EXPERIMENT) {
      qrUrl = `${url}experiment.html?join=${encodedCode}&role=${encodeURIComponent(
        role
      )}`;
    } else {
      qrUrl = `${url}index.html?shareCode=${encodedCode}&role=${encodeURIComponent(
        role
      )}`;
    }

    Logger.debug("產生的 QR URL:", qrUrl);
    return qrUrl;
  }

  // ================== Session management ==================

  /**
   * 處理建立工作階段（建立者直接加入）
   */
  async createSession(createCode) {
    Logger.debug("[Sync] 開始建立工作階段", { createCode });

    try {
      const result = await this.syncClient.createSession(createCode);
      Logger.debug("[Sync] 工作階段建立成功", {
        sessionId: result.sessionId
      });

      this.currentRole = window.SyncManager?.ROLE?.OPERATOR; // 建立者預設為操作者
      this.currentSessionId = result.sessionId;
      this.currentShareCode = null; // 尚未產生分享代碼

      // 觸發工作階段加入事件
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SESSION_JOINED, {
          detail: {
            sessionId: result.sessionId,
            role: this.currentRole
          }
        })
      );

      // 連線成功後，處理離線佇列
      setTimeout(() => this.processOfflineQueue(), 1000);

      // 建立工作階段後，同步目前狀態到中樞
      setTimeout(() => this.syncCurrentStateToHub(), 1500);

      return result; // 回傳結果給調用者
    } catch (error) {
      Logger.error("[Sync] 工作階段建立失敗", error);
      throw error;
    }
  }

  /**
   * 產生分享代碼（在工作階段建立後）
   */
  async generateShareCode() {
    Logger.debug("[Sync] 開始產生分享代碼");

    try {
      const result = await this.syncClient.generateShareCode();
      Logger.debug("[Sync] 分享代碼已產生", {
        shareCode: result.shareCode
      });

      this.currentShareCode = result.shareCode;

      // 觸發分享代碼產生事件
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SHARE_CODE_GENERATED, {
          detail: {
            shareCode: result.shareCode,
            expiresAt: result.expiresAt
          }
        })
      );

      return result;
    } catch (error) {
      Logger.error("[Sync] 產生分享代碼失敗", error);
      throw error;
    }
  }

  /**
   * 通過分享代碼加入工作階段
   */
  async joinSessionByShareCode(
    shareCode,
    role = window.SyncManager?.ROLE?.VIEWER
  ) {
    try {
      await this.syncClient.joinSessionByShareCode(shareCode, role);
      this.currentRole = role;
      this.currentShareCode = shareCode; // 記錄使用過的分享代碼

      Logger.debug(
        `[SyncCore] 成功加入工作階段 - 代碼: ${shareCode}, 角色: ${role}, 工作階段ID: ${this.syncClient.sessionId}`
      );

      // 觸發工作階段加入事件
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SESSION_JOINED, {
          detail: {
            sessionId: this.syncClient.sessionId,
            shareCode: shareCode,
            role: role
          }
        })
      );

      // 連線成功後，處理離線佇列
      setTimeout(() => this.processOfflineQueue(), 1000);

      // 加入工作階段後，檢查並同步中樞資料
      setTimeout(() => this.syncCurrentStateFromHub(), 1500);

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 還原工作階段連線（同一裝置短期內）
   */
  async restoreSession(
    sessionId,
    clientId,
    role = window.SyncManager?.ROLE?.VIEWER
  ) {
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
        new CustomEvent(SyncEvents.SESSION_RESTORED, {
          detail: {
            sessionId: sessionId,
            clientId: clientId,
            role: role,
            shareCode: result?.shareCode
          }
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

  // ================== Getters / Status helpers ==================

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
    // 注意：工作階段狀態由 SyncClient.clearState() 管理（sessionStorage）
  }

  // ================== State syncing ==================

  /**
   * 同步狀態
   * 如果離線，會加入佇列等待連線還原後發送
   * 優化：去重檢查確保不發送完全相同的狀態
   */
  async syncState(state) {
    // 本機模式（無 sessionId）：直接忽略，不加入佇列
    if (!this.getSessionId()) {
      Logger.debug(`本機模式，忽略狀態同步 (type=${state.type})`);
      return false;
    }

    // 去重：檢查佇列中是否已有相同的狀態
    const isDuplicate = this._isDuplicateState(state);
    if (isDuplicate) {
      Logger.debug(`跳過重複的狀態更新 (type=${state.type})`);
      return false;
    }

    // 如果未連線到工作階段，將狀態加入離線佇列
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
      // 成功發送後，嘗試處理離線佇列
      if (result) {
        this.processOfflineQueue();
      }
      return result;
    } catch (error) {
      Logger.warn("同步狀態失敗，加入離線佇列:", error);
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
      "experiment_resumed"
    ];

    if (!strictDeduplicationTypes.includes(newState.type)) {
      return false;
    }

    // 檢查佇列中是否已有相同類型且相同裝置的狀態
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

  // ================== Offline queue handling ==================

  /**
   * 將狀態加入離線佇列
   */
  addToOfflineQueue(state) {
    // 本機模式（無 sessionId）：不加入佇列
    if (!this.getSessionId()) {
      return;
    }

    // 確保狀態有時間戳（使用同步的伺服器時間）
    if (!state.timestamp) {
      // 優先使用同步的伺服器時間，如果未初始化則使用本機時間
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
        Logger.debug(`替換舊的離線佇列項目 (type=${state.type}，時間戳已更新)`);
        this.offlineQueue[duplicateIndex] = {
          state: state,
          addedAt: Date.now(),
          retryCount: 0
        };
      } else {
        Logger.debug(`忽略較舊的離線佇列項目 (type=${state.type})`);
        return; // 忽略較舊的更新
      }
    } else {
      this.offlineQueue.push({
        state: state,
        addedAt: Date.now(),
        retryCount: 0
      });
    }

    // 按時間戳排序（較舊的在前）
    this.offlineQueue.sort((a, b) => a.state.timestamp - b.state.timestamp);

    Logger.debug(`已加入離線佇列，目前佇列長度: ${this.offlineQueue.length}`);
  }

  /**
   * 處理離線佇列 - 按時間戳順序發送佇列中的狀態
   * 優化：使用更快的發送速度（50ms 而非 100ms），提高使用者體驗
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
    Logger.debug(`開始處理離線佇列，共 ${this.offlineQueue.length} 個項目`);

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

    this.offlineQueue = []; // 清空佇列，避免重複處理
    let successCount = 0;
    let failCount = 0;

    for (const item of sortedItems) {
      try {
        const result = await this.syncClient.syncState(item.state);
        if (result) {
          successCount++;
          Logger.debug(
            `離線佇列項目發送成功: ${
              item.state.type || "unknown"
            } (時間戳: ${new Date(
              item.state.timestamp || item.addedAt
            ).toISOString()})`
          );
        } else {
          failCount++;
          Logger.debug(`離線佇列項目發送失敗: ${item.state.type || "unknown"}`);
          // 重新加入佇列，但增加重試計數
          item.retryCount++;
          if (item.retryCount < 3) {
            this.offlineQueue.push(item);
          } else {
            Logger.warn(
              `離線佇列項目重試次數過多，放棄: ${item.state.type || "unknown"}`
            );
          }
        }
      } catch (error) {
        failCount++;
        Logger.error("離線佇列項目發送異常:", error);
        // 重新加入佇列，但增加重試計數
        item.retryCount++;
        if (item.retryCount < 3) {
          this.offlineQueue.push(item);
        } else {
          Logger.warn(
            `離線佇列項目重試次數過多，放棄: ${item.state.type || "unknown"}`
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
      `離線佇列處理完成 (成功: ${successCount}, 失敗: ${failCount}, 耗時: ${duration}ms，剩餘: ${this.offlineQueue.length})`
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
      totalItems: sortedItems.length
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
          types: [item.state.type]
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
          type: item.state.type
        });
        corrections.hasIssues = true;
      }

      lastTimestamp = timestamp;
    }

    return corrections;
  }

  // ================== Health checks ==================

  /**
   * 檢查連線狀態（定期檢查用）
   */
  async checkConnection() {
    await this.syncClient.checkServerHealth();
  }

  /**
   * 檢查伺服器健康狀態
   */
  async checkServerHealth() {
    return await this.syncClient.checkServerHealth();
  }

  // ================== Hub sync helpers ==================

  /**
   * 建立工作階段時，同步目前狀態到中樞
   * @private
   */
  syncCurrentStateToHub() {
    try {
      const stateData = {
        type: "sessionState",
        experimentId: document.getElementById("experimentIdInput")?.value || "",
        subjectName:
          (
            document.getElementById("subjectName") ||
            document.getElementById("subjectNameInput")
          )?.value || "",
        timestamp: new Date().toISOString()
      };

      // 只在有受試者名稱時才同步（避免 null 污染）
      if (stateData.subjectName) {
        this.syncState(stateData);
        Logger.debug("[Sync] 工作階段建立後已同步狀態到中樞:", stateData);
      }
    } catch (error) {
      Logger.warn("[Sync] 同步工作階段狀態失敗:", error);
    }
  }

  /**
   * 加入工作階段時，檢查並同步中樞資料
   * @private
   */
  syncCurrentStateFromHub() {
    try {
      Logger.debug("[Sync] 加入工作階段後，開始同步中樞資料");
      Logger.debug(
        "[Sync] 需要初始化的項目: 實驗ID、受試者名稱、實驗組合、實驗狀態"
      );

      // 觸發事件，讓各頁面同步加入後的初始化資料
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SESSION_JOINED, {
          detail: {
            sessionId: this.currentSessionId || this.syncClient.sessionId,
            shouldSyncFromHub: true,
            syncItems: [
              "experimentId",
              "subjectName",
              "combination",
              "experimentState"
            ]
          }
        })
      );
    } catch (error) {
      Logger.warn("[Sync] 同步中樞資料失敗:", error);
    }
  }

  // ================== Cleanup ==================

  /**
   * 清理資源
   */
  cleanup() {
    this.syncClient.disconnect();
  }
}
