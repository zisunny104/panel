/**
 * WebSocket 連線管理器
 *
 * 功能:
 * - 註冊/註銷 WebSocket 連線
 * - 維護連線狀態（連線ID、客戶端ID、工作階段ID映射）
 * - 心跳檢測（30秒間隔）
 * - 自動清理過期連線
 */

import { generateClientId } from "../utils/idGenerator.js";
import { SERVER_CONFIG } from "../config/server.js";
import { Logger } from "../utils/logger.js";

export class ConnectionManager {
  constructor() {
    // WebSocket 連線映射: wsConnectionId -> { ws, clientId, sessionId, metadata }
    this.connections = new Map();

    // 客戶端ID反向映射: clientId -> wsConnectionId
    this.clientIdMap = new Map();

    // 工作階段ID反向映射: sessionId -> Set<wsConnectionId>
    this.sessionMap = new Map();

    // 心跳檢測定時器
    this.heartbeatInterval = null;

    // 啟動心跳檢測
    this.startHeartbeatCheck();
  }

  /**
   * 註冊新的 WebSocket 連線
   * @param {WebSocket} ws - WebSocket 連線
   * @param {Object} clientInfo - 客戶端資訊 { ipAddress, userAgent, origin }
   * @returns {string} wsConnectionId - 連線 ID
   */
  register(ws, clientInfo) {
    // 產生唯一的 WebSocket 連線 ID
    const wsConnectionId = `ws_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    // 儲存連線資訊
    this.connections.set(wsConnectionId, {
      ws,
      clientId: null, // 尚未認證
      sessionId: null, // 尚未加入工作階段
      metadata: {
        ...clientInfo,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
      },
    });

    Logger.connection(`註冊 WebSocket 連線: ${wsConnectionId}`);

    return wsConnectionId;
  }

  /**
   * 認證連線（綁定 clientId 和 sessionId）
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {string} clientId - 客戶端 ID
   * @param {string} sessionId - 工作階段 ID
   * @returns {boolean} isReconnect - 是否為重新連線
   */
  authenticate(wsConnectionId, clientId, sessionId) {
    const connection = this.connections.get(wsConnectionId);

    if (!connection) {
      throw new Error(`連線不存在: ${wsConnectionId}`);
    }

    // 檢查 clientId 是否已存在（重新連線的情況）
    const existingWsConnectionId = this.clientIdMap.get(clientId);
    const isReconnect = existingWsConnectionId !== undefined;

    if (isReconnect) {
      // 移除舊的 WebSocket 連線
      const oldConnection = this.connections.get(existingWsConnectionId);
      if (oldConnection) {
        console.log(
          `偵測到重新連線: ${clientId} (舊連線: ${existingWsConnectionId})`,
        );

        // 關閉舊連線
        if (oldConnection.ws.readyState === 1) {
          oldConnection.ws.close(1000, "Client reconnected from new tab");
        }

        // 從工作階段映射中移除舊連線
        const oldSessionId = oldConnection.sessionId;
        if (oldSessionId) {
          const sessionConnections = this.sessionMap.get(oldSessionId);
          if (sessionConnections) {
            sessionConnections.delete(existingWsConnectionId);
          }
        }

        // 刪除舊連線記錄
        this.connections.delete(existingWsConnectionId);
      }
    }

    // 更新連線資訊
    connection.clientId = clientId;
    connection.sessionId = sessionId;
    connection.metadata.isReconnect = isReconnect;

    // 更新反向映射（覆蓋舊的）
    this.clientIdMap.set(clientId, wsConnectionId);

    // 更新工作階段映射
    if (!this.sessionMap.has(sessionId)) {
      this.sessionMap.set(sessionId, new Set());
    }
    this.sessionMap.get(sessionId).add(wsConnectionId);

    if (isReconnect) {
      Logger.debug(
        `客戶端重新連線: ${wsConnectionId} → ${clientId} (工作階段: ${sessionId})`,
      );
    } else {
      Logger.debug(
        `客戶端認證: ${wsConnectionId} → ${clientId} (工作階段: ${sessionId})`,
      );
    }

    return isReconnect;
  }

  /**
   * 註銷 WebSocket 連線
   * @param {string} wsConnectionId - WebSocket 連線 ID
   */
  unregister(wsConnectionId) {
    const connection = this.connections.get(wsConnectionId);

    if (!connection) {
      return;
    }

    const { clientId, sessionId } = connection;

    // 移除客戶端ID映射
    if (clientId) {
      this.clientIdMap.delete(clientId);
    }

    // 移除工作階段映射
    if (sessionId) {
      const sessionConnections = this.sessionMap.get(sessionId);
      if (sessionConnections) {
        sessionConnections.delete(wsConnectionId);

        // 如果工作階段沒有連線了，移除映射
        if (sessionConnections.size === 0) {
          this.sessionMap.delete(sessionId);
        }
      }
    }

    // 關閉 WebSocket 連線
    if (connection.ws.readyState === 1) {
      // OPEN
      connection.ws.close(1000, "Connection unregistered");
    }

    // 移除連線記錄
    this.connections.delete(wsConnectionId);

    Logger.connection(`註銷 WebSocket 連線: ${wsConnectionId}`);
  }

  /**
   * 根據 clientId 取得 WebSocket 連線
   * @param {string} clientId - 客戶端 ID
   * @returns {WebSocket|null}
   */
  getConnectionByClientId(clientId) {
    const wsConnectionId = this.clientIdMap.get(clientId);

    if (!wsConnectionId) {
      return null;
    }

    const connection = this.connections.get(wsConnectionId);
    return connection ? connection.ws : null;
  }

  /**
   * 根據 sessionId 取得所有 WebSocket 連線
   * @param {string} sessionId - 工作階段 ID
   * @returns {WebSocket[]}
   */
  getConnectionsBySessionId(sessionId) {
    const wsConnectionIds = this.sessionMap.get(sessionId);

    if (!wsConnectionIds) {
      return [];
    }

    const connections = [];
    for (const wsConnectionId of wsConnectionIds) {
      const connection = this.connections.get(wsConnectionId);
      if (connection && connection.ws.readyState === 1) {
        // OPEN
        connections.push(connection.ws);
      }
    }

    return connections;
  }

  /**
   * 根據 sessionId 取得所有客戶端 ID
   * @param {string} sessionId - 工作階段 ID
   * @returns {string[]}
   */
  getClientIdsBySessionId(sessionId) {
    const wsConnectionIds = this.sessionMap.get(sessionId);

    if (!wsConnectionIds) {
      return [];
    }

    const clientIds = [];
    for (const wsConnectionId of wsConnectionIds) {
      const connection = this.connections.get(wsConnectionId);
      if (connection && connection.clientId) {
        clientIds.push(connection.clientId);
      }
    }

    return clientIds;
  }

  /**
   * 更新心跳時間
   * @param {string} wsConnectionId - WebSocket 連線 ID
   */
  updateHeartbeat(wsConnectionId) {
    const connection = this.connections.get(wsConnectionId);

    if (connection) {
      connection.metadata.lastHeartbeat = Date.now();
    }
  }

  /**
   * 啟動心跳檢測
   */
  startHeartbeatCheck() {
    const interval = SERVER_CONFIG.websocket.heartbeatInterval;
    const timeout = SERVER_CONFIG.websocket.heartbeatTimeout;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadConnections = [];

      // 檢查所有連線
      for (const [wsConnectionId, connection] of this.connections.entries()) {
        const { ws, metadata } = connection;
        const timeSinceLastHeartbeat = now - metadata.lastHeartbeat;

        // 如果超過超時時間，標記為死連線
        if (timeSinceLastHeartbeat > timeout) {
          console.log(
            `連線超時: ${wsConnectionId} (${timeSinceLastHeartbeat}ms)`,
          );
          deadConnections.push(wsConnectionId);
        } else if (ws.readyState === 1) {
          // 發送 Ping
          ws.ping();
        }
      }

      // 清理死連線
      for (const wsConnectionId of deadConnections) {
        this.unregister(wsConnectionId);
      }

      // 顯示統計資訊
      if (this.connections.size > 0) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(
          now.getMonth() + 1,
        ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(
          now.getHours(),
        ).padStart(2, "0")}:${String(now.getMinutes()).padStart(
          2,
          "0",
        )}:${String(now.getSeconds()).padStart(2, "0")}`;
        Logger.stats(
          "目前連線",
          this.connections.size,
          "工作階段",
          this.sessionMap.size,
        );
      }
    }, interval);

    Logger.info(`心跳檢測已啟動 (間隔: ${interval}ms, 超時: ${timeout}ms)`);
  }

  /**
   * 停止心跳檢測
   */
  stopHeartbeatCheck() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log("心跳檢測已停止");
    }
  }

  /**
   * 取得連線統計資訊
   * @returns {Object} 統計資訊
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      authenticatedConnections: this.clientIdMap.size,
      activeSessions: this.sessionMap.size,
    };
  }

  /**
   * 關閉所有連線
   */
  closeAll() {
    Logger.debug("正在關閉所有 WebSocket 連線...");

    // 停止心跳檢測
    this.stopHeartbeatCheck();

    // 關閉所有連線
    for (const [wsConnectionId, connection] of this.connections.entries()) {
      if (connection.ws.readyState === 1) {
        connection.ws.close(1001, "Server shutting down");
      }
    }

    // 清空所有映射
    this.connections.clear();
    this.clientIdMap.clear();
    this.sessionMap.clear();

    Logger.debug("所有 WebSocket 連線已關閉");
  }
}
