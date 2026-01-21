/**
 * WebSocket 訊息處理器
 *
 * 功能:
 * - 路由 WebSocket 訊息到對應處理函數
 * - 訊息驗證
 * - 錯誤處理
 * - 整合 Services 層和 WebSocket 層
 */

import SessionService from "../services/SessionService.js";
import ShareCodeService from "../services/ShareCodeService.js";
import Logger from "../utils/logger.js";

export class MessageHandler {
  constructor(connectionManager, sessionManager, broadcastManager) {
    this.connectionManager = connectionManager;
    this.sessionManager = sessionManager;
    this.broadcastManager = broadcastManager;

    // Services (實例化)
    this.sessionService = SessionService;
    this.shareCodeService = ShareCodeService;

    // 訊息處理器映射
    this.handlers = {
      auth: this.handleAuth.bind(this),
      heartbeat: this.handleHeartbeat.bind(this),
      state_update: this.handleStateUpdate.bind(this),
      experiment_action: this.handleExperimentAction.bind(this),
      get_session_state: this.handleGetSessionState.bind(this),
      ping: this.handlePing.bind(this),
    };
  }

  /**
   * 處理收到的訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} message - 訊息對象 { type, data, ... }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handle(wsConnectionId, message, ws) {
    const { type, data } = message;

    try {
      // 檢查訊息類型
      if (!type) {
        throw new Error("訊息缺少 type 欄位");
      }

      // 查找處理器
      const handler = this.handlers[type];

      if (!handler) {
        throw new Error(`未知的訊息類型: ${type}`);
      }

      // 執行處理器
      await handler(wsConnectionId, data, ws);
    } catch (error) {
      Logger.error(`處理訊息失敗 [${wsConnectionId}]: ${error.message}`);

      // 發送錯誤回應
      this.sendErrorResponse(ws, "HANDLER_ERROR", error.message);
    }
  }

  /**
   * 處理認證訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { sessionId, clientId, role }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleAuth(wsConnectionId, data, ws) {
    const { sessionId, clientId, role = "viewer" } = data;

    // 驗證必要欄位
    if (!sessionId || !clientId) {
      throw new Error("認證失敗: 缺少 sessionId 或 clientId");
    }

    try {
      // 驗證工作階段存在
      const session = this.sessionService.getSession(sessionId);
      if (!session) {
        // 工作階段不存在，通知客戶端清除本機同步資訊
        Logger.warn(
          `工作階段不存在 [${sessionId}]，通知客戶端 [${wsConnectionId}] 清除本機數據`,
        );
        this.sendResponse(ws, "clear_sync_data", {
          reason: "SESSION_NOT_FOUND",
          message: `工作階段不存在: ${sessionId}`,
        });
        Logger.debug(
          `[${wsConnectionId}] clear_sync_data 訊息已發送，準備拋出錯誤`,
        );
        throw new Error(`認證失敗: 工作階段不存在: ${sessionId}`);
      }

      // 驗證工作階段活動中
      if (!session.is_active) {
        throw new Error(`工作階段已失效: ${sessionId}`);
      }

      // 在 ConnectionManager 中認證連線（會自動處理重新連線）
      const isReconnect = this.connectionManager.authenticate(
        wsConnectionId,
        clientId,
        sessionId,
      );

      // 加入工作階段（如果是重新連線，會更新 metadata）
      const sessionInfo = this.sessionManager.addClient(sessionId, clientId, {
        role,
        isReconnect,
      });

      // 更新工作階段最後活動時間
      this.sessionService.updateLastActive(sessionId);

      // 發送認證成功回應
      this.sendResponse(ws, "auth_success", {
        sessionId,
        clientId,
        role,
        sessionInfo,
        isReconnect, // 告知前端是否為重新連線
      });

      // 只在首次加入時廣播（重新連線不廣播，避免重複通知）
      if (!isReconnect) {
        this.broadcastManager.broadcastClientJoined(sessionId, clientId, {
          role,
        });
      } else {
        // 重新連線時，廣播 client_reconnected 事件
        this.broadcastManager.broadcastToRoom(
          sessionId,
          {
            type: "client_reconnected",
            data: { clientId, role },
          },
          { excludeClientId: clientId },
        );
      }

      // 發送目前工作階段狀態給客戶端
      const currentState = this.getSessionState(sessionId);
      this.broadcastManager.sendToClient(clientId, {
        type: "session_state",
        data: currentState,
      });

      if (isReconnect) {
        Logger.debug(`客戶端重新連線 | ${clientId} → ${sessionId}`);
      } else {
        Logger.event(
          "green",
          "*",
          `<green>連線已認證</green> | ${clientId} <magenta>></magenta> ${sessionId}`,
        );
      }
    } catch (error) {
      throw new Error(`認證失敗: ${error.message}`);
    }
  }

  /**
   * 處理心跳訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { clientId, timestamp }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleHeartbeat(wsConnectionId, data, ws) {
    // 更新心跳時間
    this.connectionManager.updateHeartbeat(wsConnectionId);

    // 發送 Pong 回應
    this.sendResponse(ws, "heartbeat_ack", {
      serverTime: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * 處理狀態更新訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { sessionId, clientId, state }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleStateUpdate(wsConnectionId, data, ws) {
    const { sessionId, clientId, state } = data;

    // 驗證必要欄位
    if (!sessionId || !clientId || !state) {
      throw new Error("狀態更新失敗: 缺少必要欄位");
    }

    // 驗證工作階段有效性
    const session = this._validateSessionAndCleanup(
      wsConnectionId,
      sessionId,
      ws,
    );
    if (!session) {
      return; // 連線已被清理
    }

    try {
      // 驗證客戶端在工作階段中
      if (!this.sessionManager.isClientInSession(sessionId, clientId)) {
        throw new Error("客戶端不在工作階段中");
      }

      // 更新工作階段狀態
      this.sessionService.updateState(sessionId, state);

      // 更新最後活動時間
      this.sessionService.updateLastActive(sessionId);

      // 廣播狀態更新給房間內其他客戶端
      this.broadcastManager.broadcastSessionState(sessionId, state, {
        excludeClientId: clientId,
      });

      // 發送確認回應
      this.sendResponse(ws, "state_update_ack", {
        sessionId,
        timestamp: Date.now(),
      });

      // 記錄狀態更新詳情
      const stateType = state.type || "未知類型";
      const stateInfo = this._getStateUpdateInfo(state);
      Logger.debug(
        `<cyan>${sessionId}</cyan> | <yellow>${clientId}</yellow> | ${stateType}${stateInfo}`,
      );
    } catch (error) {
      throw new Error(`狀態更新失敗: ${error.message}`);
    }
  }

  /**
   * 處理實驗操作訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { sessionId, action, ... }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleExperimentAction(wsConnectionId, data, ws) {
    const { sessionId, action, ...actionData } = data;

    // 驗證必要欄位
    if (!sessionId || !action) {
      throw new Error("實驗操作失敗: 缺少必要欄位");
    }

    // 驗證工作階段有效性
    const session = this._validateSessionAndCleanup(
      wsConnectionId,
      sessionId,
      ws,
    );
    if (!session) {
      return; // 連線已被清理
    }

    try {
      // 廣播實驗事件
      this.broadcastManager.broadcastExperimentEvent(
        sessionId,
        action,
        actionData,
      );

      // 發送確認回應
      this.sendResponse(ws, "experiment_action_ack", {
        sessionId,
        action,
        timestamp: Date.now(),
      });

      console.log(`實驗操作: ${action} (工作階段: ${sessionId})`);
    } catch (error) {
      throw new Error(`實驗操作失敗: ${error.message}`);
    }
  }

  /**
   * 處理取得工作階段狀態請求
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { sessionId }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleGetSessionState(wsConnectionId, data, ws) {
    const { sessionId } = data;

    if (!sessionId) {
      throw new Error("取得狀態失敗: 缺少 sessionId");
    }

    try {
      const state = this.getSessionState(sessionId);

      this.sendResponse(ws, "session_state", state);
    } catch (error) {
      throw new Error(`取得狀態失敗: ${error.message}`);
    }
  }

  /**
   * 處理 Ping 訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - 資料
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handlePing(wsConnectionId, data, ws) {
    this.sendResponse(ws, "pong", {
      timestamp: Date.now(),
    });
  }

  /**
   * 取得工作階段完整狀態
   * @param {string} sessionId - 工作階段 ID
   * @returns {Object}
   */
  getSessionState(sessionId) {
    // 取得工作階段資料
    const session = this.sessionService.getSession(sessionId);
    if (!session) {
      throw new Error(`工作階段不存在: ${sessionId}`);
    }

    // 驗證工作階段活動中
    if (!session.is_active) {
      throw new Error(`工作階段已失效: ${sessionId}`);
    }

    // 取得工作階段資訊
    const sessionInfo = this.sessionManager.getSessionInfo(sessionId);

    // 解析 session.data
    const sessionData =
      typeof session.data === "string"
        ? JSON.parse(session.data)
        : session.data;

    return {
      sessionId,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      lastActiveAt: session.last_active_at,
      isActive: session.is_active,
      clients: sessionInfo ? sessionInfo.clients : [],
      state: sessionData.state || {},
    };
  }

  /**
   * 取得狀態更新資訊摘要
   * @private
   */
  _getStateUpdateInfo(state) {
    switch (state.type) {
      case "subjectNameUpdate":
        return ` | 受試者: <green>${state.subjectName || "N/A"}</green>`;
      case "experimentIdUpdate":
        return ` | 實驗ID: <green>${state.experimentId || "N/A"}</green>`;
      case "combination_selected":
        return ` | 組合: <green>${state.combination || "N/A"}</green>`;
      case "experimentStateUpdate":
        return ` | 狀態: <green>${state.experimentState || "N/A"}</green>`;
      case "button_action":
        return ` | 按鈕: <green>${state.buttonId || "N/A"}</green>`;
      default:
        return "";
    }
  }

  /**
   * 驗證工作階段並在無效時斷開連線
   * @private
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {string} sessionId - 工作階段 ID
   * @param {WebSocket} ws - WebSocket 連線
   * @returns {Object|null} 工作階段資料或 null（如果無效）
   */
  _validateSessionAndCleanup(wsConnectionId, sessionId, ws) {
    try {
      const session = this.sessionService.getSession(sessionId);
      if (!session) {
        Logger.warn(
          `工作階段不存在，斷開連線: ${wsConnectionId} (session: ${sessionId})`,
        );
        this.connectionManager.unregister(wsConnectionId);
        this.sendResponse(ws, "error", {
          type: "session_expired",
          message: "工作階段已過期，請重新加入",
        });
        return null;
      }

      if (!session.is_active) {
        Logger.warn(
          `工作階段已失效，斷開連線: ${wsConnectionId} (session: ${sessionId})`,
        );
        this.connectionManager.unregister(wsConnectionId);
        this.sendResponse(ws, "error", {
          type: "session_inactive",
          message: "工作階段已失效",
        });
        return null;
      }

      return session;
    } catch (error) {
      Logger.error(
        `驗證工作階段失敗，斷開連線: ${wsConnectionId} (${error.message})`,
      );
      this.connectionManager.unregister(wsConnectionId);
      return null;
    }
  }
  sendResponse(ws, type, data) {
    if (ws.readyState === 1) {
      // OPEN
      const message = JSON.stringify({
        type,
        data,
        timestamp: Date.now(),
      });
      ws.send(message);
      Logger.debug(`[sendResponse] 已發送 ${type} 訊息`);
    } else {
      Logger.warn(
        `[sendResponse] WebSocket 連接狀態異常 (${ws.readyState})，無法發送 ${type}`,
      );
    }
  }

  /**
   * 發送錯誤回應
   * @param {WebSocket} ws - WebSocket 連線
   * @param {string} code - 錯誤代碼
   * @param {string} message - 錯誤訊息
   */
  sendErrorResponse(ws, code, message) {
    this.sendResponse(ws, "error", {
      code,
      message,
    });
  }
}
