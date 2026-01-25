/**
 * WebSocket 連線管理器
 *
 * 功能:
 * - 註冊/移除 WebSocket 連線
 * - 維護連線狀態（連線ID、客戶端ID、工作階段ID映射）
 * - 心跳檢測（30秒間隔）
 * - 自動清理過期連線
 */

import { generateClientId } from "../utils/idGenerator.js";
import { SERVER_CONFIG } from "../config/server.js";
import { Logger } from "../utils/logger.js";
import { metrics } from "../metrics.js";

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
    this.heartbeatStarted = false; // 標記心跳檢測是否已啟動

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
        // rate limiter state
        rateLimit: {
          tokens: null,
          lastRefill: Date.now(),
          violations: 0,
        },
      },
    });

    // 初始化 rate limiter tokens（使用設定或預設值）
    try {
      const conn = this.connections.get(wsConnectionId);
      const rlConfig = SERVER_CONFIG.websocket.rateLimit || {
        capacity: 20,
        refillPerSec: 10,
        violationThreshold: 3,
      };
      conn.metadata.rateLimit.tokens = rlConfig.capacity;
    } catch (e) {
      // ignore
    }

    Logger.connection(`註冊 WebSocket 連線: ${wsConnectionId}`);

    // 更新 metrics
    try {
      metrics.setConnectionStats(this.getStats());
    } catch (e) {
      // ignore metric errors
    }

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
   * 移除 WebSocket 連線
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

    // 安全關閉 WebSocket 連線並移除事件監聽，避免記憶體洩漏
    try {
      if (connection.ws) {
        try {
          connection.ws.removeAllListeners();
        } catch (e) {
          // ignore
        }

        try {
          if (connection.ws.readyState === 1) {
            // OPEN
            connection.ws.close(1000, "Connection unregistered");
          } else {
            // 若不是 OPEN，直接 terminate
            if (typeof connection.ws.terminate === "function") {
              connection.ws.terminate();
            }
          }
        } catch (closeErr) {
          Logger.warn(
            `關閉連線時發生錯誤 [${wsConnectionId}]: ${closeErr.message}`,
          );
        }

        // 斷開引用，讓 GC 可以回收
        connection.ws = null;
      }
    } catch (e) {
      Logger.warn(`unregister清理時發生錯誤 [${wsConnectionId}]: ${e.message}`);
    }

    // 移除連線記錄
    this.connections.delete(wsConnectionId);

    // 更新 metrics
    try {
      metrics.setConnectionStats(this.getStats());
    } catch (e) {
      // ignore
    }

    Logger.connection(`移除 WebSocket 連線: ${wsConnectionId}`);
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
   * 檢查並更新 token bucket（Token Bucket 演算法）
   * - 目的：防止單一連線以高頻訊息佔滿主執行緒（JSON 解析等 CPU 工作），
   *   造成其他使用者延遲或服務中斷。
   * - 實作：每個連線在 metadata 儲存 tokens / lastRefill / violations，
   *   以 capacity/refillPerSec 參數控制速度與突發容許量。
   * @param {string} wsConnectionId
   * @returns {Object} { allowed: boolean, violations?: number, threshold?: number }
   */
  allowMessage(wsConnectionId) {
    const connection = this.connections.get(wsConnectionId);
    if (!connection || !connection.metadata) {
      return { allowed: false };
    }

    const rl = connection.metadata.rateLimit || {};
    const cfg = SERVER_CONFIG.websocket.rateLimit || {
      capacity: 20,
      refillPerSec: 10,
      violationThreshold: 3,
    };

    const now = Date.now();
    const last = rl.lastRefill || now;
    const elapsed = Math.max(0, (now - last) / 1000);
    const refill = elapsed * cfg.refillPerSec;

    rl.tokens = Math.min(cfg.capacity, (rl.tokens || cfg.capacity) + refill);
    rl.lastRefill = now;

    if (rl.tokens >= 1) {
      rl.tokens -= 1;
      return { allowed: true };
    }

    rl.violations = (rl.violations || 0) + 1;
    connection.metadata.rateLimit = rl;

    return {
      allowed: false,
      violations: rl.violations,
      threshold: cfg.violationThreshold,
    };
  }

  /**
   * 回傳指定 sessionId 下的 wsConnectionId 列表
   * @param {string} sessionId
   * @returns {string[]}
   */
  getConnectionIdsBySessionId(sessionId) {
    const set = this.sessionMap.get(sessionId);
    if (!set) return [];
    return Array.from(set);
  }

  /**
   * 啟動心跳檢測
   *
   * 注意：為避免心跳導致大量同步 I/O（DB 查詢）而造成效能瓶頸，
   * 心跳迴圈僅使用 in-memory 的 `SessionManager` 做快速驗證（若可用），
   * 並以 ping/pong 更新 `lastHeartbeat`。較高成本的 session 驗證
   *（例如確認 DB 狀態、封鎖等）請交由低頻排程處理。
   */
  startHeartbeatCheck() {
    const interval = SERVER_CONFIG.websocket.heartbeatInterval;
    const timeout = SERVER_CONFIG.websocket.heartbeatTimeout;

    // 只在第一次啟動時記錄
    if (!this.heartbeatStarted) {
      Logger.success("心跳檢測已啟動");
      this.heartbeatStarted = true;
    }

    this.heartbeatInterval = setInterval(() => {
      try {
        const now = Date.now();
        const deadConnections = [];
        const invalidSessionConnections = [];

        // 檢查所有連線
        for (const [wsConnectionId, connection] of this.connections.entries()) {
          try {
            const { ws, metadata, sessionId } = connection;
            const timeSinceLastHeartbeat = now - metadata.lastHeartbeat;

            // 檢查工作階段是否仍然有效（只檢查 in-memory，避免 DB 呼叫）
            if (sessionId) {
              if (
                !this.sessionManager ||
                typeof this.sessionManager.getSessionInfo !== "function"
              ) {
                Logger.debug(
                  `沒有可用的 in-memory SessionManager，跳過 session 檢查: ${wsConnectionId} (session: ${sessionId})`,
                );
              } else {
                const sessionInfo =
                  this.sessionManager.getSessionInfo(sessionId);
                if (!sessionInfo) {
                  Logger.debug(
                    `工作階段不存在或已從記憶體移除，斷開連線: ${wsConnectionId} (session: ${sessionId})`,
                  );
                  invalidSessionConnections.push(wsConnectionId);
                  continue;
                }
              }
            }

            // 如果超過超時時間，標記為死連線
            if (timeSinceLastHeartbeat > timeout) {
              Logger.debug(
                `連線超時: ${wsConnectionId} (${timeSinceLastHeartbeat}ms)`,
              );
              deadConnections.push(wsConnectionId);
            } else if (ws && ws.readyState === 1) {
              // 發送 Ping（保護性 try/catch）
              try {
                ws.ping();
              } catch (e) {
                Logger.warn(`Ping 失敗: ${wsConnectionId} (${e.message})`);
                deadConnections.push(wsConnectionId);
              }
            }
          } catch (innerError) {
            Logger.debug(
              `處理連線時出錯 [${wsConnectionId}]: ${innerError.message}`,
            );
            // 若有未處理錯誤，將該連線標為死連線
            deadConnections.push(wsConnectionId);
          }
        }

        // 清理無效工作階段連線
        for (const wsConnectionId of invalidSessionConnections) {
          try {
            metrics.incrementHeartbeatMissed();
          } catch (e) {
            // ignore
          }
          this.unregister(wsConnectionId);
        }

        // 清理死連線
        for (const wsConnectionId of deadConnections) {
          try {
            metrics.incrementHeartbeatMissed();
          } catch (e) {
            // ignore
          }
          this.unregister(wsConnectionId);
        }

        // 顯示統計資訊
        if (this.connections.size > 0) {
          const nowDate = new Date();
          const timestamp = `${nowDate.getFullYear()}-${String(
            nowDate.getMonth() + 1,
          ).padStart(
            2,
            "0",
          )}-${String(nowDate.getDate()).padStart(2, "0")} ${String(
            nowDate.getHours(),
          ).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(
            2,
            "0",
          )}:${String(nowDate.getSeconds()).padStart(2, "0")}`;
          Logger.stats(
            "目前連線",
            this.connections.size,
            "工作階段",
            this.sessionMap.size,
          );
        }
      } catch (err) {
        // 防止偶發錯誤終止整個心跳定時器
        Logger.error(`心跳迴圈發生未處理的錯誤: ${err.message}`);
      }
    }, interval);
  }

  /**
   * 停止心跳檢測
   */
  stopHeartbeatCheck() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      Logger.info("心跳檢測已停止");
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
