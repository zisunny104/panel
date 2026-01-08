/**
 * Experiment Hub Manager - 智慧型同步管理器
 *
 * 功能特點：
 * - 延遲初始化：只有在同步模式下才建立 ExperimentHubClient
 * - 模式檢測：自動判斷本機模式或同步模式
 * - 安全代理：所有方法在 hubClient 為 null 時提供安全預設值
 * - 向後相容：維持舊版 API 介面
 *
 * 運作模式：
 * 1. 本機模式：hubClient = null，所有操作使用本地邏輯
 * 2. 同步模式：hubClient = ExperimentHubClient 實例，啟用多裝置同步
 */

import ExperimentHubClient from "../core/experiment-hub-client.js";
import { SyncEvents } from "../core/sync-events-constants.js";

export class ExperimentHubManager {
  constructor() {
    this.hubClient = null; // 延遲初始化，避免雙重實例化
    this.currentRole = "viewer";
    this.baseUrl = this.getBaseUrl();
    this.offlineQueue = [];
    this.isProcessingQueue = false;

    // 向後相容：監聽舊的事件並轉發
    this.setupLegacyEventListeners();

    // 在工作階段準備好時才初始化 ExperimentHubClient
    this.setupLazyInitialization();
  }

  /**
   * 設置延遲初始化：等待工作階段可用時才創建 ExperimentHubClient
   * 只有在同步模式下才會建立實例，本機模式保持 null
   */
  setupLazyInitialization() {
    const initializeClient = () => {
      if (!this.hubClient) {
        Logger.debug(
          "[ExperimentHubManager] 工作階段可用，初始化 ExperimentHubClient"
        );
        this.hubClient = new ExperimentHubClient();
      }
    };

    // 監聽工作階段準備好的事件
    window.addEventListener(SyncEvents.SESSION_JOINED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_RESTORED, initializeClient);
    window.addEventListener(SyncEvents.SESSION_CREATED, initializeClient);

    // 如果已經有工作階段，立即初始化
    if (window.syncManager?.core?.getSessionId()) {
      initializeClient();
    }
  }

  /**
   * 檢查是否處於同步模式（已加入或建立了工作階段）
   * @returns {boolean} 是否已經加入/建立了工作階段
   */
  isInSyncMode() {
    const syncClient = window.syncManager?.core?.syncClient;
    const sessionId = syncClient?.getSessionId?.();
    const clientId = syncClient?.clientId;
    const hasSession = sessionId && clientId;

    Logger.debug(
      `[ExperimentHubManager] 檢查是否同步模式: ${
        hasSession ? "✓" : "✗"
      } (sessionId: ${sessionId ? "✓" : "✗"}, clientId: ${
        clientId ? "✓" : "✗"
      })`
    );

    return hasSession;
  }

  /**
   * 取得基礎URL
   */
  getBaseUrl() {
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

  /**
   * 產生QR碼內容
   */
  generateQRContent(code, role = "viewer") {
    const joinUrl = `${this.baseUrl}experiment.html?join=${code}&role=${role}`;
    return joinUrl;
  }

  /**
   * 建立工作階段（僅同步模式可用）
   * @throws {Error} 如果處於本機模式會拋出錯誤
   */
  async createSession(createCode) {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 尚未初始化，無法建立工作階段");
    }
    try {
      const result = await this.hubClient.createSession(createCode);
      this.currentRole = "operator";

      // 觸發向後相容事件
      window.dispatchEvent(new CustomEvent("sync_session_joined"));
      window.dispatchEvent(
        new CustomEvent("sync_session_created", {
          detail: result,
        })
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 加入工作階段（僅同步模式可用）
   * @throws {Error} 如果處於本機模式會拋出錯誤
   */
  async joinSession(shareCode, role = "viewer") {
    if (!this.hubClient) {
      throw new Error("ExperimentHubClient 尚未初始化，無法加入工作階段");
    }
    try {
      const success = await this.hubClient.joinSessionByShareCode(
        shareCode,
        role
      );
      this.currentRole = role;

      if (success) {
        window.dispatchEvent(new CustomEvent("sync_session_joined"));
        window.dispatchEvent(
          new CustomEvent("sync_session_joined_by_code", {
            detail: { shareCode, role },
          })
        );
      }

      return success;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 還原工作階段（僅同步模式可用）
   * @throws {Error} 如果處於本機模式會拋出錯誤
   */
  async restoreSession(sessionId, clientId, role = "viewer") {
    try {
      const result = await this.hubClient.restoreSession(
        sessionId,
        clientId,
        role
      );
      this.currentRole = role;

      window.dispatchEvent(new CustomEvent("sync_session_joined"));
      window.dispatchEvent(
        new CustomEvent("sync_session_restored", {
          detail: result,
        })
      );

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 同步狀態
   */
  async syncState(state) {
    // 直接使用同步管理器的核心功能
    if (window.syncManager?.core?.syncState) {
      return await window.syncManager.core.syncState(state);
    }
    Logger.warn("同步管理器不可用，無法同步狀態");
    return false;
  }

  /**
   * 廣播更新
   */
  async broadcastUpdate(updateType, data, priority = "normal") {
    // 直接使用同步管理器的核心功能
    if (window.syncManager?.core?.syncState) {
      return await window.syncManager.core.syncState({
        type: updateType,
        data: data,
        priority: priority,
        deviceId: this.hubClient.clientId,
        timestamp: Date.now(),
      });
    }
    Logger.warn("同步管理器不可用，無法廣播更新");
    return false;
  }

  /**
   * 處理離線隊列
   */
  async processOfflineQueue() {
    if (this.isProcessingQueue || !this.hubClient.isConnected()) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.offlineQueue.length > 0) {
      const item = this.offlineQueue.shift();
      try {
        await this.syncState(item.state);
      } catch (error) {
        Logger.error("處理離線隊列項目失敗:", error);
        // 重新加入隊列
        this.offlineQueue.unshift(item);
        break;
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * 設定向後相容的事件監聽器
   */
  setupLegacyEventListeners() {
    // 監聽新的Hub事件並轉發為舊事件
    window.addEventListener("experiment_hub_state_update", (event) => {
      // 轉發為舊的sync_state_update事件
      window.dispatchEvent(
        new CustomEvent("sync_state_update", {
          detail: event.detail,
        })
      );
    });

    window.addEventListener("experiment_hub_id_update", (event) => {
      // 處理實驗ID更新 - 廣播給其他組件
      const { experimentId, device_id, timestamp } = event.detail;
      Logger.debug(
        `[ExperimentHubManager] 處理實驗ID更新: ${experimentId} (來自: ${device_id})`
      );
      Logger.debug("實驗ID更新詳情:", event.detail);

      // 觸發事件讓實驗頁面管理器更新UI
      Logger.debug(
        `[ExperimentHubManager] 📢 轉發 experiment_id_broadcasted 事件`
      );
      window.dispatchEvent(
        new CustomEvent("experiment_id_broadcasted", {
          detail: {
            experimentId,
            device_id,
            timestamp,
          },
        })
      );
      Logger.debug(
        `[ExperimentHubManager] 已轉發 experiment_id_broadcasted 事件`
      );
    });

    window.addEventListener("experiment_hub_connection_lost", () => {
      window.dispatchEvent(new CustomEvent("sync_connection_lost"));
    });
  }

  /**
   * 斷開連線
   */
  disconnect() {
    if (this.hubClient) {
      this.hubClient.disconnect();
    }
    this.currentRole = "viewer";
    window.dispatchEvent(new CustomEvent("sync_session_left"));
  }

  /**
   * 檢查伺服器健康狀態
   * @returns {boolean} 本機模式返回 false，同步模式返回實際健康狀態
   */
  async checkServerHealth() {
    if (!this.hubClient) {
      return false; // 本機模式，不檢查伺服器
    }
    return await this.hubClient.checkServerHealth();
  }

  /**
   * 註冊實驗ID
   * @returns {boolean} 本機模式返回 true（視為成功），同步模式返回實際結果
   */
  async registerExperimentId(experimentId, source = "manager") {
    if (!this.hubClient) {
      Logger.debug(
        `[ExperimentHubManager] 本機模式，不需要註冊實驗ID: ${experimentId}`
      );
      return true; // 本機模式，視為成功
    }
    return await this.hubClient.registerExperimentId(experimentId, source);
  }

  /**
   * 取得實驗ID
   * @returns {string|null} 本機模式返回 null，同步模式返回實際的實驗ID
   */
  async getExperimentId() {
    if (!this.hubClient) {
      Logger.debug(`[ExperimentHubManager] 本機模式，無法從中樞取得實驗ID`);
      return null; // 本機模式，回傳 null
    }
    return await this.hubClient.getExperimentId();
  }

  // 代理方法到hubClient - 安全處理 null 值
  /**
   * 取得工作階段ID
   * @returns {string|null} 本機模式返回 null，同步模式返回實際的 sessionId
   */
  getSessionId() {
    return this.hubClient?.getSessionId?.() || null;
  }

  /**
   * 取得目前角色
   * @returns {string} 本機模式返回 "viewer"，同步模式返回實際角色
   */
  getRole() {
    return this.hubClient?.getRole?.() || "viewer";
  }

  /**
   * 檢查是否可以操作
   * @returns {boolean} 本機模式返回 false，同步模式返回實際權限
   */
  canOperate() {
    return this.hubClient?.canOperate?.() || false;
  }

  /**
   * 檢查是否已連線
   * @returns {boolean} 本機模式返回 false，同步模式返回實際連線狀態
   */
  isConnected() {
    return this.hubClient?.isConnected?.() || false;
  }

  /**
   * 取得狀態文字
   * @returns {string} 本機模式返回 "未連線"，同步模式返回實際狀態文字
   */
  getStatusText() {
    return this.hubClient?.getStatusText?.() || "未連線";
  }

  // 靜態方法用於初始化
  static async initialize() {
    const manager = new ExperimentHubManager();

    // 嘗試從URL參數還原工作階段
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get("join");
    const role = urlParams.get("role") || "viewer";

    if (joinCode) {
      try {
        await manager.joinSession(joinCode, role);
        Logger.info(`通過URL加入工作階段: ${joinCode} 角色: ${role}`);
      } catch (error) {
        Logger.error("通過URL加入工作階段失敗:", error);
      }
    }

    return manager;
  }
}

// 建立全域實例
let globalHubManager = null;

export function getExperimentHubManager() {
  if (!globalHubManager) {
    globalHubManager = new ExperimentHubManager();
  }
  return globalHubManager;
}

export async function initializeExperimentHub() {
  Logger.debug("[initializeExperimentHub] 開始初始化");
  
  if (!globalHubManager) {
    Logger.debug("[initializeExperimentHub] 建立新的 ExperimentHubManager");
    globalHubManager = new ExperimentHubManager();
  } else {
    Logger.debug("[initializeExperimentHub] ExperimentHubManager 已存在，使用現有實例");
  }
  
  Logger.debug("[initializeExperimentHub] 初始化完成", {
    hasSyncClient: !!globalHubManager.hubClient,
    isInSyncMode: globalHubManager.isInSyncMode(),
  });
  
  return globalHubManager;
}

// 將新管理器賦值給全域變數以保持相容性
window.ExperimentHubManager = ExperimentHubManager;
window.getExperimentHubManager = getExperimentHubManager;
window.initializeExperimentHub = initializeExperimentHub;
