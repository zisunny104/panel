/**
 * ExperimentHubManager - 實驗中樞管理器
 *
 * 功能：
 * - 延遲初始化：同步模式下建立 ExperimentHubClient
 * - 模式檢測：自動判斷本機或同步模式
 * - 安全代理：hubClient 為 null 時提供預設值
 * - 向後相容：維持舊版 API
 */

import { SyncEvents } from "../core/sync-events-constants.js";

export class ExperimentHubManager {
  constructor() {
    this.hubClient = null;
    this.currentRole = window.SyncManager?.ROLE?.VIEWER;
    this.baseUrl = this.getBaseUrl();
    this.offlineQueue = [];
    this.isProcessingQueue = false;

    this.setupLazyInitialization();
  }

  // ============ 初始化方法 ============

  setupLazyInitialization() {
    const initializeClient = () => {
      if (this.hubClient) return;

      const ExperimentHubClient = window.ExperimentHubClient;
      if (ExperimentHubClient) {
        this.hubClient = new ExperimentHubClient();
      }
    };

    // 監聽工作階段事件
    window.addEventListener(SyncEvents.SESSION_JOINED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_RESTORED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_CREATED, initializeClient);

    // 立即初始化如果已有工作階段
    if (window.syncManager?.core?.getSessionId()) {
      initializeClient();
    }
  }

  // ============ 工具方法 ============

  getBaseUrl() {
    const { protocol, host, pathname } = window.location;
    const path = pathname.endsWith("/")
      ? pathname
      : pathname.substring(0, pathname.lastIndexOf("/") + 1);
    return `${protocol}//${host}${path}`;
  }

  isInSyncMode() {
    const syncClient = window.syncManager?.core?.syncClient;
    const hasSession = syncClient?.getSessionId?.() && syncClient?.clientId;
    return !!hasSession;
  }

  generateQRContent(code, role = window.SyncManager?.ROLE?.VIEWER) {
    return `${this.baseUrl}experiment.html?join=${code}&role=${role}`;
  }

  // ============ 工作階段管理 ============

  async createSession(createCode) {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 未初始化");
    }

    const result = await this.hubClient.createSession(createCode);
    this.currentRole = window.SyncManager?.ROLE?.OPERATOR;

    window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
    window.dispatchEvent(
      new CustomEvent(SyncEvents.SESSION_CREATED, { detail: result })
    );

    return result;
  }

  async joinSession(shareCode, role = window.SyncManager?.ROLE?.VIEWER) {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 未初始化");
    }

    const success = await this.hubClient.joinSessionByShareCode(
      shareCode,
      role
    );
    this.currentRole = role;

    if (success) {
      window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SESSION_JOINED_BY_CODE, {
          detail: { shareCode, role }
        })
      );
    }

    return success;
  }

  async restoreSession(
    sessionId,
    clientId,
    role = window.SyncManager?.ROLE?.VIEWER
  ) {
    const result = await this.hubClient.restoreSession(
      sessionId,
      clientId,
      role
    );
    this.currentRole = role;

    window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
    window.dispatchEvent(
      new CustomEvent(SyncEvents.SESSION_RESTORED, { detail: result })
    );

    return result;
  }

  disconnect() {
    this.hubClient?.disconnect();
    this.currentRole = window.SyncManager?.ROLE?.VIEWER;
    window.dispatchEvent(new CustomEvent("sync_session_left"));
  }

  // ============ 同步功能 ============

  async syncState(state) {
    if (window.syncManager?.core?.syncState) {
      return await window.syncManager.core.syncState(state);
    }
    return false;
  }

  async broadcastUpdate(updateType, data, priority = "normal") {
    if (window.syncManager?.core?.syncState) {
      return await window.syncManager.core.syncState({
        type: updateType,
        data,
        priority,
        deviceId: this.hubClient?.clientId,
        timestamp: Date.now()
      });
    }
    return false;
  }

  async processOfflineQueue() {
    if (this.isProcessingQueue || !this.hubClient?.isConnected?.()) return;

    this.isProcessingQueue = true;

    while (this.offlineQueue.length > 0) {
      const item = this.offlineQueue.shift();
      try {
        await this.syncState(item.state);
      } catch (error) {
        this.offlineQueue.unshift(item);
        break;
      }
    }

    this.isProcessingQueue = false;
  }

  // ============ 伺服器功能 ============

  async checkServerHealth() {
    return this.hubClient ? await this.hubClient.checkServerHealth() : false;
  }

  async registerExperimentId(experimentId, source = "manager") {
    if (!this.hubClient) return true;
    return await this.hubClient.registerExperimentId(experimentId, source);
  }

  async getExperimentId() {
    return this.hubClient ? await this.hubClient.getExperimentId() : null;
  }

  // ============ 代理方法 ============

  getSessionId() {
    return this.hubClient?.getSessionId?.() || null;
  }

  getRole() {
    return (
      this.hubClient?.getRole?.() ||
      window.SyncManager?.ROLE?.VIEWER ||
      "viewer"
    );
  }

  canOperate() {
    return this.hubClient?.canOperate?.() || false;
  }

  isConnected() {
    return this.hubClient?.isConnected?.() || false;
  }

  getStatusText() {
    return this.hubClient?.getStatusText?.() || "未連線";
  }

  // ============ 靜態方法 ============

  static async initialize() {
    const manager = new ExperimentHubManager();

    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get("join");
    const role = urlParams.get("role") || window.SyncManager?.ROLE?.VIEWER;

    if (joinCode) {
      try {
        await manager.joinSession(joinCode, role);
      } catch (error) {
        console.error("[ExperimentHubManager] URL 加入工作階段失敗:", error);
      }
    }

    return manager;
  }
}

// ============ 全域實例管理 ============

let globalHubManager = null;

export function getExperimentHubManager() {
  return globalHubManager || (globalHubManager = new ExperimentHubManager());
}

export async function initializeExperimentHub() {
  if (!globalHubManager) {
    globalHubManager = new ExperimentHubManager();
  }
  return globalHubManager;
}

// 全域導出以保持相容性
window.ExperimentHubManager = ExperimentHubManager;
window.getExperimentHubManager = getExperimentHubManager;
window.initializeExperimentHub = initializeExperimentHub;





