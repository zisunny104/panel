/**
 * 工作階段管理器
 *
 * 功能:
 * - 管理工作階段即時客戶端連線（Session → Clients 映射）
 * - 客戶端加入/離開工作階段
 * - 查詢工作階段客戶端
 * - 廣播工作階段狀態變更
 */

import { Logger } from "../utils/logger.js";

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

    // 新增客戶端到工作階段
    session.clients.set(clientId, {
      ...metadata,
      joinedAt: Date.now(),
    });

    // 統計角色
    let operatorCount = 0;
    let viewerCount = 0;
    for (const [id, client] of session.clients.entries()) {
      if (client.role === "operator") {
        operatorCount++;
      } else if (client.role === "viewer") {
        viewerCount++;
      }
    }
    const totalCount = session.clients.size;

    Logger.event("blue", "o", `客戶端加入 | ${clientId}`);

    return {
      sessionId,
      clientId,
      clientCount: session.clients.size,
      roleStats: {
        operatorCount,
        viewerCount,
        totalCount,
      },
    };
  }

  /**
   * 客戶端離開工作階段
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   */
  removeClient(sessionId, clientId) {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      return false;
    }

    // 移除客戶端
    const removed = session.clients.delete(clientId);

    if (removed) {
      // 統計角色
      let operatorCount = 0;
      let viewerCount = 0;
      for (const [id, client] of session.clients.entries()) {
        if (client.role === "operator") {
          operatorCount++;
        } else if (client.role === "viewer") {
          viewerCount++;
        }
      }
      const totalCount = session.clients.size;

      Logger.event(
        "blue",
        "x",
        `客戶端離開 | ${clientId} | 工作階段 ${sessionId} [<green>${operatorCount}</green>/<blue>${viewerCount}</blue>/<cyan>${totalCount}</cyan>]`,
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
   * 根據 clientId 查找並離開工作階段
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} sessionId - 離開的工作階段 ID
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
}
