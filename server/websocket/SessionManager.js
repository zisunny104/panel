/**
 * 工作階段管理器
 *
 * 功能:
 * - 管理工作階段即時客戶端連線（Session → Clients 映射）
 * - 客戶端加入/退出工作階段
 * - 查詢工作階段客戶端
 * - 廣播工作階段狀態變更
 */

import { Logger } from "../utils/logger.js";
import { ROLE } from "../config/constants.js";

export class SessionManager {
  constructor(connectionManager, sessionService) {
    this.connectionManager = connectionManager;
    this.sessionService = sessionService;

    // 工作階段即時狀態: sessionId -> { clients: Map, metadata: {...} }
    this.activeSessions = new Map();
  }

  /**
   * 客戶端加入工作階段
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @param {Object} metadata - 客戶端元資料 { role, ... }
   */
  addClient(sessionId, clientId, metadata = {}) {
    // 確保工作階段存在
    if (!this.activeSessions.has(sessionId)) {
      this.activeSessions.set(sessionId, {
        clients: new Map(), // clientId -> metadata
        createdAt: Date.now(),
      });
      Logger.event("green", "+", `工作階段建立 | ${sessionId}`);
    }

    const session = this.activeSessions.get(sessionId);

    // 若同一 clientId 重連或切換角色，先扣除舊角色計數再加入新角色
    const prevMeta = session.clients.get(clientId);
    session.clients.set(clientId, {
      ...metadata,
      joinedAt: Date.now(),
    });

    // 更新角色計數器
    if (prevMeta?.role === ROLE.OPERATOR) session.operatorCount = Math.max(0, (session.operatorCount || 0) - 1);
    else if (prevMeta?.role === ROLE.VIEWER) session.viewerCount = Math.max(0, (session.viewerCount || 0) - 1);
    if (metadata.role === ROLE.OPERATOR) session.operatorCount = (session.operatorCount || 0) + 1;
    else if (metadata.role === ROLE.VIEWER) session.viewerCount = (session.viewerCount || 0) + 1;

    Logger.event("blue", "o", `客戶端加入 | ${clientId}`);

    return {
      sessionId,
      clientId,
      clientCount: session.clients.size,
      roleStats: {
        operatorCount: session.operatorCount || 0,
        viewerCount: session.viewerCount || 0,
        totalCount: session.clients.size,
      },
    };
  }

  /**
   * 客戶端退出工作階段
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   */
  removeClient(sessionId, clientId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return false;
    }

    // 先取得角色再刪除：delete 後 Map.get 回傳 undefined，計數器無法遞減
    const removedMeta = session.clients.get(clientId);
    const removed = session.clients.delete(clientId);

    if (removed) {
      // 更新角色計數器
      if (removedMeta?.role === ROLE.OPERATOR) session.operatorCount = Math.max(0, (session.operatorCount || 0) - 1);
      else if (removedMeta?.role === ROLE.VIEWER) session.viewerCount = Math.max(0, (session.viewerCount || 0) - 1);

      const operatorCount = session.operatorCount || 0;
      const viewerCount = session.viewerCount || 0;
      const totalCount = session.clients.size;

      Logger.event(
        "blue",
        "x",
        `客戶端退出 | ${clientId} | 工作階段 ${sessionId} [<green>${operatorCount}</green>/<blue>${viewerCount}</blue>/<cyan>${totalCount}</cyan>]`,
      );

      // 如果工作階段空了，移除工作階段
      if (session.clients.size === 0) {
        this.activeSessions.delete(sessionId);
        Logger.event("red", "-", `工作階段清空 | ${sessionId}`);
      }
    }

    return removed;
  }

  /**
   * 根據 clientId 查找並退出工作階段
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} sessionId - 退出的工作階段 ID
   */
  removeClientById(clientId) {
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.clients.has(clientId)) {
        this.removeClient(sessionId, clientId);
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 取得工作階段客戶端列表
   * @param {string} sessionId - 工作階段 ID
   * @returns {Array} 客戶端列表 [{ clientId, metadata }, ...]
   */
  getClients(sessionId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return [];
    }

    return Array.from(session.clients.entries()).map(
      ([clientId, metadata]) => ({
        clientId,
        ...metadata,
      }),
    );
  }

  /**
   * 取得工作階段客戶端數量
   * @param {string} sessionId - 工作階段 ID
   * @returns {number} 客戶端數量
   */
  getClientCount(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return session ? session.clients.size : 0;
  }

  /**
   * 取得工作階段完整資訊
   * @param {string} sessionId - 工作階段 ID
   * @returns {Object|null} 工作階段資訊
   */
  getSessionInfo(sessionId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return null;
    }

    return {
      sessionId,
      clientCount: session.clients.size,
      createdAt: session.createdAt,
      clients: this.getClients(sessionId),
    };
  }

  /**
   * 檢查客戶端是否在工作階段中
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @returns {boolean}
   */
  isClientInSession(sessionId, clientId) {
    const session = this.activeSessions.get(sessionId);
    return session ? session.clients.has(clientId) : false;
  }

  /**
   * 取得客戶端在工作階段中的角色
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} 角色 ('operator' | 'viewer') 或 null（不在工作階段中）
   */
  getClientRole(sessionId, clientId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;
    const clientMeta = session.clients.get(clientId);
    return clientMeta ? (clientMeta.role ?? null) : null;
  }

  /**
   * 取得客戶端所在的工作階段
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} sessionId
   */
  getSessionByClientId(clientId) {
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.clients.has(clientId)) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 取得所有活動中的工作階段
   * @returns {Array} 工作階段列表 [{ sessionId, clientCount, ... }, ...]
   */
  getAllSessions() {
    return Array.from(this.activeSessions.entries()).map(
      ([sessionId, session]) => ({
        sessionId,
        clientCount: session.clients.size,
        createdAt: session.createdAt,
      }),
    );
  }

  /**
   * 清空工作階段
   * @param {string} sessionId - 工作階段 ID
   */
  clearSession(sessionId) {
    const removed = this.activeSessions.delete(sessionId);
    if (removed) {
      Logger.event("red", "-", `工作階段清空 | ${sessionId}`);
    }
    return removed;
  }

  /**
   * 取得統計資訊
   * @returns {Object}
   */
  getStats() {
    let totalClients = 0;
    for (const session of this.activeSessions.values()) {
      totalClients += session.clients.size;
    }

    return {
      totalSessions: this.activeSessions.size,
      totalClients,
    };
  }

  /**
   * 清空所有工作階段
   */
  clearAll() {
    const sessionCount = this.activeSessions.size;
    if (sessionCount > 0) {
      for (const sessionId of this.activeSessions.keys()) {
        Logger.event("red", "-", `工作階段清空 | ${sessionId}`);
      }
    }
    this.activeSessions.clear();
  }

  // ==================== 實驗狀態追蹤（含公開頻道）====================

  /**
   * 設定工作階段的實驗狀態（記憶體，適用公開頻道與私人工作階段）
   * @param {string} sessionId
   * @param {Object} state - 實驗狀態物件
   */
  setExperimentState(sessionId, state) {
    if (!this.activeSessions.has(sessionId)) return;
    const session = this.activeSessions.get(sessionId);
    const updatedAt = Date.now();
    // 合併現有狀態，以免覆蓋無關欄位；_updatedAt 供客戶端感知覆蓋時序
    session.experimentState = { ...(session.experimentState || {}), ...state, _updatedAt: updatedAt };
    session.stateUpdatedAt = updatedAt;
  }

  /**
   * 取得工作階段的實驗狀態
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getExperimentState(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return session?.experimentState || null;
  }

  /**
   * 清除工作階段的實驗狀態（實驗結束時呼叫）
   * @param {string} sessionId
   */
  clearExperimentState(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) session.experimentState = null;
  }
}
