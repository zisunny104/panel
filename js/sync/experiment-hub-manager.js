/**
 * ExperimentHubManager - 實驗中樞管理器
 *
 * 功能：
 * - 延遲初始化：同步模式下建立 ExperimentHubClient
 * - 模式檢測：自動判斷本機或同步模式
 * - 安全代理：hubClient 為 null 時提供預設值
 */

import { SyncEvents } from "../core/sync-events-constants.js";

export class ExperimentHubManager {
  /**
   * 建構子 - 初始化實驗中樞管理器
   */
  constructor() {
    this.hubClient = null;
    this.currentRole = window.SyncManager?.ROLE?.VIEWER;
    this.baseUrl = this.getBaseUrl();

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

    window.addEventListener(SyncEvents.SESSION_JOINED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_RESTORED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_CREATED, initializeClient);

    if (window.syncManager?.core?.getSessionId()) {
      initializeClient();
    }
  }

  // ============ 工具方法 ============

  /**
   * 取得基礎 URL
   * @returns {string} 應用程式的基礎 URL
   */
  getBaseUrl() {
    const { protocol, host, pathname } = window.location;
    const path = pathname.endsWith("/")
      ? pathname
      : pathname.substring(0, pathname.lastIndexOf("/") + 1);
    return `${protocol}//${host}${path}`;
  }

  /**
   * 檢查是否處於同步模式
   * @returns {boolean} 是否處於同步模式
   */
  isInSyncMode() {
    return !!window.syncManager?.core?.syncClient?.getSessionId?.();
  }

  /**
   * 產生 QR Code 內容
   * @param {string} code - 工作階段代碼
   * @param {string} [role] - 使用者角色，預設為 VIEWER
   * @returns {string} QR Code 內容 URL
   */
  generateQRContent(code, role = window.SyncManager?.ROLE?.VIEWER) {
    return `${this.baseUrl}board.html?join=${code}&role=${role}`;
  }

  // ============ 工作階段管理 ============

  /**
   * 建立工作階段
   * @param {string} createCode - 建立工作階段的代碼
   * @returns {Promise<Object>} 工作階段資訊
   * @throws {Error} 如果 ExperimentHubClient 未初始化
   */
  async createSession(createCode) {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 未初始化");
    }

    const result = await this.hubClient.createSession(createCode);
    this.currentRole = window.SyncManager?.ROLE?.OPERATOR;

    window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
    window.dispatchEvent(
      new CustomEvent(SyncEvents.SESSION_CREATED, { detail: result }),
    );

    return result;
  }

  /**
   * 加入工作階段
   * @param {string} shareCode - 分享代碼
   * @param {string} [role] - 使用者角色，預設為 VIEWER
   * @returns {Promise<boolean>} 是否成功加入
   * @throws {Error} 如果 ExperimentHubClient 未初始化
   */
  async joinSession(shareCode, role = window.SyncManager?.ROLE?.VIEWER) {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 未初始化");
    }

    const success = await this.hubClient.joinSessionByShareCode(
      shareCode,
      role,
    );
    this.currentRole = role;

    if (success) {
      window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
      window.dispatchEvent(
        new CustomEvent(SyncEvents.SESSION_JOINED_BY_CODE, {
          detail: { shareCode, role },
        }),
      );
    }

    return success;
  }

  /**
   * 恢復工作階段
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @param {string} [role] - 使用者角色，預設為 VIEWER
   * @returns {Promise<Object>} 工作階段資訊
   */
  async restoreSession(
    sessionId,
    clientId,
    role = window.SyncManager?.ROLE?.VIEWER,
  ) {
    const result = await this.hubClient.restoreSession(
      sessionId,
      clientId,
      role,
    );
    this.currentRole = role;

    window.dispatchEvent(new CustomEvent(SyncEvents.SESSION_JOINED));
    window.dispatchEvent(
      new CustomEvent(SyncEvents.SESSION_RESTORED, { detail: result }),
    );

    return result;
  }

  /**
   * 中斷連線
   */
  disconnect() {
    this.hubClient?.disconnect();
    this.currentRole = window.SyncManager?.ROLE?.VIEWER;
    window.dispatchEvent(new CustomEvent("sync_session_left"));
  }

  // ============ 伺服器功能 ============

  /**
   * 檢查伺服器健康狀態
   * @returns {Promise<boolean>} 伺服器是否健康
   */
  async checkServerHealth() {
    return this.hubClient ? await this.hubClient.checkServerHealth() : false;
  }

  /**
   * 註冊實驗 ID
   * @param {string} experimentId - 實驗 ID
   * @param {string} [source] - 來源標識，預設為 "manager"
   * @returns {Promise<boolean>} 是否成功註冊
   */
  async registerExperimentId(experimentId, source = "manager") {
    if (!this.hubClient) return true;
    return await this.hubClient.registerExperimentId(experimentId, source);
  }

  /**
   * 取得實驗 ID
   * @returns {Promise<string|null>} 實驗 ID 或 null
   */
  async getExperimentId() {
    return this.hubClient ? await this.hubClient.getExperimentId() : null;
  }
}

// ============ 全域實例管理 ============

let globalHubManager = null;

/**
 * 取得全域 ExperimentHubManager 實例
 * @returns {ExperimentHubManager} 全域管理器實例
 */
export function getExperimentHubManager() {
  return globalHubManager || (globalHubManager = new ExperimentHubManager());
}

/**
 * 初始化全域 ExperimentHubManager
 * @returns {Promise<ExperimentHubManager>} 初始化後的管理器實例
 */
export async function initializeExperimentHub() {
  if (!globalHubManager) {
    globalHubManager = new ExperimentHubManager();
  }
  return globalHubManager;
}
