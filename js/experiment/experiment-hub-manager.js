/**
 * ExperimentHubManager - 實驗中樞管理器
 *
 * 負責管理實驗 ID（面板端、Hub 端、組合 ID）和同步模式（Local / Hub / Viewer），
 * 處理與中樞伺服器的通訊和事件通知，支援多裝置協同實驗。
 */

import {
  RECORD_SOURCES,
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  SYNC_ROLE_CONFIG,
  EXPERIMENT_HUB_CONSTANTS,
} from "../constants/index.js";
import { generateExperimentId } from "../core/random-utils.js";
import { Logger } from "../core/console-manager.js";
import { EventEmitter } from "../core/event-emitter.js";
import { WS_PROTOCOL } from "../../shared/ws-protocol-constants.js";

class ExperimentHubManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      apiBaseUrl: config.apiBaseUrl || this.getDefaultApiUrl(),
      autoReconnect:
        config.autoReconnect ?? EXPERIMENT_HUB_CONSTANTS.DEFAULTS.AUTO_RECONNECT,
      reconnectInterval:
        config.reconnectInterval ||
        EXPERIMENT_HUB_CONSTANTS.DEFAULTS.RECONNECT_INTERVAL_MS,
      ...config,
    };

    this.ids = {
      board: null,
      hub: null,
      experiment: null,
      combination: null,
    };

    this.connection = {
      mode: EXPERIMENT_HUB_CONSTANTS.MODE.LOCAL,
      connected: false,
      wsClient: null,
      role: null,
    };

    this.syncClientReady = false;
    this.reconnectTimer = null;
    this.syncManager = config.syncManager || null;
    this.syncClient = config.syncClient || null;
    this.experimentSyncCore = config.experimentSyncCore || null;
    this.roleConfig = {
      ...SYNC_ROLE_CONFIG,
      ...config.roleConfig,
    };

    this.initialize();
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 初始化管理器
   */
  initialize() {
    this.restoreIds();

    if (this.syncManager) {
      this.waitForSyncClient();
    }

    Logger.debug("ExperimentHubManager 初始化完成", {
      mode: this.connection.mode,
      ids: this.ids,
    });
  }

  /**
   * 取得預設 API URL
   */
  getDefaultApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const basePath = this.getApiBasePath();
    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 API 路徑前綴
   */
  getApiBasePath() {
    const pathname = window.location.pathname;
    let basePath = pathname;

    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    return basePath + "api";
  }

  /**
  * 設定面板端 ID
   */
  setBoardId(id, options = {}) {
    const oldId = this.ids.board;
    this.ids.board = id;

    if (!options.silent) {
      this.saveIds();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ID_CHANGED, {
        type: "board",
        oldValue: oldId,
        newValue: id,
      });
    }

    Logger.debug("面板端 ID 已設定", id);
    return id;
  }

  /**
  * 取得面板端 ID
   */
  getBoardId() {
    return this.ids.board;
  }

  /**
   * 設定 Hub ID
   */
  setHubId(id, options = {}) {
    const oldId = this.ids.hub;
    this.ids.hub = id;

    if (!options.silent) {
      this.saveIds();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ID_CHANGED, {
        type: "hub",
        oldValue: oldId,
        newValue: id,
      });
    }

    Logger.debug("Hub ID 已設定", id);
    return id;
  }

  /**
   * 取得 Hub ID
   */
  getHubId() {
    return this.ids.hub;
  }

  /**
   * 設定實驗 ID
   */
  setExperimentId(id, source = RECORD_SOURCES.LOCAL_INPUT, options = {}) {
    const oldId = this.ids.experiment;
    this.ids.experiment = id;

    if (!options.silent) {
      this.saveIds();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ID_CHANGED, {
        type: "experiment",
        oldValue: oldId,
        newValue: id,
        source: source,
      });

      if (
        this.isHubMode() &&
        this.connection.connected &&
        source !== RECORD_SOURCES.SYNC_BROADCAST &&
        source !== RECORD_SOURCES.HUB_SYNC
      ) {
        this.syncExperimentIdToHub(id, source);
      }
    }

    Logger.debug("實驗 ID 已設定", { id, source });
    return id;
  }

  /**
   * 取得實驗 ID
   */
  getExperimentId() {
    return this.ids.experiment;
  }

  /**
   * 設定組合 ID
   */
  setCombinationId(id, options = {}) {
    const oldId = this.ids.combination;
    this.ids.combination = id;

    if (!options.silent) {
      this.saveIds();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ID_CHANGED, {
        type: "combination",
        oldValue: oldId,
        newValue: id,
      });
    }

    Logger.debug("組合 ID 已設定", id);
    return id;
  }

  /**
   * 取得組合 ID
   */
  getCombinationId() {
    return this.ids.combination;
  }

  /**
   * 產生新的實驗 ID
   * 使用前端格式：6位大寫英數字
   * 範例: "JHWH4A"
   */
  generateExperimentId() {
    const id = generateExperimentId();
    this.setExperimentId(id, RECORD_SOURCES.LOCAL_GENERATE);
    return id;
  }

  /**
   * 註冊實驗 ID 到伺服器
   * 僅在同步模式下發送到伺服器
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<boolean>} 註冊是否成功
   */
  async registerExperimentId(experimentId) {
    try {
      if (!this.isSyncMode()) {
        Logger.debug("非同步模式，跳過實驗 ID 註冊", experimentId);
        return false;
      }

      if (!experimentId) {
        Logger.warn("無效的實驗 ID，跳過註冊");
        return false;
      }

      Logger.debug("開始註冊實驗 ID 到伺服器", experimentId);

      if (this.connection.wsClient && this.connection.connected) {
        const message = {
          type: EXPERIMENT_HUB_CONSTANTS.MESSAGE_TYPES.EXPERIMENT_ID_REGISTER,
          data: {
            experimentId: experimentId,
            timestamp: Date.now(),
          },
        };

        this.connection.wsClient.send(message);
        Logger.debug("實驗 ID 註冊訊息已發送", message);
        return true;
      } else {
        Logger.warn("WebSocket 未連接，無法註冊實驗 ID");
        return false;
      }
    } catch (error) {
      Logger.error("註冊實驗 ID 失敗:", error);
      return false;
    }
  }

  /**
   * 註冊實驗狀態到伺服器（同步模式）
   * @param {Object} state - 實驗狀態資料
   * @returns {Promise<boolean>} 是否成功
   */
  async registerExperimentState(state) {
    try {
      if (!this.isSyncMode()) {
        return false;
      }

      if (!state || typeof state !== "object") {
        Logger.warn("無效的實驗狀態，跳過註冊");
        return false;
      }

      if (!this.connection.wsClient || !this.connection.connected) {
        Logger.warn("WebSocket 未連接，無法註冊實驗狀態");
        return false;
      }

      const message = {
        type: WS_PROTOCOL.C2S.EXPERIMENT_STATE_REGISTER,
        data: {
          state: {
            ...state,
            clientId: state.clientId || this.getClientId(),
            timestamp: state.timestamp || new Date().toISOString(),
          },
        },
      };

      this.connection.wsClient.send(message);
      Logger.debug("實驗狀態註冊訊息已發送", message);
      return true;
    } catch (error) {
      Logger.error("註冊實驗狀態失敗:", error);
      return false;
    }
  }

  /**
   * 檢查是否為同步模式
   * @returns {boolean} 是否為同步模式
   */
  isSyncMode() {
    return this.syncManager?.isSyncMode === true;
  }

  /**
   * 驗證 ID 有效性
   */
  validateId(id, type = "experiment") {
    if (!id || typeof id !== "string") {
      return { valid: false, error: "ID 必須是字串" };
    }

    if (id.trim().length === 0) {
      return { valid: false, error: "ID 不能為空" };
    }

    switch (type) {
      case "experiment":
        if (!/^[A-Z0-9]{6}$/.test(id) && !/^[A-Za-z0-9_-]+$/.test(id)) {
          return { valid: false, error: "實驗 ID 格式不正確" };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * 重置所有 ID
   */
  resetIds(options = {}) {
    const oldIds = { ...this.ids };

    this.ids = {
      board: null,
      hub: null,
      experiment: null,
      combination: null,
    };

    if (!options.silent) {
      this.saveIds();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ID_CHANGED, {
        type: "all",
        oldValue: oldIds,
        newValue: this.ids,
      });
    }

    Logger.debug("所有 ID 已重置");
  }

  /**
   * 儲存 ID 到 localStorage
   */
  saveIds() {
    try {
      localStorage.setItem(
        EXPERIMENT_HUB_CONSTANTS.STORAGE_KEY,
        JSON.stringify(this.ids),
      );
    } catch (error) {
      Logger.error("儲存 ID 失敗", error);
    }
  }

  /**
   * 從 localStorage 恢復 ID
   */
  restoreIds() {
    try {
      const saved = localStorage.getItem(EXPERIMENT_HUB_CONSTANTS.STORAGE_KEY);
      if (saved) {
        const ids = JSON.parse(saved);
        this.ids = { ...this.ids, ...ids };
        Logger.debug("已從 localStorage 還原 ID", this.ids);
      }
    } catch (error) {
      Logger.error("還原 ID 失敗", error);
    }
  }

  /**
   * 取得目前模式
   */
  getMode() {
    return this.connection.mode;
  }

  /**
   * 檢查是否為本機模式
   */
  isLocalMode() {
    return this.connection.mode === EXPERIMENT_HUB_CONSTANTS.MODE.LOCAL;
  }

  /**
   * 檢查是否處於同步模式（非本機模式）
   */
  isInSyncMode() {
    return !this.isLocalMode();
  }

  /**
   * 檢查是否為 Hub 模式
   */
  isHubMode() {
    return this.connection.mode === EXPERIMENT_HUB_CONSTANTS.MODE.HUB;
  }

  /**
   * 檢查是否為檢視模式
   */
  isViewerMode() {
    return this.connection.mode === EXPERIMENT_HUB_CONSTANTS.MODE.VIEWER;
  }

  /**
   * 切換到 Hub 模式
   */
  async switchToHubMode() {
    if (this.isHubMode()) {
      Logger.debug("已經是 Hub 模式");
      return true;
    }

    const oldMode = this.connection.mode;
    this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.HUB;

    this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.MODE_CHANGED, {
      oldMode,
      newMode: this.connection.mode,
    });

    Logger.info("已切換到 Hub 模式");

    if (!this.connection.connected) {
      await this.connect();
    }

    return true;
  }

  /**
   * 切換到本機模式
   */
  switchToLocalMode() {
    if (this.isLocalMode()) {
      Logger.debug("已經是本機模式");
      return true;
    }

    const oldMode = this.connection.mode;
    this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.LOCAL;

    this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.MODE_CHANGED, {
      oldMode,
      newMode: this.connection.mode,
    });

    Logger.info("已切換到本機模式");

    if (this.connection.connected) {
      this.disconnect();
    }

    return true;
  }

  /**
   * 設定檢視模式
   */
  setViewerMode(isViewer) {
    const oldMode = this.connection.mode;

    if (isViewer) {
      this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.VIEWER;
    } else if (this.connection.connected) {
      this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.HUB;
    } else {
      this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.LOCAL;
    }

    if (oldMode !== this.connection.mode) {
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.MODE_CHANGED, {
        oldMode,
        newMode: this.connection.mode,
      });

      Logger.info("模式已變更", {
        from: oldMode,
        to: this.connection.mode,
      });
    }
  }

  /**
   * 等待 SyncClient 就緒
   */
  waitForSyncClient() {
    if (this.syncClientReady) return;

    const checkInterval = setInterval(() => {
      if (this.syncClient || this.syncManager?.core?.syncClient) {
        clearInterval(checkInterval);
        this.onSyncClientReady();
      }
    }, EXPERIMENT_HUB_CONSTANTS.DEFAULTS.SYNC_CLIENT_READY_POLL_INTERVAL_MS);

    setTimeout(() => {
      clearInterval(checkInterval);
      if (!this.syncClientReady) {
        Logger.warn("SyncClient 就緒超時");
      }
    }, EXPERIMENT_HUB_CONSTANTS.DEFAULTS.SYNC_CLIENT_READY_TIMEOUT_MS);
  }

  /**
   * SyncClient 就緒回調
   */
  onSyncClientReady() {
    Logger.debug("[HubManager] SyncClient 就緒");
    this.syncClientReady = true;

    const syncClient =
      this.syncClient || this.syncManager?.core?.syncClient;
    this.syncClient = syncClient;
    this.connection.wsClient = syncClient?.wsClient || null;

    if (!syncClient) {
      Logger.warn("SyncClient 尚未就緒，跳過 Hub 註冊");
      return;
    }

    this.setupEventHandlers();

    this.hydrateExperimentIdFromSessionState();

    if (syncClient?.isConnected?.()) {
      this.connection.connected = true;
      this.connection.role = syncClient.getRole();
      this.updateModeFromRole();
    }
  }

  /**
   * 從 SyncClient 最近一次工作階段快照還原 experimentId，避免初始化時序造成值遺失
   */
  hydrateExperimentIdFromSessionState() {
    const snapshot = this.syncClient?.getLatestSessionState?.();
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    const experimentState = snapshot.experimentState;
    const topState = snapshot.state;
    const restoredExperimentId =
      experimentState?.experimentId ||
      experimentState?.registeredExperimentId ||
      topState?.experimentId ||
      topState?.registeredExperimentId ||
      null;

    if (typeof restoredExperimentId !== "string") {
      return;
    }

    const normalized = restoredExperimentId.trim();
    if (!normalized || this.getExperimentId() === normalized) {
      return;
    }

    this.setExperimentId(normalized, RECORD_SOURCES.HUB_SYNC, {
      silent: false,
    });
    Logger.debug("從工作階段快照還原實驗 ID", normalized);
  }

  /**
   * 設定 WebSocket 事件處理器
   */
  setupEventHandlers() {
    if (!this.connection.wsClient) return;

    const ws = this.connection.wsClient;

    ws.on(EXPERIMENT_HUB_CONSTANTS.WS_CLIENT_EVENTS.AUTHENTICATED, (data) => {
      this.connection.connected = true;
      this.connection.role = data.role;
      this.updateModeFromRole();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.CONNECTED, data);
      Logger.debug("[HubManager] WebSocket 已認證", data);
    });

    ws.on(EXPERIMENT_HUB_CONSTANTS.WS_CLIENT_EVENTS.DISCONNECTED, () => {
      this.connection.connected = false;
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.DISCONNECTED);
      Logger.warn("[HubManager] WebSocket 已斷線");

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    });

    ws.on(EXPERIMENT_HUB_CONSTANTS.WS_CLIENT_EVENTS.RECONNECTED, (data) => {
      this.connection.connected = true;
      this.connection.role = data.role;
      this.updateModeFromRole();
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.CONNECTED, data);
      Logger.info("[HubManager] WebSocket 已重新連線", data);
    });

    ws.on(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, (data) => {
      Logger.debug("收到實驗 ID 更新", data);
      if (data.clientId !== this.getClientId()) {
        this.setExperimentId(data.experimentId, RECORD_SOURCES.SYNC_BROADCAST, { silent: false });
        this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.MESSAGE_RECEIVED, {
          type: SYNC_EVENTS.EXPERIMENT_ID_CHANGED,
          data,
        });
      }
    });

    [
      SYNC_EVENTS.EXPERIMENT_STARTED,
      SYNC_EVENTS.EXPERIMENT_PAUSED,
      SYNC_EVENTS.EXPERIMENT_RESUMED,
      SYNC_EVENTS.EXPERIMENT_STOPPED,
    ].forEach((eventName) => {
      ws.on(eventName, (data) => {
        Logger.debug(`收到 ${eventName}`, data);

        if (eventName === SYNC_EVENTS.EXPERIMENT_STARTED) {
          this.handleExperimentStartedBroadcast(data);
        }

        this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.MESSAGE_RECEIVED, {
          type: eventName,
          data,
        });
      });
    });
  }

  /**
   * 處理實驗開始事件的廣播轉發
   * 確保所有連接的客戶端都能收到實驗開始通知
   * @param {Object} data - 實驗開始事件資料
   */
  handleExperimentStartedBroadcast(data) {
    try {
      Logger.debug("處理實驗開始廣播轉發", data);

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STARTED, {
          detail: {
            ...data,
            broadcasted: true,
            timestamp: Date.now(),
          },
        }),
      );

      if (this.connection.role === SYNC_ROLE_CONFIG.OPERATOR) {
        Logger.debug("操作者收到實驗開始廣播，更新本機狀態");
      }
    } catch (error) {
      Logger.error("處理實驗開始廣播轉發失敗:", error);
    }
  }

  /**
   * 根據角色更新模式
   */
  updateModeFromRole() {
    const role = this.connection.role;
    if (role === this.roleConfig.VIEWER) {
      this.setViewerMode(true);
    } else if (this.connection.connected) {
      this.connection.mode = EXPERIMENT_HUB_CONSTANTS.MODE.HUB;
    }
  }

  /**
   * 連接到 Hub
   */
  async connect() {
    if (this.connection.connected) {
      Logger.debug("已經連接到 Hub");
      return true;
    }

    if (!this.syncClientReady) {
      Logger.warn("SyncClient 尚未就緒");
      return false;
    }

    Logger.debug("等待 Hub 連接...");
    return true;
  }

  /**
   * 斷開與 Hub 的連接
   */
  disconnect() {
    if (!this.connection.connected) {
      Logger.debug("已經斷開連接");
      return;
    }

    this.connection.connected = false;
    this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.DISCONNECTED);
    Logger.info("已斷開 Hub 連接");
  }

  /**
   * 發送訊息到 Hub
   */
  sendMessage(type, data) {
    if (!this.connection.connected) {
      Logger.warn("未連接到 Hub，無法發送訊息");
      return false;
    }

    if (!this.connection.wsClient) {
      Logger.error("WebSocket 客戶端不存在");
      return false;
    }

    try {
      this.connection.wsClient.emit(type, data);
      Logger.debug("已發送訊息到 Hub", { type, data });
      return true;
    } catch (error) {
      Logger.error("發送訊息失敗", error);
      this.emit(EXPERIMENT_HUB_CONSTANTS.EVENT.ERROR, {
        type: EXPERIMENT_HUB_CONSTANTS.MESSAGE_TYPES.SEND_FAILED,
        error,
      });
      return false;
    }
  }

  /**
   * 同步實驗 ID 到 Hub
   */
  syncExperimentIdToHub(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    const data = {
      experimentId,
      source,
      clientId: this.getClientId(),
      timestamp: Date.now(),
    };

    const syncClient = this.syncClient;
    if (syncClient?.syncState) {
      const updateData = {
        type: SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE,
        clientId: syncClient?.clientId,
        timestamp: Date.now(),
        ...data,
      };

      if (!this.experimentSyncCore?.safeBroadcast) {
        Logger.warn("experimentSyncCore 未 inject，改用 Hub 訊息同步");
        this.sendMessage(
          EXPERIMENT_HUB_CONSTANTS.MESSAGE_TYPES.EXPERIMENT_ID_UPDATE,
          data,
        );
        return;
      }

      this.experimentSyncCore.safeBroadcast(updateData).catch((error) => {
        Logger.warn("同步實驗 ID 更新失敗:", error);
      });
      Logger.debug("實驗 ID 已廣播", experimentId);
    } else {
      this.sendMessage(
        EXPERIMENT_HUB_CONSTANTS.MESSAGE_TYPES.EXPERIMENT_ID_UPDATE,
        data,
      );
    }
  }

  /**
   * 查詢連接狀態
   */
  isConnected() {
    return this.connection.connected;
  }

  /**
   * 取得客戶端 ID
   */
  getClientId() {
    return this.syncClient?.clientId || EXPERIMENT_HUB_CONSTANTS.DEFAULTS.CLIENT_ID;
  }

  /**
   * 排程重新連接
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      Logger.info("嘗試重新連接到 Hub...");
      this.connect();
    }, this.config.reconnectInterval);
  }

  /**
   * 取得管理器狀態
   */
  getState() {
    return {
      ids: { ...this.ids },
      connection: {
        mode: this.connection.mode,
        connected: this.connection.connected,
        role: this.connection.role,
      },
      config: { ...this.config },
    };
  }

  /**
   * 銷毀管理器
   */
  destroy() {
    this.disconnect();
    this.clearListeners();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    Logger.debug("ExperimentHubManager 已銷毀");
  }
}

export default ExperimentHubManager;
export { ExperimentHubManager };
