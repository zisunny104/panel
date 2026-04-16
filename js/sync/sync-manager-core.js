/**
 * SyncManagerCore - 核心邏輯
 * 負責初始化、URL偵測、狀態管理、與sync-client通訊
 */

import { SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";
import { SyncClient } from "./sync-client.js";
import { TimeSyncManager } from "../core/time-sync-manager.js";
import { Logger } from "../core/console-manager.js";

export class SyncManagerCore {
  // 離線佇列大小限制
  static MAX_OFFLINE_QUEUE_SIZE = 50;

  constructor(config = {}) {
    this.roleConfig = config.roleConfig || {
      VIEWER: "viewer",
      OPERATOR: "operator",
      LOCAL: "local",
    };
    this.pageConfig = config.pageConfig || {
      PANEL: "panel",
      BOARD: "board",
    };

    this.initDependencies(config);

    this.currentRole = this.roleConfig.VIEWER;

    this.baseUrl = this.getBaseUrl();

    this.offlineQueue = [];
    this.isProcessingQueue = false;
  }

  initDependencies(config = {}) {
    this.timeSyncManager = config.timeSyncManager || new TimeSyncManager();
    this.syncClient = config.syncClient || new SyncClient({
      roleConfig: this.roleConfig,
      timeSyncManager: this.timeSyncManager,
      sessionStore: config.sessionStore || null,
    });
  }

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

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SESSION_JOINED, {
          detail: {
            sessionId: result.sessionId,
            role: this.currentRole,
          },
        }),
      );

      setTimeout(() => this.processOfflineQueue(), 1000);

      return result;
    } catch (error) {
      Logger.error("工作階段建立失敗", error);
      throw error;
    }
  }

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

  async joinSessionByShareCode(
    shareCode,
    role = this.roleConfig.VIEWER,
  ) {
    try {
      await this.syncClient.joinSessionByShareCode(shareCode, role);
      this.currentRole = role;
      this.currentShareCode = shareCode;

      Logger.debug(
        `[SyncCore] 成功加入工作階段 - 代碼: ${shareCode}, 角色: ${role}, 工作階段ID: ${this.syncClient.sessionId}`,
      );

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SESSION_JOINED, {
          detail: {
            sessionId: this.syncClient.sessionId,
            shareCode: shareCode,
            role: role,
          },
        }),
      );

      setTimeout(() => this.processOfflineQueue(), 1000);

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 加入公開頻道
   * @param {string} channelName - 頻道名稱 "A" | "B" | "C"
   * @param {string} role - 角色
   */
  async joinPublicChannel(
    channelName,
    role = this.roleConfig.OPERATOR,
  ) {
    try {
      await this.syncClient.joinPublicChannel(channelName, role);
      this.currentRole = role;

      Logger.info(`[公開頻道] 加入成功 | 頻道: ${channelName} | 角色: ${role}`);

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SESSION_JOINED, {
          detail: {
            sessionId: this.syncClient.sessionId,
            channelName,
            role,
            isPublicChannel: true,
          },
        }),
      );

      return true;
    } catch (error) {
      Logger.error("加入公開頻道失敗", error);
      throw error;
    }
  }

  /**
   * 關閉公開頻道（中斷所有連線）
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async closePublicChannel(sessionId) {
    return this.syncClient.closePublicChannel(sessionId);
  }

  async closeSession(sessionId) {
    return this.syncClient.closeSession(sessionId);
  }

  async closeCurrentSession(sessionId) {
    const resolvedSessionId = sessionId || this.getSessionId();
    if (!resolvedSessionId) {
      throw new Error("目前沒有可關閉的工作階段");
    }

    if (resolvedSessionId.startsWith("__CH_")) {
      return this.closePublicChannel(resolvedSessionId);
    }

    return this.closeSession(resolvedSessionId);
  }

  async getShareCodeInfo(shareCode) {
    return this.syncClient.getShareCodeInfo(shareCode);
  }

  getStatusText() {
    return this.syncClient.getStatusText();
  }

  isConnected() {
    return this.syncClient.isConnected();
  }

  getSessionId() {
    return this.syncClient.getSessionId();
  }

  getRole() {
    return this.syncClient.getRole();
  }

  disconnect() {
    this.syncClient.disconnect();
  }

  async syncState(state) {
    if (!this.getSessionId()) {
      Logger.debug(`本機模式，忽略狀態同步 (type=${state.type})`);
      return false;
    }

    const isDuplicate = this.isDuplicateState(state);
    if (isDuplicate) {
      Logger.debug(`跳過重複的狀態更新 (type=${state.type})`);
      return false;
    }

    if (!this.syncClient.isConnected()) {
      this.addToOfflineQueue(state);
      return false;
    }

    if (!this.syncClient.canOperate()) {
      Logger.warn("目前模式無法發送狀態更新（非操作者角色）");
      return false;
    }

    try {
      const result = await this.syncClient.syncState(state);
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

  isDuplicateState(newState) {
    const strictDeduplicationTypes = [
      SYNC_DATA_TYPES.EXPERIMENT_STARTED,
      SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
      SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
      SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
    ];

    if (!strictDeduplicationTypes.includes(newState.type)) {
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
      return timeDiff < 1000;
    }

    return false;
  }

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
          if (item.retryCount < 3) {
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
        if (item.retryCount < 3) {
          this.offlineQueue.push(item);
        } else {
          Logger.warn(
            `離線佇列項目重試次數過多，放棄: ${item.state.type || "unknown"}`,
          );
        }
      }

      if (sortedItems.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const duration = Date.now() - startTime;
    this.isProcessingQueue = false;

    Logger.debug(
      `離線佇列處理完成 (成功: ${successCount}, 失敗: ${failCount}, 耗時: ${duration}ms，剩餘: ${this.offlineQueue.length})`,
    );
  }

  async checkServerHealth() {
    return this.syncClient.checkServerHealth();
  }

  cleanup() {
    this.syncClient.disconnect();
  }
}
