/**
 * SyncManager - 同步狀態協調入口。
 *
 * 負責還原與維持同步工作階段、管理連線檢查、轉發同步事件，
 * 並同步更新同步面板與狀態指示器。
 */
import { SyncManagerCore } from "./sync-manager-core.js";
import { SyncManagerUI } from "./sync-manager-ui.js";
import { SyncSessionsModal } from "./sync-sessions-modal.js";
import SyncConfirmDialogManager from "./sync-confirm-dialog.js";
import {
  SYNC_EVENTS,
  SYNC_MANAGER_CONSTANTS,
  SYNC_ROLE_CONFIG,
  SYNC_STATUS_CONFIG,
  SYNC_PAGE_CONFIG,
  SYNC_SESSION_STORAGE_KEYS,
  SYNC_ROLE_TEXTS,
  SYNC_MODE_TEXTS,
  SYNC_STATUS_TEXTS,
  SYNC_PAGE_LIST,
  getSyncRoleText,
  addSyncRoleText,
  getSyncStatusText,
  addSyncStatusText,
  getSyncPageName,
  getSyncPagePath,
  addSyncPage,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { IndicatorManager } from "./indicator-manager.js";

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) || null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {}
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {}
}

/**
 * 建立同步工作階段儲存介面。
 * 使用目前鍵名，供同步管理器還原、保存與清除狀態使用。
 * @param {Object} [param0={}]
 * @param {Storage} [param0.session=window.sessionStorage]
 * @param {Storage} [param0.local=window.localStorage]
 * @returns {{load: Function, save: Function, clear: Function}}
 */
function createSyncSessionStore({
  session = window.sessionStorage,
  local = window.localStorage,
} = {}) {
  const {
    SESSION_ID,
    CLIENT_ID,
    ROLE,
  } = SYNC_SESSION_STORAGE_KEYS;

  return {
    load() {
      const sessionId = safeGet(session, SESSION_ID);
      const clientId = safeGet(session, CLIENT_ID);
      const role = safeGet(session, ROLE);

      return {
        sessionId: sessionId || null,
        clientId: clientId || null,
        role: role || null,
      };
    },

    save({ sessionId, clientId, role } = {}) {
      safeSet(session, SESSION_ID, sessionId || "");
      safeSet(session, CLIENT_ID, clientId || "");
      safeSet(session, ROLE, role || SYNC_ROLE_CONFIG.LOCAL);
    },

    clear() {
      [SESSION_ID, CLIENT_ID, ROLE].forEach((key) => {
        safeRemove(session, key);
        safeRemove(local, key);
      });
    },
  };
}

class SyncManager {
  static ROLE = SYNC_ROLE_CONFIG;

  static STATUS = SYNC_STATUS_CONFIG;

  static ROLE_TEXTS = SYNC_ROLE_TEXTS;

  static MODE_TEXTS = SYNC_MODE_TEXTS;

  static STATUS_TEXTS = SYNC_STATUS_TEXTS;

  static PAGE = SYNC_PAGE_CONFIG;

  static PAGE_LIST = SYNC_PAGE_LIST;

  static getRoleText(role) {
    return getSyncRoleText(role);
  }

  static addRoleText(key, text) {
    if (!addSyncRoleText(key, text)) {
      Logger.warn("角色鍵名已存在，跳過新增:", key);
      return false;
    }
    return true;
  }

  static getStatusText(status) {
    return getSyncStatusText(status);
  }

  static addStatusText(key, text) {
    if (!addSyncStatusText(key, text)) {
      Logger.warn("狀態鍵名已存在，跳過新增:", key);
      return false;
    }
    return true;
  }

  /**
   * 取得頁面顯示名稱。
   * @param {string} pageKey - 頁面鍵名。
   * @returns {string}
   */
  static getPageName(pageKey) {
    return getSyncPageName(pageKey);
  }

  /**
   * 取得頁面路徑。
   * @param {string} pageKey - 頁面鍵名。
   * @returns {string}
   */
  static getPagePath(pageKey) {
    return getSyncPagePath(pageKey);
  }

  static addPage(key, name, path) {
    if (!addSyncPage(key, name, path)) {
      Logger.warn("頁面鍵名已存在，跳過新增:", key);
      return false;
    }
    return true;
  }

  constructor(config = {}) {
    this.experimentHubManager = null;
    this.indicatorManager =
      config.indicatorManager || new IndicatorManager();
    this.sessionStore = config.sessionStore || createSyncSessionStore();
    this.core = new SyncManagerCore({
      roleConfig: SyncManager.ROLE,
      pageConfig: SyncManager.PAGE,
      sessionStore: this.sessionStore,
    });
    this.indicatorManager?.updateDependencies?.({
      getStatus: () => this.core.syncClient?.getStatusText?.() || "idle",
      getStatusText: (status) => SyncManager.getStatusText(status),
    });
    SyncConfirmDialogManager.configure({
      syncManager: SyncManager,
      syncClientProvider: () => this.core.syncClient,
      indicatorManager: this.indicatorManager,
    });
    this.sessions = new SyncSessionsModal(this.core, {
      syncManager: SyncManager,
      roleConfig: SyncManager.ROLE,
      timeSyncManager: this.core?.timeSyncManager,
      indicatorManager: this.indicatorManager,
    });
    this.ui = new SyncManagerUI(this.core, {
      syncManager: SyncManager,
      roleConfig: SyncManager.ROLE,
      pageConfig: SyncManager.PAGE,
      statusConfig: SyncManager.STATUS,
      indicatorManager: this.indicatorManager,
    });
    this.connectionCheckTimer = null;
    this.serverOnline = null;
    this.isCheckingConnection = false;
    this.eventListeners = [];
    this.isSyncMode = null;
    this.initialized = false;
    this._isRestoring = false;
    this.initialize();
  }

  updateDependencies({ experimentHubManager } = {}) {
    if (experimentHubManager) {
      this.experimentHubManager = experimentHubManager;
    }
  }

  _addManagedListener(target, event, handler) {
    target.addEventListener(event, handler);
    this.eventListeners.push({ target, event, handler });
  }

  _finalizeClientInitialization(initStart, serverOnline) {
    this.initialized = true;
    this.serverOnline = serverOnline;

    if (this.ui?.initialized) {
      this.ui.updateIndicator();
    }

    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.CLIENT_INITIALIZED, {
        detail: { serverOnline },
      }),
    );

    const duration = performance.now() - initStart;
    Logger.debug(
      `初始化完成，已觸發 CLIENT_INITIALIZED 事件 (<orange>${duration.toFixed(0)} ms</orange>)`,
    );
  }

  initialize() {
    const initStart = performance.now();
    Logger.debug("開始初始化");

    Logger.debug("初始化同步 UI");
    this.ui.initialize();

    this.attemptSessionRestore()
      .then((isSync) => {
        this.isSyncMode = isSync;
        Logger.debug("工作階段還原檢查完成", {
          isSync,
          hasSessionId: !!this.core.syncClient.getSessionId?.(),
        });

        if (isSync) {
          this.sessions.initialize();
          this.ui.initialized = true;
          this.ui.updateIndicator();
        } else {
          this.core.syncClient.role = SyncManager.ROLE.LOCAL;
          Logger.debug("本機模式設定角色為 LOCAL");
          this.ui.initialized = true;
        }

        this.startConnectionCheck();
      })
      .catch((error) => {
        Logger.warn("工作階段還原過程中發生錯誤", error);

        this.isSyncMode = false;
        this.startConnectionCheck();
      });

    this.setupEventListeners();

    this.core
      .checkServerHealth()
      .then((online) => {
        Logger.debug("伺服器心跳檢測完成", { online });
        this._finalizeClientInitialization(initStart, online);
      })
      .catch((error) => {
        Logger.warn("伺服器心跳檢測失敗", error);
        this._finalizeClientInitialization(initStart, false);
      });

    const sessionJoinedDynamicHandler = () => {
      Logger.debug("工作階段已加入，初始化 Sessions 模組");

      if (!this.isSyncMode) {
        Logger.debug("動態初始化 Sessions（已加入工作階段）");
        this.isSyncMode = true;
        this.sessions.initialize();
        // 新裝置動態加入後啟動 5s 連線檢查，取代 SyncClient 的 30s 獨立 loop
        this.startConnectionCheck();
      }

      if (this.experimentHubManager?.hubClient?.tryConnect) {
        this.experimentHubManager.hubClient.tryConnect();
      }
    };
    this._addManagedListener(
      window,
      SYNC_EVENTS.SESSION_JOINED,
      sessionJoinedDynamicHandler,
    );

    const serverStatusHandler = (event) => {
      this.serverOnline = event.detail.online;
      // serverOnline 已由 WS 事件即時推送，此處只同步 SyncManager 自身的快取值
    };
    this._addManagedListener(
      window,
      SYNC_EVENTS.SERVER_STATUS_CHANGED,
      serverStatusHandler,
    );
  }

  async attemptSessionRestore() {
    try {
      const {
        sessionId,
        clientId,
        role,
      } = this.core.syncClient.getStoredSessionInfo();

      if (!sessionId || !clientId) {
        Logger.debug("沒有已儲存的工作階段，採用本機行為", {
          hasSessionId: !!sessionId,
          hasClientId: !!clientId,
        });
        return false;
      }

      Logger.debug("偵測到已儲存的工作階段，嘗試還原", {
        sessionId,
        clientId,
        role,
      });

      const isOnline = await this.core.checkServerHealth();
      if (!isOnline) {
        Logger.warn("伺服器離線，略過工作階段還原");
        return false;
      }

      try {
        const result = await this.core.syncClient.restoreSession(
          sessionId,
          clientId,
          role,
        );
        if (result && result.success !== false) {
          Logger.debug("工作階段還原成功", {
            sessionId,
            clientId,
          });

          const isPublicChannel = sessionId.startsWith(
            SYNC_MANAGER_CONSTANTS.PUBLIC_CHANNEL_PREFIX,
          );
          if (!isPublicChannel) {
            try {
              const sessionInfo =
                await this.core.syncClient.getSessionClients(sessionId);
              if (sessionInfo && sessionInfo.clients) {
                const clientList = sessionInfo.clients
                  .map((c) => `${c.id}(${c.role})`)
                  .join(", ");
                Logger.debug("工作階段客戶端列表", {
                  count: sessionInfo.clientCount,
                  clients: clientList,
                  state: sessionInfo.state ? "有狀態" : "無狀態",
                });
              }
            } catch (error) {
              Logger.warn("無法取得工作階段客戶端資訊:", error.message);
            }
          }

          window.dispatchEvent(
            new CustomEvent(SYNC_EVENTS.SESSION_JOINED, {
              detail: {
                sessionId,
                clientId,
                role: result.role || SyncManager.ROLE.VIEWER,
              },
            }),
          );

          this.ui?.updateIndicator?.();
          this.ui?.updateConnectedSessionInfo?.();

          return true;
        }
      } catch (error) {
        Logger.warn("工作階段還原失敗", error);
        this.core.syncClient.clearState();
        return false;
      }
    } catch (error) {
      Logger.error("還原工作階段出錯", error);
      return false;
    }
  }

  setupEventListeners() {
    const sessionJoinedHandler = () => {
      this.ui.updateIndicator();
      this.ui.updateConnectedSessionInfo();
    };
    this._addManagedListener(
      window,
      SYNC_EVENTS.SESSION_JOINED,
      sessionJoinedHandler,
    );

    const showPanelHandler = () => {
      this.ui.showPanel();
    };
    this._addManagedListener(
      window,
      SYNC_EVENTS.SHOW_SYNC_PANEL,
      showPanelHandler,
    );

    const stateChangeHandler = (event) => {
      this.syncState(event.detail);
    };
    this._addManagedListener(
      document,
      SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      stateChangeHandler,
    );

    const syncDataClearedHandler = (event) => {
      Logger.warn("監聽到 sync_data_cleared 事件", event.detail);

      const { reason, message } = event.detail || {};
      Logger.warn(`同步數據已清除 [${reason}]: ${message}`);

      this.isSyncMode = false;
      Logger.info("已切換為本機模式");

      this.ui?.hidePanel();
      this.ui?.updateIndicator();

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.DATA_CLEARED, {
          detail: { reason, message, timestamp: Date.now() },
        }),
      );
      Logger.info("已派發 SYNC_DATA_CLEARED 事件");
    };

    this._addManagedListener(
      window,
      SYNC_EVENTS.DATA_CLEARED,
      syncDataClearedHandler,
    );
    Logger.debug("已監聽 sync_data_cleared 事件");

    const disconnectedHandler = (event) => {
      Logger.warn(
        "收到 sync_disconnected，連線中斷，切換為本機模式",
        event.detail,
      );

      this.isSyncMode = false;

      if (this.core?.syncClient) {
        this.core.syncClient.role = SyncManager.ROLE.LOCAL;
      }

      this.ui?.hidePanel();
      this.ui?.updateIndicator();

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CONNECTION_LOST, {
          detail: event.detail || { reason: "disconnected" },
        }),
      );
      Logger.info("已派發 sync_connection_lost 事件");
    };

    this._addManagedListener(
      window,
      SYNC_EVENTS.DISCONNECTED,
      disconnectedHandler,
    );

    const connectedHandler = () => {
      if (this.isSyncMode || this._isRestoring) {
        Logger.debug("收到 sync_connected，但已在同步模式或正在還原中，跳過");
        return;
      }
      Logger.debug("收到 sync_connected，嘗試還原工作階段");
      this._isRestoring = true;
      this.attemptSessionRestore()
        .then((isSync) => {
          if (isSync) {
            this.isSyncMode = true;
            Logger.info("連線恢復且工作階段還原成功，回到同步模式");
            this.ui?.updateIndicator?.();
            window.dispatchEvent(
              new CustomEvent(SYNC_EVENTS.SESSION_RESTORED, {
                detail: { restored: true },
              }),
            );
          } else {
            Logger.debug("連線恢復但沒有可還原的工作階段，保持本機模式");
          }
        })
        .catch((err) => {
          Logger.error("嘗試還原工作階段失敗:", err);
        })
        .finally(() => {
          this._isRestoring = false;
        });
    };

    this._addManagedListener(window, SYNC_EVENTS.CONNECTED, connectedHandler);

    // 監聽瀏覽器原生網路事件，不依賴 polling 延遲（安卓切換 WiFi/4G 時特別有用）
    const networkOnlineHandler = () => {
      Logger.info("瀏覽器偵測到網路恢復（online 事件）");
      this.serverOnline = null; // 強制下次 checkConnection 重新驗證
      if (this.isSyncMode) {
        this.checkConnection();
      }
    };

    const networkOfflineHandler = () => {
      Logger.warn("瀏覽器偵測到網路中斷（offline 事件）");
      const wasOnline = this.serverOnline;
      this.serverOnline = false;
      if (wasOnline !== false) {
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.SERVER_STATUS_CHANGED, {
            detail: { online: false },
          }),
        );
        this.ui?.updateIndicator?.();
      }
    };

    this._addManagedListener(window, "online", networkOnlineHandler);
    this._addManagedListener(window, "offline", networkOfflineHandler);
  }

  startConnectionCheck() {
    if (!this.isSyncMode) {
      Logger.debug("本機模式，不啟動連線檢查");
      return;
    }

    // SyncClient 自己的獨立 loop 已不再需要，SyncManager 接管狀態感知
    this.core.syncClient?.stopHealthCheck?.();

    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
      this.connectionCheckTimer = null;
    }

    // serverOnline 現在由 WS 事件（_updateServerOnline）即時維護，
    // 不再需要 setInterval 輪詢。呼叫一次 checkConnection() 讓 indicator 反映當前狀態。
    void this.checkConnection();
  }

  async checkConnection() {
    if (!this.isSyncMode || !this.ui?.initialized) {
      return;
    }

    if (this.isCheckingConnection) {
      return;
    }

    // WS 已認證：直接更新 indicator，不需要 HTTP
    const wsAuthenticated = this.core.syncClient?.wsClient?.isAuthenticated === true;
    if (wsAuthenticated) {
      this.serverOnline = true;
      this.ui.updateIndicator();
      return;
    }

    // WS 斷線中：做一次 HTTP 確認，提供準確的離線狀態給 UI
    this.isCheckingConnection = true;
    try {
      await this.core.checkServerHealth();
      if (this.isSyncMode && this.ui?.initialized) {
        this.ui.updateIndicator();
      }
    } finally {
      this.isCheckingConnection = false;
    }
  }

  async syncState(state) {
    return await this.core.syncState(state);
  }

  getSessionId() {
    return this.core.getSessionId();
  }

  isConnected() {
    return this.core.isConnected();
  }

  getRole() {
    return this.core.getRole();
  }

  cleanup() {
    this.eventListeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });

    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }

    this.ui?.cleanup();
    this.sessions?.cleanup();
    this.core?.cleanup();

    Logger.debug("SyncManager 清理完成");
  }
}

export default SyncManager;
export { SyncManager };
