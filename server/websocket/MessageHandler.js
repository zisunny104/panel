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
import {
  findOperatorConflict,
  normalizeClientType,
} from "../utils/sync-role-guard.js";
import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";
import { ROLE, CHANNEL_CONSTANTS } from "../config/constants.js";

const PUBLIC_CHANNEL_PREFIX = CHANNEL_CONSTANTS.PREFIX;

export class MessageHandler {
  constructor(connectionManager, sessionManager, broadcastManager) {
    this.connectionManager = connectionManager;
    this.sessionManager = sessionManager;
    this.broadcastManager = broadcastManager;

    // Services (實例化)
    this.sessionService = SessionService;
    this.shareCodeService = ShareCodeService;
    this.pendingClientStateRequests = new Map();

    // 訊息處理器映射
    this.handlers = {
      [WS_PROTOCOL.C2S.AUTH]: this.handleAuth.bind(this),
      [WS_PROTOCOL.C2S.HEARTBEAT]: this.handleHeartbeat.bind(this),
      [WS_PROTOCOL.C2S.STATE_UPDATE]: this.handleStateUpdate.bind(this),
      [WS_PROTOCOL.C2S.EXPERIMENT_STATE_REGISTER]:
        this.handleExperimentStateRegister.bind(this),
      [WS_PROTOCOL.C2S.GET_SESSION_STATE]:
        this.handleGetSessionState.bind(this),
      [WS_PROTOCOL.C2S.CLIENT_STATE_RESPONSE]:
        this.handleClientStateResponse.bind(this),
      [WS_PROTOCOL.C2S.PING]: this.handlePing.bind(this),
      [WS_PROTOCOL.C2S.EXPERIMENT_ID_REGISTER]:
        this.handleExperimentIdRegister.bind(this),
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
      if (!type || typeof type !== "string" || type.length > 64) {
        throw new Error("訊息 type 欄位無效");
      }

      if (data !== undefined && (typeof data !== "object" || Array.isArray(data))) {
        throw new Error("訊息 data 欄位必須為物件");
      }

      // 防止超大字串欄位及深度嵌套物件（避免遞迴解析耗尽 CPU）
      if (data) {
        this._validateDataDepth(data, 0, 5);
      }

      const handler = this.handlers[type];
      if (!handler) {
        throw new Error(`未知的訊息類型: ${type}`);
      }

      await handler(wsConnectionId, data ?? {}, ws);
    } catch (error) {
      Logger.error(`處理訊息失敗 [${wsConnectionId}]: ${error.message}`);
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
    const { sessionId, clientId, role = ROLE.VIEWER, clientType } = data;

    // 驗證必要欄位
    if (!sessionId || !clientId) {
      throw new Error("認證失敗: 缺少 sessionId 或 clientId");
    }

    // 判斷是否為公開頻道
    const isPublicChannel = sessionId.startsWith(PUBLIC_CHANNEL_PREFIX);
    const resolvedRole = [ROLE.OPERATOR, ROLE.VIEWER].includes(role)
      ? role
      : ROLE.VIEWER;
    const normalizedClientType = normalizeClientType(clientType);

    try {
      if (isPublicChannel) {
        // 公開頻道：跳過 DB 驗證，直接進入記憶體工作階段
        Logger.event("cyan", "~", `公開頻道加入 | ${clientId} → ${sessionId}`);
      } else {
        // 私人工作階段：驗證 DB 記錄存在
        const session = this.sessionService.getSession(sessionId);
        if (!session) {
          Logger.warn(
            `工作階段不存在 [${sessionId}]，通知客戶端 [${wsConnectionId}] 清除本機數據`,
          );
          this.sendResponse(ws, WS_PROTOCOL.S2C.CLEAR_SYNC_DATA, {
            reason: "SESSION_NOT_FOUND",
            message: `工作階段不存在: ${sessionId}`,
          });
          throw new Error(`認證失敗: 工作階段不存在: ${sessionId}`);
        }
        if (!session.is_active) {
          throw new Error(`工作階段已失效: ${sessionId}`);
        }
      }

      let effectiveRole = resolvedRole;

      if (effectiveRole === ROLE.OPERATOR) {
        if (!normalizedClientType) {
          throw new Error("認證失敗: 操作者必須提供 clientType (panel 或 board)");
        }

        const conflict = findOperatorConflict(
          this.sessionManager,
          sessionId,
          normalizedClientType,
          clientId,
        );
        if (conflict) {
          throw new Error(
            `認證失敗: ${normalizedClientType} 操作者已存在 (${conflict.clientId})`,
          );
        }

        // Q3 寬鬆模式：clientId 不在 connectionManager 已知清單（非重連）
        // 且工作階段已有其他連線 → 可疑，降為 VIEWER 並記錄
        const isKnown = this.connectionManager.clientIdMap.has(clientId);
        if (!isKnown && !isPublicChannel) {
          const existingClients = this.sessionManager.getClients(sessionId);
          if (existingClients.length > 0) {
            Logger.warn(
              `未知 clientId 嘗試以 OPERATOR 加入非空工作階段，已降為 VIEWER | clientId=${clientId} session=${sessionId}`,
            );
            effectiveRole = ROLE.VIEWER;
          }
        }
      }

      // 在 ConnectionManager 中認證連線（會自動處理重新連線）
      const isReconnect = this.connectionManager.authenticate(
        wsConnectionId,
        clientId,
        sessionId,
      );

      // 加入工作階段（如果是重新連線，會更新 metadata）
      const sessionInfo = this.sessionManager.addClient(sessionId, clientId, {
        role: effectiveRole,
        clientType: normalizedClientType,
        isReconnect,
      });

      // 凁有私人工作階段才更新 DB 活動時間
      if (!isPublicChannel) {
        this.sessionService.updateLastActive(sessionId);
      }

      // 發送認證成功回應
      this.sendResponse(ws, WS_PROTOCOL.S2C.AUTH_SUCCESS, {
        sessionId,
        clientId,
        role: effectiveRole,
        clientType: normalizedClientType,
        sessionInfo,
        isReconnect,
        isPublicChannel,
      });

      // 只在首次加入時廣播（重新連線不廣播，避免重複通知）
      if (!isReconnect) {
        this.broadcastManager.broadcastClientJoined(sessionId, clientId, {
          role: effectiveRole,
          clientType: normalizedClientType,
        });
      } else {
        this.broadcastManager.broadcastToRoom(
          sessionId,
          {
            type: WS_PROTOCOL.S2C.CLIENT_RECONNECTED,
            data: { clientId, role: effectiveRole, clientType: normalizedClientType },
          },
          { excludeClientId: clientId },
        );
      }

      // 發送目前工作階段狀態給客戶端
      const currentState = this.getSessionState(sessionId);
      this.broadcastManager.sendToClient(clientId, {
        type: WS_PROTOCOL.S2C.SESSION_STATE,
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
    this.sendResponse(ws, WS_PROTOCOL.S2C.HEARTBEAT_ACK, {
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

      // 驗證角色：viewer 不可發送狀態更新
      const clientRole = this.sessionManager.getClientRole(sessionId, clientId);
      if (clientRole === ROLE.VIEWER) {
        Logger.warn(
          `拒絕 viewer 發送狀態更新 | clientId=${clientId} sessionId=${sessionId}`,
        );
        this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
          code: "PERMISSION_DENIED",
          message: "檢視者無法發送狀態更新",
        });
        return;
      }

      // 限制單一狀態物件大小，防止過大資料佔用記憶體與資料庫
      const stateJson = JSON.stringify(state);
      const MAX_STATE_BYTES = 512 * 1024; // 512 KB
      if (stateJson.length > MAX_STATE_BYTES) {
        Logger.warn(
          `拒絕過大狀態更新 | clientId=${clientId} size=${Math.round(stateJson.length / 1024)}KB`,
        );
        this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
          code: "STATE_TOO_LARGE",
          message: `狀態資料超過大小限制 (${Math.round(stateJson.length / 1024)} KB / 512 KB)`,
        });
        return;
      }

      // 電源狀態為即時揮發性資訊，不儲存至 experimentState（避免 session 恢復時意外開機）
      const isEphemeralState = state.type === "power_state_update";

      // 更新工作階段狀態（記憶體層：公開頻道與私人階段皆適用）
      if (!isEphemeralState) {
        this.sessionManager.setExperimentState(sessionId, state);
      }

      // 更新持久層（私人工作階段）
      if (!isEphemeralState && !sessionId.startsWith(PUBLIC_CHANNEL_PREFIX)) {
        try {
          this.sessionService.mergeState(sessionId, state);
          this.sessionService.updateLastActive(sessionId);
        } catch (e) {
          Logger.warn(`持久化狀態失敗，已略過: ${e.message}`);
        }
      }

      // 廣播狀態更新給房間內其他客戶端
      this.broadcastManager.broadcastSessionState(sessionId, state, {
        excludeClientId: clientId,
      });

      // 發送確認回應（stateUpdatedAt 讓客戶端感知是否被後來的更新覆蓋）
      const session = this.sessionManager.activeSessions.get(sessionId);
      this.sendResponse(ws, WS_PROTOCOL.S2C.STATE_UPDATE_ACK, {
        sessionId,
        timestamp: Date.now(),
        stateUpdatedAt: session?.stateUpdatedAt ?? Date.now(),
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

      // 為了讓客戶端在遺失訊息後能夠自動重建狀態，
      // 將 GET_SESSION_STATE 的回覆視為一次完整的同步狀態刷新。
      this.sendResponse(ws, WS_PROTOCOL.S2C.SYNC_STATE, state);
    } catch (error) {
      throw new Error(`取得狀態失敗: ${error.message}`);
    }
  }

  async requestClientState(clientId, timeoutMs = 5000) {
    if (!clientId) {
      throw new Error("缺少 clientId");
    }

    const ws = this.connectionManager.getConnectionByClientId(clientId);
    if (!ws || ws.readyState !== 1) {
      throw new Error(`客戶端 ${clientId} 未連線`);
    }

    const requestId = `req_client_state_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingClientStateRequests.delete(requestId);
        reject(new Error("等待客戶端回應逾時"));
      }, timeoutMs);

      this.pendingClientStateRequests.set(requestId, { resolve, reject, timeout });

      const sent = this.broadcastManager.sendToClient(clientId, {
        type: WS_PROTOCOL.S2C.REQUEST_CLIENT_STATE,
        data: { requestId },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingClientStateRequests.delete(requestId);
        reject(new Error(`無法發送請求給客戶端 ${clientId}`));
      }
    });
  }

  async handleClientStateResponse(wsConnectionId, data, ws) {
    const { requestId, state, error } = data || {};
    if (!requestId) {
      this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
        code: "INVALID_PARAMS",
        message: "缺少 requestId",
      });
      return;
    }

    const pending = this.pendingClientStateRequests.get(requestId);
    if (!pending) {
      Logger.warn(`收到未知的客戶端狀態回覆 requestId=${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingClientStateRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error.message || error || "客戶端回應錯誤"));
      return;
    }

    pending.resolve(state ?? {});
  }

  /**
   * 處理 Ping 訊息
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - 資料
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handlePing(wsConnectionId, data, ws) {
    this.sendResponse(ws, WS_PROTOCOL.S2C.PONG, {
      timestamp: Date.now(),
    });
  }

  /**
   * 取得工作階段完整狀態
   * @param {string} sessionId - 工作階段 ID
   * @returns {Object}
   */
  getSessionState(sessionId) {
    // 公開頻道：返回純記憶體狀態，無 DB 記錄
    if (sessionId.startsWith(PUBLIC_CHANNEL_PREFIX)) {
      const channelName = sessionId
        .replace(PUBLIC_CHANNEL_PREFIX, "")
        .replace("__", "");
      const sessionInfo = this.sessionManager.getSessionInfo(sessionId);
      const experimentState = this.sessionManager.getExperimentState(sessionId);
      return {
        sessionId,
        isPublicChannel: true,
        channelName,
        clients: sessionInfo ? sessionInfo.clients : [],
        state: experimentState || {},
        experimentState,
      };
    }

    // 私人工作階段：取得 DB 資料
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

    // 解析 session.data（支援舊格式直存 / 新格式 { lastState, experimentState }）
    let sessionData = {};
    try {
      sessionData =
        typeof session.data === "string"
          ? JSON.parse(session.data)
          : session.data || {};
    } catch (e) {
      Logger.warn(`_buildSessionState: session.data JSON 解析失敗 (${sessionId}):`, e.message);
    }

    // 優先從記憶體取得 experimentState（準確），必要時改用 DB
    const experimentState =
      this.sessionManager.getExperimentState(sessionId) ||
      sessionData.experimentState ||
      null;

    return {
      sessionId,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      lastActiveAt: session.last_active_at,
      isActive: session.is_active,
      clients: sessionInfo ? sessionInfo.clients : [],
      state: sessionData.lastState || sessionData.state || {},
      experimentState,
    };
  }

  /**
   * 取得狀態更新資訊摘要
   * @private
   */
  _getStateUpdateInfo(state) {
    switch (state.type) {
      case "participantNameUpdate":
        return ` | 受試者: <green>${state.participantName || "N/A"}</green>`;
      case "experimentIdUpdate":
        return ` | 實驗ID: <green>${state.experimentId || "N/A"}</green>`;
      case "combination_selected": {
        const combo = state.combination;
        if (typeof combo === "string") {
          return ` | 組合: <green>${combo || "N/A"}</green>`;
        }
        if (combo && typeof combo === "object") {
          if (combo.combinationName) {
            return ` | 組合: <green>${combo.combinationName}</green>`;
          }
          if (combo.combinationId) {
            return ` | 組合ID: <green>${combo.combinationId}</green>`;
          }
          return ` | 組合: <green>${JSON.stringify(combo)}</green>`;
        }
        return ` | 組合: <green>N/A</green>`;
      }
      case "experimentStateUpdate":
        return ` | 狀態: <green>${state.experimentState || "N/A"}</green>`;
      case "button_pressed":
        return ` | 按鈕: <green>${state.button || "N/A"}</green>`;
      case "action_completed":
        return ` | 動作: <green>${state.actionId || "N/A"}</green>`;
      case "step_completed":
        return ` | 步驟: <green>${state.step_id || "N/A"}</green>`;
      case "step_cancelled":
        return ` | 取消步驟: <green>${state.step_id || "N/A"}</green>`;
      default:
        return "";
    }
  }

  /**
   * 處理實驗 ID 登錄並廣播給同頻道所有人
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - 訊息資料，包含 experimentId
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleExperimentIdRegister(wsConnectionId, data, ws) {
    const { experimentId } = data || {};
    if (!experimentId) {
      this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
        code: "INVALID_PARAMS",
        message: "缺少 experimentId",
      });
      return;
    }
    const conn = this.connectionManager.connections.get(wsConnectionId);
    const sessionId = conn?.sessionId;
    const clientId = conn?.clientId;
    if (!sessionId) return;
    this.broadcastManager.broadcastExperimentIdUpdate(sessionId, experimentId, {
      excludeClientId: clientId,
    });

    // 同時持久化 experimentId 至工作階段狀態
    const currentExpState =
      this.sessionManager.getExperimentState(sessionId) || {};
    this.sessionManager.setExperimentState(sessionId, {
      ...currentExpState,
      registeredExperimentId: experimentId,
    });
    if (sessionId && !sessionId.startsWith(PUBLIC_CHANNEL_PREFIX)) {
      try {
        this.sessionService.mergeState(sessionId, {
          ...currentExpState,
          registeredExperimentId: experimentId,
        });
      } catch (e) {
        Logger.warn(`mergeState 失敗，實驗ID僅存於記憶體 (${sessionId}):`, e.message);
      }
    }

    Logger.debug(
      `實驗ID已廣播並持久化 | experimentId=${experimentId} session=${sessionId}`,
    );
  }

  /**
   * 註冊實驗狀態到中樞並廣播
   * @param {string} wsConnectionId - WebSocket 連線 ID
   * @param {Object} data - { state }
   * @param {WebSocket} ws - WebSocket 連線
   */
  async handleExperimentStateRegister(wsConnectionId, data, ws) {
    const { state } = data || {};
    if (!state) {
      this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
        code: "INVALID_PARAMS",
        message: "缺少 state",
      });
      return;
    }

    const conn = this.connectionManager.connections.get(wsConnectionId);
    const sessionId = conn?.sessionId;
    const clientId = conn?.clientId;

    if (!sessionId || !clientId) {
      this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
        code: "INVALID_SESSION",
        message: "工作階段不存在",
      });
      return;
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

    // 驗證客戶端角色：viewer 不可發送狀態
    const clientRole = this.sessionManager.getClientRole(sessionId, clientId);
    if (clientRole === ROLE.VIEWER) {
      this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
        code: "PERMISSION_DENIED",
        message: "檢視者無法註冊實驗狀態",
      });
      return;
    }

    // 記憶體層更新
    this.sessionManager.setExperimentState(sessionId, state);

    // 持久層更新（私人工作階段）
    if (!sessionId.startsWith(PUBLIC_CHANNEL_PREFIX)) {
      try {
        this.sessionService.mergeState(sessionId, state);
      } catch (e) {
        Logger.warn(`持久化實驗狀態失敗，已略過: ${e.message}`);
      }
    }

    // 廣播狀態更新（session_state_update）
    this.broadcastManager.broadcastSessionState(sessionId, state, {
      excludeClientId: clientId,
    });

    // 根據狀態類型轉發實驗事件（experiment_*）
    const eventType = this._resolveExperimentEventType(state);
    if (eventType) {
      this.broadcastManager.broadcastExperimentEvent(sessionId, eventType, {
        ...state,
        sessionId,
      });
    }
  }

  _validateDataDepth(obj, depth, maxDepth) {
    if (depth > maxDepth) {
      throw new Error(`訊息資料嵌套深度超過上限 (${maxDepth})`);
    }
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && val.length > 8192) {
        throw new Error(`欄位 ${key} 超過最大長度限制 (8192)`);
      }
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        this._validateDataDepth(val, depth + 1, maxDepth);
      }
    }
  }

  _resolveExperimentEventType(state) {
    if (!state) return null;
    const map = {
      experiment_started: "started",
      experiment_paused: "paused",
      experiment_resumed: "resumed",
      experiment_stopped: "stopped",
    };
    return map[state.type] || null;
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
    // 公開頻道：不需 DB 驗證，直接通過
    if (sessionId.startsWith(PUBLIC_CHANNEL_PREFIX)) {
      return { is_active: true, isPublicChannel: true };
    }
    try {
      const session = this.sessionService.getSession(sessionId);
      if (!session) {
        Logger.warn(
          `工作階段不存在，斷開連線: ${wsConnectionId} (session: ${sessionId})`,
        );
        this.connectionManager.unregister(wsConnectionId);
        this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
          message: "工作階段已過期，請重新加入",
        });
        return null;
      }

      if (!session.is_active) {
        Logger.warn(
          `工作階段已失效，斷開連線: ${wsConnectionId} (session: ${sessionId})`,
        );
        this.connectionManager.unregister(wsConnectionId);
        this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
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
    this.sendResponse(ws, WS_PROTOCOL.S2C.ERROR, {
      code,
      message,
    });
  }
}
