/**
 * 廣播管理器
 *
 * 功能:
 * - 向工作階段內所有客戶端廣播訊息
 * - 向特定客戶端發送訊息
 * - 訊息序列化
 * - 發送失敗重試機制
 */

import { Logger } from "../utils/logger.js";

const ROLE = { OPERATOR: "operator", VIEWER: "viewer" };

export class BroadcastManager {
  constructor(connectionManager, sessionManager) {
    this.connectionManager = connectionManager;
    this.sessionManager = sessionManager;
  }

  /**
   * 向特定客戶端發送訊息
   * @param {string} clientId - 客戶端 ID
   * @param {Object} message - 訊息對象
   * @returns {boolean} 是否發送成功
   */
  sendToClient(clientId, message) {
    try {
      const ws = this.connectionManager.getConnectionByClientId(clientId);

      if (!ws || ws.readyState !== 1) {
        // 1 = OPEN
        console.warn(`無法發送訊息: 客戶端 ${clientId} 未連線`);
        return false;
      }

      // 新增時間戳
      const messageWithTimestamp = {
        ...message,
        timestamp: message.timestamp || Date.now(),
      };

      ws.send(JSON.stringify(messageWithTimestamp));
      return true;
    } catch (error) {
      console.error(`發送訊息失敗 [${clientId}]:`, error.message);
      return false;
    }
  }

  /**
   * 向房間內所有客戶端廣播訊息
   * @param {string} sessionId - 工作階段 ID
   * @param {Object} message - 訊息對象
   * @param {Object} options - 選項 { excludeClientId, onlyClientIds }
   * @returns {Object} 發送結果 { sent, failed, total }
   */
  broadcastToRoom(sessionId, message, options = {}) {
    const { excludeClientId = null, onlyClientIds = null } = options;

    try {
      // 取得工作階段成員
      const members = this.sessionManager.getClients(sessionId);

      if (members.length === 0) {
        console.warn(`無法廣播: 工作階段 ${sessionId} 無成員`);
        return { sent: 0, failed: 0, total: 0 };
      }

      let sent = 0;
      let failed = 0;

      // 新增時間戳和工作階段 ID
      const messageWithMeta = {
        ...message,
        sessionId,
        timestamp: message.timestamp || Date.now(),
      };

      // 過濾目標客戶端
      const targetMembers = members.filter((member) => {
        // 排除特定客戶端
        if (excludeClientId && member.clientId === excludeClientId) {
          return false;
        }

        // 只發送給特定客戶端
        if (onlyClientIds && !onlyClientIds.includes(member.clientId)) {
          return false;
        }

        return true;
      });

      // 發送訊息給所有目標客戶端
      for (const member of targetMembers) {
        const success = this.sendToClient(member.clientId, messageWithMeta);
        if (success) {
          sent++;
        } else {
          failed++;
        }
      }

      // 統計角色
      let operatorCount = 0;
      let viewerCount = 0;
      for (const member of members) {
        if (member.role === ROLE.OPERATOR) {
          operatorCount++;
        } else if (member.role === ROLE.VIEWER) {
          viewerCount++;
        }
      }
      const totalCount = members.length;

      Logger.event(
        "cyan",
        "=",
        `工作階段 ${sessionId} | 角色<dim>[</dim><green>${operatorCount}</green><dim>/</dim><blue>${viewerCount}</blue><dim>/</dim><cyan>${totalCount}</cyan><dim>]</dim> | 廣播 <dim>[</dim><green>${sent}</green><dim>/</dim><red>${failed}</red><dim>/</dim><cyan>${targetMembers.length}</cyan><dim>]</dim>`,
      );

      return {
        sent,
        failed,
        total: targetMembers.length,
      };
    } catch (error) {
      console.error(`廣播失敗 [${sessionId}]:`, error.message);
      return { sent: 0, failed: 0, total: 0 };
    }
  }

  /**
   * 向房間內所有客戶端廣播（排除發送者）
   * @param {string} sessionId - 工作階段 ID
   * @param {string} senderClientId - 發送者客戶端 ID
   * @param {Object} message - 訊息對象
   * @returns {Object} 發送結果
   */
  broadcastToOthers(sessionId, senderClientId, message) {
    return this.broadcastToRoom(sessionId, message, {
      excludeClientId: senderClientId,
    });
  }

  /**
   * 發送工作階段狀態更新
   * @param {string} sessionId - 工作階段 ID
   * @param {Object} state - 狀態資料
   * @param {Object} options - 發送選項
   * @returns {Object} 發送結果
   */
  broadcastSessionState(sessionId, state, options = {}) {
    const message = {
      type: "session_state_update",
      data: {
        sessionId,
        state,
      },
    };

    return this.broadcastToRoom(sessionId, message, options);
  }

  /**
   * 發送客戶端加入通知
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 加入的客戶端 ID
   * @param {Object} metadata - 客戶端元資料
   * @returns {Object} 發送結果
   */
  broadcastClientJoined(sessionId, clientId, metadata = {}) {
    const message = {
      type: "client_joined",
      data: {
        clientId,
        ...metadata,
      },
    };

    // 通知其他客戶端（不包括剛加入的）
    return this.broadcastToOthers(sessionId, clientId, message);
  }

  /**
   * 發送客戶端退出通知
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 退出的客戶端 ID
   * @returns {Object} 發送結果
   */
  broadcastClientLeft(sessionId, clientId) {
    const message = {
      type: "client_left",
      data: {
        clientId,
      },
    };

    return this.broadcastToRoom(sessionId, message);
  }

  /**
   * 發送實驗事件
   * @param {string} sessionId - 工作階段 ID
   * @param {string} eventType - 事件類型 (started, paused, resumed, stopped)
   * @param {Object} data - 事件資料
   * @returns {Object} 發送結果
   */
  broadcastExperimentEvent(sessionId, eventType, data = {}) {
    const message = {
      type: `experiment_${eventType}`,
      data: {
        ...data,
        sessionId,
      },
    };

    return this.broadcastToRoom(sessionId, message);
  }

  /**
   * 發送實驗 ID 更新
   * @param {string} sessionId - 工作階段 ID
   * @param {string} experimentId - 實驗 ID
   * @param {Object} metadata - 元資料
   * @returns {Object} 發送結果
   */
  broadcastExperimentIdUpdate(sessionId, experimentId, metadata = {}) {
    const message = {
      type: "experiment_id_update",
      data: {
        experimentId,
        ...metadata,
      },
    };

    return this.broadcastToRoom(sessionId, message);
  }

  /**
   * 發送錯誤訊息
   * @param {string} clientId - 客戶端 ID
   * @param {string} code - 錯誤代碼
   * @param {string} errorMessage - 錯誤訊息
   * @returns {boolean} 是否發送成功
   */
  sendError(clientId, code, errorMessage) {
    const message = {
      type: "error",
      data: {
        code,
        message: errorMessage,
      },
    };

    return this.sendToClient(clientId, message);
  }

  /**
   * 取得統計資訊
   * @returns {Object}
   */
  getStats() {
    const connectionStats = this.connectionManager.getStats();
    const sessionStats = this.sessionManager.getStats();

    return {
      ...connectionStats,
      ...sessionStats,
    };
  }
}
