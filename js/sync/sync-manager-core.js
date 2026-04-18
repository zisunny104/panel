/**
 * SyncManagerCore - 同步管理核心
 *
 * - 初始化同步客戶端與時間同步管理器
 * - 管理工作階段與公開頻道的創建、加入、關閉
 * - 維護離線佇列，確保狀態同步的可靠性
 * - 提供狀態標準化與去重機制
 */

import {
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  SYNC_MANAGER_CONSTANTS,
  SYNC_ROLE_CONFIG,
  SYNC_PAGE_CONFIG,
} from "../constants/index.js";
import { SyncClient } from "./sync-client.js";
import { TimeSyncManager } from "../core/time-sync-manager.js";
import { Logger } from "../core/console-manager.js";

export class SyncManagerCore {
  // 離線佇列上限，避免記憶體持續膨脹
  static MAX_OFFLINE_QUEUE_SIZE = 50;
  static OFFLINE_QUEUE_PROCESS_DELAY_MS = 1000;
  static DUPLICATE_WINDOW_MS = 1000;
  static RETRY_LIMIT = 3;
  static QUEUE_ITEM_INTERVAL_MS = 50;
  static DEFAULT_SYNC_SOURCE = "sync_core";

  /**
   * @param {Object} config
   * @param {TimeSyncManager} [config.timeSyncManager] - 時間同步管理器
   * @param {SyncClient} [config.syncClient] - 同步客戶端
   * @param {Object} [config.sessionStore] - 工作階段儲存設定
   */
  constructor(config = {}) {
    this.roleConfig = SYNC_ROLE_CONFIG;
    this.pageConfig = SYNC_PAGE_CONFIG;

    // 元件建立與設定（可沿用外部傳入實例，否則使用預設實作）
    this.timeSyncManager = config.timeSyncManager || new TimeSyncManager();
    this.syncClient = config.syncClient || new SyncClient({
      roleConfig: this.roleConfig,
      timeSyncManager: this.timeSyncManager,
      sessionStore: config.sessionStore || null,
    });

    // 工作階段狀態
    this.currentRole = this.roleConfig.VIEWER;
    this.currentSessionId = null;
    this.currentShareCode = null;

    this.baseUrl = this.getBaseUrl();

    // 離線佇列：確保連線恢復後仍可補送狀態
    this.offlineQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * 從目前網址推導基礎 URL
   * @private
   * @returns {string} 以斜線結尾的基礎 URL
   */
  getBaseUrl() {
    try {
      const u = new URL(window.location.href);
      let basePath = u.pathname;

      if (!basePath.endsWith("/")) {
        basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1) || "/";
      }

      return `${u.origin}${basePath}`;
    } catch (error) {
      const protocol = window.location.protocol;
      const host = window.location.host;
      let pathname = window.location.pathname;

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
   * 產生可分享的加入連結
   * @param {string} code - 分享碼或公開頻道名稱
   * @param {string} [role=VIEWER] - 加入角色
   * @param {string} [target=PANEL] - 目標頁面（PANEL 或 BOARD）
   * @returns {string} 完整可分享連結
   */
  generateShareUrl(
    code,
    role = this.roleConfig.VIEWER,
    target = this.pageConfig.PANEL,
  ) {
    let url = this.baseUrl;
    if (!url.endsWith("/")) {
      url += "/";
    }

    const encodedCode = encodeURIComponent(code);
    if (target === this.pageConfig.BOARD) {
      return `${url}board.html?join=${encodedCode}&role=${encodeURIComponent(role)}`;
    }
    return `${url}index.html?shareCode=${encodedCode}&role=${encodeURIComponent(role)}`;
  }

  /**
   * 通知外部已加入工作階段
   * 集中處理事件派發與離線佇列排程
   * @private
   * @param {Object} detail - 工作階段事件細節
   */
  _notifySessionJoined(detail) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.SESSION_JOINED, { detail }),
    );
    this._scheduleOfflineQueueProcessing();
  }

  /**
   * 建立新工作階段（由操作者發起）
   * @async
   * @param {string} createCode - 建立用代碼
   * @returns {Promise<Object>} 建立結果
   * @throws {Error} 建立失敗時拋出
   */
  async createSession(createCode) {
    Logger.debug("開始建立工作階段", { createCode });

    try {
      const result = await this.syncClient.createSession(createCode);
      Logger.debug("工作階段建立成功", {
        sessionId: result.sessionId,
      });

      this.currentRole = this.roleConfig.OPERATOR;
      this.currentSessionId = result.sessionId;
      this.currentShareCode = null;

      this._notifySessionJoined({
        sessionId: result.sessionId,
        role: this.currentRole,
      });

      return result;
    } catch (error) {
      Logger.error("工作階段建立失敗", error);
      throw error;
    }
  }

  /**
   * 產生新的分享代碼供檢視者加入
   * @async
   * @returns {Promise<Object>} 分享代碼與過期資訊
   * @throws {Error} 產生失敗時拋出
   */
  async generateShareCode() {
    Logger.debug("開始產生分享代碼");

    try {
      const result = await this.syncClient.generateShareCode();
      Logger.debug("分享代碼已產生", {
        shareCode: result.shareCode,
      });

      this.currentShareCode = result.shareCode;

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SHARE_CODE_GENERATED, {
          detail: {
            shareCode: result.shareCode,
            expiresAt: result.expiresAt,
          },
        }),
      );

      return result;
    } catch (error) {
      Logger.error("產生分享代碼失敗", error);
      throw error;
    }
  }

  /**
   * 透過分享代碼加入既有工作階段（檢視者）
   * @async
   * @param {string} shareCode - 操作者提供的分享代碼
   * @param {string} [role=VIEWER] - 以何種角色加入
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} 加入失敗時拋出
   */
  async joinSessionByShareCode(
    shareCode,
    role = this.roleConfig.VIEWER,
  ) {
    await this.syncClient.joinSessionByShareCode(shareCode, role);
    this.currentRole = role;
    this.currentSessionId = this.syncClient.sessionId;
    this.currentShareCode = shareCode;

    Logger.debug(
      `[SyncCore] 成功加入工作階段 - 代碼: ${shareCode}, 角色: ${role}, 工作階段ID: ${this.syncClient.sessionId}`,
    );

    this._notifySessionJoined({
      sessionId: this.syncClient.sessionId,
      shareCode,
      role,
    });

    return true;
  }

  /**
   * 加入公開頻道（不需分享代碼）
   * @async
   * @param {string} channelName - 頻道識別（例如 A、B、C）
   * @param {string} [role=OPERATOR] - 以何種角色加入
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} 加入失敗時拋出
   */
  async joinPublicChannel(
    channelName,
    role = this.roleConfig.OPERATOR,
  ) {
    try {
      await this.syncClient.joinPublicChannel(channelName, role);
      this.currentRole = role;
      this.currentSessionId = this.syncClient.sessionId;
      this.currentShareCode = null;

      Logger.info(`[公開頻道] 加入成功 | 頻道: ${channelName} | 角色: ${role}`);

      this._notifySessionJoined({
        sessionId: this.syncClient.sessionId,
        channelName,
        role,
        isPublicChannel: true,
      });

      return true;
    } catch (error) {
      Logger.error("加入公開頻道失敗", error);
      throw error;
    }
  }

  /**
   * 關閉目前工作階段（含公開頻道與一般工作階段）
   * @async
   * @param {string} [sessionId] - 目標工作階段 ID，預設使用目前值
   * @returns {Promise<*>} 關閉結果
   * @throws {Error} 沒有可關閉工作階段或關閉失敗時拋出
   */
  async closeCurrentSession(sessionId) {
    const resolvedSessionId = sessionId || this.getSessionId();
    if (!resolvedSessionId) {
      throw new Error("目前沒有可關閉的工作階段");
    }

    if (
      resolvedSessionId.startsWith(
        SYNC_MANAGER_CONSTANTS.PUBLIC_CHANNEL_PREFIX,
      )
    ) {
      return this.syncClient.closePublicChannel(resolvedSessionId);
    }

    return this.syncClient.closeSession(resolvedSessionId);
  }

  /**
   * 取得分享代碼資訊（有效性、過期時間等）
   * @async
   * @param {string} shareCode - 要查詢的分享代碼
   * @returns {Promise<Object>} 分享代碼資訊
   */
  async getShareCodeInfo(shareCode) {
    return this.syncClient.getShareCodeInfo(shareCode);
  }

  /**
   * 取得目前連線狀態文字
   * @returns {string} 狀態描述
   */
  getStatusText() {
    return this.syncClient.getStatusText();
  }

  /**
   * 是否已連上伺服器
   * @returns {boolean} 連線狀態
   */
  isConnected() {
    return this.syncClient.isConnected();
  }

  /**
   * 取得目前工作階段 ID
   * @returns {string|null} 已加入則回傳 ID，否則 null
   */
  getSessionId() {
    return this.syncClient.getSessionId();
  }

  /**
   * 取得目前角色
   * @returns {string} 目前角色（VIEWER、OPERATOR、LOCAL）
   */
  getRole() {
    return this.syncClient.getRole();
  }

  /**
   * 中斷目前工作階段並重設狀態
   */
  disconnect() {
    this.syncClient.disconnect();
    this.currentSessionId = null;
    this.currentShareCode = null;
    this.currentRole = this.roleConfig.VIEWER;
  }

  /**
   * 加入工作階段後排程處理離線佇列
   * @private
   */
  _scheduleOfflineQueueProcessing() {
    setTimeout(
      () => this.processOfflineQueue(),
      SyncManagerCore.OFFLINE_QUEUE_PROCESS_DELAY_MS,
    );
  }

  /**
   * 標準化狀態 payload，補齊必要欄位（type、clientId、timestamp、source）
   * @private
   * @param {Object} [state={}] - 原始狀態物件
   * @returns {Object|null} 標準化後物件；無效時回傳 null
   */
  _normalizeStatePayload(state = {}) {
    if (!state || typeof state !== "object") {
      return null;
    }

    const payload = { ...state };
    payload.type = payload.type || "";
    payload.clientId = payload.clientId || this.syncClient?.clientId || "";

    if (!payload.timestamp) {
      payload.timestamp = this.timeSyncManager?.isSynchronized?.()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
    }

    if (!payload.source) {
      payload.source = SyncManagerCore.DEFAULT_SYNC_SOURCE;
    }

    return payload;
  }

  /**
   * 同步狀態到伺服器（失敗時落入離線佇列）
   * 包含標準化、去重與連線條件檢查
   * @async
   * @param {Object} state - 待同步狀態
   * @returns {Promise<boolean>} 是否成功
   */
  async syncState(state) {
    const normalizedState = this._normalizeStatePayload(state);
    if (!normalizedState || !normalizedState.type) {
      Logger.warn("忽略無效狀態同步：缺少 type");
      return false;
    }

    if (!normalizedState.clientId) {
      Logger.warn("忽略無效狀態同步：缺少 clientId");
      return false;
    }

    if (!this.getSessionId()) {
      Logger.debug(`本機模式，忽略狀態同步 (type=${normalizedState.type})`);
      return false;
    }

    // 針對特定生命週期事件做嚴格去重，避免短時間重複送出
    const isDuplicate = this._isSuspiciousDuplicate(normalizedState);
    if (isDuplicate) {
      Logger.debug(`跳過可疑重複的狀態更新 (type=${normalizedState.type})`);
      return false;
    }

    if (!this.syncClient.isConnected()) {
      this.addToOfflineQueue(normalizedState);
      return false;
    }

    if (!this.syncClient.canOperate()) {
      Logger.warn("目前模式無法發送狀態更新（非操作者角色）");
      return false;
    }

    try {
      const result = await this.syncClient.syncState(normalizedState);
      if (result) {
        this.processOfflineQueue();
      }
      return result;
    } catch (error) {
      Logger.warn("同步狀態失敗，加入離線佇列:", error);
      this.addToOfflineQueue(normalizedState);
      return false;
    }
  }

  /**
   * 檢查是否為短時間內可疑重複狀態
    * 目前僅套用於實驗生命週期事件（開始、停止、暫停、繼續）
   * @private
   * @param {Object} newState - 待檢查狀態
   * @returns {boolean} 是否命中可疑重複
   */
  _isSuspiciousDuplicate(newState) {
    const lifecycleTypes = [
      SYNC_DATA_TYPES.EXPERIMENT_STARTED,
      SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
      SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
      SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
    ];

    if (!lifecycleTypes.includes(newState.type)) {
      return false;
    }

    const lastSimilar = this.offlineQueue.find(
      (item) =>
        item.state.type === newState.type &&
        item.state.clientId === newState.clientId,
    );

    if (lastSimilar) {
      const timeDiff = Math.abs(
        (newState.timestamp || Date.now()) -
          (lastSimilar.state.timestamp || lastSimilar.addedAt),
      );
      return timeDiff < SyncManagerCore.DUPLICATE_WINDOW_MS;
    }

    return false;
  }

  /**
   * 將狀態加入離線佇列，待連線恢復後重送
   * 同類事件僅保留較新的時間戳
   * @private
   * @param {Object} state - 待排入佇列狀態（建議先完成標準化）
   */
  addToOfflineQueue(state) {
    if (!this.getSessionId()) {
      return;
    }

    if (!state.timestamp) {
      state.timestamp = this.timeSyncManager.isSynchronized()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
    }

    const duplicateIndex = this.offlineQueue.findIndex(
      (item) =>
        item.state.type === state.type &&
        item.state.clientId === state.clientId,
    );

    if (duplicateIndex !== -1) {
      if (state.timestamp > this.offlineQueue[duplicateIndex].state.timestamp) {
        Logger.debug(`替換舊的離線佇列項目 (type=${state.type}，時間戳已更新)`);
        this.offlineQueue[duplicateIndex] = {
          state: state,
          addedAt: Date.now(),
          retryCount: 0,
        };
      } else {
        Logger.debug(`忽略較舊的離線佇列項目 (type=${state.type})`);
        return;
      }
    } else {
      this.offlineQueue.push({
        state: state,
        addedAt: Date.now(),
        retryCount: 0,
      });
    }

    this.offlineQueue.sort((a, b) => a.state.timestamp - b.state.timestamp);

    // 檢查佇列大小，超過限制時移除最舊項目
    if (this.offlineQueue.length > SyncManagerCore.MAX_OFFLINE_QUEUE_SIZE) {
      const removed = this.offlineQueue.shift();
      Logger.warn(
        `離線佇列超過限制(${SyncManagerCore.MAX_OFFLINE_QUEUE_SIZE}), 移除最舊項目: ${removed.state.type}`,
      );
    }

    Logger.debug(`已加入離線佇列，目前佇列長度: ${this.offlineQueue.length}`);
  }

  /**
   * 處理離線佇列：連線恢復後依序重送
   * 單筆最多重試固定次數，超限後捨棄
   * @async
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

    const sortedItems = this.offlineQueue;
    this.offlineQueue = [];
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
              item.state.timestamp || item.addedAt,
            ).toISOString()})`,
          );
        } else {
          failCount++;
          Logger.debug(`離線佇列項目發送失敗: ${item.state.type || "unknown"}`);
          item.retryCount++;
          if (item.retryCount < SyncManagerCore.RETRY_LIMIT) {
            this.offlineQueue.push(item);
          } else {
            Logger.warn(
              `離線佇列項目重試次數過多，放棄: ${item.state.type || "unknown"}`,
            );
          }
        }
      } catch (error) {
        failCount++;
        Logger.error("離線佇列項目發送異常:", error);
        item.retryCount++;
        if (item.retryCount < SyncManagerCore.RETRY_LIMIT) {
          this.offlineQueue.push(item);
        } else {
          Logger.warn(
            `離線佇列項目重試次數過多，放棄: ${item.state.type || "unknown"}`,
          );
        }
      }

      if (sortedItems.length > 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, SyncManagerCore.QUEUE_ITEM_INTERVAL_MS),
        );
      }
    }

    const duration = Date.now() - startTime;
    this.isProcessingQueue = false;

    Logger.debug(
      `離線佇列處理完成 (成功: ${successCount}, 失敗: ${failCount}, 耗時: ${duration}ms，剩餘: ${this.offlineQueue.length})`,
    );
  }

  /**
   * 檢查伺服器健康狀態
   * @async
   * @returns {Promise<*>} 健康檢查結果
   */
  async checkServerHealth() {
    return this.syncClient.checkServerHealth();
  }

  /**
   * 清理資源：中斷連線並清空離線佇列
   */
  cleanup() {
    this.disconnect();
    this.offlineQueue = [];
    this.isProcessingQueue = false;
  }
}
