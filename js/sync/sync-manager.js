/**
 * SyncManager - 多裝置同步管理器主入口
 *
 * 整合核心、UI、QR、Sessions 四個模組
 */
import { SyncManagerCore } from "./sync-manager-core.js";
import { SyncManagerUI } from "./sync-manager-ui.js";
import { SyncManagerQR } from "./sync-manager-qr.js";
import { SyncManagerSessions } from "./sync-manager-sessions.js";
import { SYNC_EVENTS } from "../constants/index.js";

class SyncManager {
  static ROLE = {
    VIEWER: "viewer",
    OPERATOR: "operator",
    LOCAL: "local",
  };

  static STATUS = {
    IDLE: "idle",
    OFFLINE: "offline",
    VIEWER: "viewer",
    OPERATOR: "operator",
  };

  static ROLE_TEXTS = {
    viewer: "檢視者",
    operator: "操作者",
    local: "本機",
  };

  static MODE_TEXTS = {
    viewer: "檢視模式",
    operator: "同步操作",
  };

  static STATUS_TEXTS = {
    idle: "未同步",
    viewer: "檢視中",
    operator: "同步中",
    offline: "已離線",
  };

  static PAGE = {
    PANEL: "panel",
    BOARD: "board",
  };

  static PAGE_LIST = {
    panel: {
      name: "機台面板",
      path: "index.html",
    },
    board: {
      name: "實驗管理",
      path: "board.html",
    },
  };

  static getRoleText(role) {
    return this.ROLE_TEXTS[role] || role;
  }

  static addRoleText(key, text) {
    if (this.ROLE_TEXTS.hasOwnProperty(key)) {
      Logger.warn("角色鍵名已存在，跳過新增:", key);
      return false;
    }
    this.ROLE_TEXTS[key] = text;
    return true;
  }

  static getStatusText(status) {
    return this.STATUS_TEXTS[status] || status;
  }

  static addStatusText(key, text) {
    if (this.STATUS_TEXTS.hasOwnProperty(key)) {
      Logger.warn("狀態鍵名已存在，跳過新增:", key);
      return false;
    }
    this.STATUS_TEXTS[key] = text;
    return true;
  }

  // ========== 靜態方法 - 頁面清單 ==========
  /**
   * 取得頁面名稱
   * @param {string} pageKey - 頁面鍵名
   * @returns {string} 頁面顯示名稱
   */
  static getPageName(pageKey) {
    return this.PAGE_LIST[pageKey]?.name || pageKey;
  }

  /**
   * 取得頁面路徑
   * @param {string} pageKey - 頁面鍵名
   * @returns {string} 頁面路徑
   */
  static getPagePath(pageKey) {
    return this.PAGE_LIST[pageKey]?.path || pageKey;
  }

  static addPage(key, name, path) {
    if (this.PAGE_LIST.hasOwnProperty(key)) {
      Logger.warn("頁面鍵名已存在，跳過新增:", key);
      return false;
    }
    this.PAGE_LIST[key] = { name, path };
    return true;
  }

  constructor() {
    this.core = new SyncManagerCore();
    this.ui = new SyncManagerUI(this.core);
    this.qr = new SyncManagerQR(this.core);
    this.sessions = new SyncManagerSessions(this.core);
    this.connectionCheckTimer = null;
    this.connectionCheckInterval = 5000;
    this.offlineCheckInterval = 20000;
    this.serverOnline = null;
    this.isCheckingConnection = false;
    this.eventListeners = [];
    this.isSyncMode = null;
    this.initialized = false;
    this.initialize();
  }

  initialize() {
    Logger.debug("開始初始化");

    // 膠囊指示器總是被建立（本機模式也需要）
    Logger.debug("建立膠囊指示器");
    this.ui.createCapsuleIndicator();

    // 先嘗試還原工作階段，判斷是本機模式還是同步模式
    this.attemptSessionRestore()
      .then((isSync) => {
        this.isSyncMode = isSync; // 記錄模式狀態
        Logger.debug("工作階段還原檢查完成", {
          isSync,
          hasSessionId: !!this.core.syncClient.getSessionId?.(),
        });

        // 只在同步模式下初始化完整功能
        if (isSync) {
          this.ui.createControlPanel();
          this.ui.setupEventListeners();
          this.sessions.initialize();
          this.ui.initialized = true;
          // 同步模式下立即更新膠囊狀態（根據實際 role）
          this.ui.updateIndicator();
        } else {
          // 本機模式下設定角色為 LOCAL
          this.core.syncClient.role = SyncManager.ROLE.LOCAL;
          Logger.debug("本機模式設定角色為 LOCAL");
          // 本機模式下也需要初始化控制面板和事件監聽，讓膠囊可以點擊打開同步面板
          // 但不需要初始化 QR 和 Sessions
          this.ui.createControlPanel();
          this.ui.setupEventListeners();
          this.ui.initialized = true;
          // 膠囊根據 SyncClient.getStatusText() 自動顯示 "idle"（未同步）
        }

        // 無論模式如何，都檢查URL參數（處理分享連結進入）
        Logger.debug("檢查URL參數以處理分享連結");
        this.qr.initialize();

        // 模式確認後才啟動連線檢查
        this.startConnectionCheck();
      })
      .catch((error) => {
        Logger.warn("工作階段還原過程中發生錯誤", error);

        // 發生錯誤時預設為本機模式
        this.isSyncMode = false;
        this.startConnectionCheck();
      });

    this.setupEventListeners();

    // 標記初始化流程已啟動（在異步心跳檢測前設置，避免競態條件）
    this.initialized = true;

    // 初始化時執行一次心跳檢測並設定初始狀態
    this.core
      .checkServerHealth()
      .then((online) => {
        this.serverOnline = online;
        Logger.debug("伺服器心跳檢測完成", { online });

        // 只在 UI 已初始化且存在時更新（同步模式）
        if (this.ui && this.ui.initialized) {
          Logger.debug("UI 已初始化，更新指示器");
          this.ui.updateIndicator();
        } else if (this.ui && !this.ui.initialized) {
          Logger.debug("UI 尚未初始化，略過更新指示器");
        }

        // 初始化完成後，觸發事件讓日誌管理器知道 syncClient 已就緒
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.CLIENT_INITIALIZED, {
            detail: { serverOnline: online },
          }),
        );

        Logger.debug("初始化完成，已觸發 CLIENT_INITIALIZED 事件");
      })
      .catch((error) => {
        Logger.warn("伺服器心跳檢測失敗", error);
        // 即使心跳檢測失敗，也觸發初始化完成事件
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.CLIENT_INITIALIZED, {
            detail: { serverOnline: false },
          }),
        );
      });

    // 當工作階段加入時，初始化 QR 和 Sessions 模組（動態進入同步）
    window.addEventListener(SYNC_EVENTS.SESSION_JOINED, () => {
      Logger.debug("工作階段已加入，初始化 QR 和 Sessions 模組");

      // 如果之前在本機模式，現在需要動態初始化 QR 和 Sessions
      if (this.isSyncMode === false) {
        Logger.debug("動態初始化 QR 與 Sessions（已加入工作階段）");
        this.isSyncMode = true;
        this.qr.initialize();
        this.sessions.initialize();
      }

      // 通知 ExperimentHubClient 可以連線
      if (window.experimentHubManager?.hubClient?.tryConnect) {
        window.experimentHubManager.hubClient.tryConnect();
      }
    });

    // 監聽伺服器狀態變化
    const serverStatusHandler = (event) => {
      const wasOnline = this.serverOnline;
      this.serverOnline = event.detail.online;

      // 如果狀態改變，調整檢查頻率
      if (wasOnline !== this.serverOnline) {
        this.adjustConnectionCheckInterval();
      }
    };
    window.addEventListener(
      SYNC_EVENTS.SERVER_STATUS_CHANGED,
      serverStatusHandler,
    );
    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.SERVER_STATUS_CHANGED,
      handler: serverStatusHandler,
    });
  }

  async attemptSessionRestore() {
    try {
      const sessionId = sessionStorage.getItem("sync_sessionId");
      const clientId = sessionStorage.getItem("sync_clientId");
      const role =
        sessionStorage.getItem("sync_role") || SyncManager.ROLE.VIEWER;

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

      // 等待伺服器心跳檢測
      const isOnline = await this.core.checkServerHealth();
      if (!isOnline) {
        Logger.warn("伺服器離線，採用本機 fallback");
        return false; // 本機模式
      }

      // 嘗試恢復連線
      try {
        const result = await this.core.syncClient.restoreSession(
          sessionId,
          clientId,
          role,
        );
        if (result && result.success !== false) {
          Logger.info("工作階段還原成功", {
            sessionId,
            clientId,
          });

          // 從伺服器取得工作階段的完整客戶端資訊（公開頻道無 DB session，跳過）
          const isPublicChannel = sessionId.startsWith("__CH_");
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

          // 觸發工作階段還原事件
          window.dispatchEvent(
            new CustomEvent(SYNC_EVENTS.SESSION_JOINED, {
              detail: {
                sessionId,
                clientId,
                role: result.role || SyncManager.ROLE.VIEWER,
              },
            }),
          );

          // 更新 UI（延遲初始化，但由於 initialize() 已做，這裡只是更新狀態）
          if (this.ui) {
            this.ui.updateIndicator();
            this.ui.updateConnectedSessionInfo();
          }

          return true; // 同步模式
        }
      } catch (error) {
        Logger.warn("工作階段還原失敗，採用本機 fallback", error);
        // 清除無效的工作階段資訊
        localStorage.removeItem("sync_session_id");
        sessionStorage.removeItem("sync_sessionId");
        sessionStorage.removeItem("sync_clientId");
        sessionStorage.removeItem("sync_role");
        return false; // 本機模式
      }
    } catch (error) {
      Logger.error("還原工作階段出錯，採用本機 fallback", error);
      return false; // 本機模式
    }
  }

  setupEventListeners() {
    const sessionJoinedHandler = () => {
      this.ui.updateIndicator();
      this.ui.updateConnectedSessionInfo();
    };
    window.addEventListener(SYNC_EVENTS.SESSION_JOINED, sessionJoinedHandler);
    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.SESSION_JOINED,
      handler: sessionJoinedHandler,
    });

    const showPanelHandler = () => {
      this.ui.showPanel();
    };
    window.addEventListener(SYNC_EVENTS.SHOW_SYNC_PANEL, showPanelHandler);
    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.SHOW_SYNC_PANEL,
      handler: showPanelHandler,
    });

    // 監聽實驗狀態變化事件，並將其同步到其他裝置
    const stateChangeHandler = (event) => {
      this.syncState(event.detail);
    };
    document.addEventListener(
      SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      stateChangeHandler,
    );
    this.eventListeners.push({
      target: document,
      event: SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      handler: stateChangeHandler,
    });

    // 監聽同步數據清除事件（工作階段不存在時）
    const syncDataClearedHandler = (event) => {
      Logger.warn("監聽到 sync_data_cleared 事件", event.detail);

      const { reason, message } = event.detail || {};
      Logger.warn(`同步數據已清除 [${reason}]: ${message}`);

      // 重置為本機模式
      this.isSyncMode = false;
      Logger.info("已切換為本機模式");

      // 隱藏同步面板
      if (this.ui && this.ui.hidePanel) {
        Logger.debug("隱藏同步面板");
        this.ui.hidePanel();
      }

      // 更新膠囊指示器為離線狀態
      if (this.ui && this.ui.updateIndicator) {
        Logger.debug("更新膠囊指示器為離線狀態");
        this.ui.updateIndicator();
      }

      // 觸發事件通知其他模組同步已清除
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.DATA_CLEARED, {
          detail: { reason, message, timestamp: Date.now() },
        }),
      );
      Logger.info("已派發 SYNC_DATA_CLEARED 事件");
    };

    window.addEventListener(SYNC_EVENTS.DATA_CLEARED, syncDataClearedHandler);
    Logger.debug("已監聽 sync_data_cleared 事件");

    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.DATA_CLEARED,
      handler: syncDataClearedHandler,
    });

    // 監聽 WebSocket 斷線事件，切換為本機模式（保留 session 資訊以便還原）
    const disconnectedHandler = (event) => {
      Logger.warn(
        "收到 sync_disconnected，連線中斷，切換為本機模式",
        event.detail,
      );

      // 標記為本機模式（不清除 sessionStorage）
      this.isSyncMode = false;

      // 將 SyncClient 角色設為 LOCAL，讓 UI 與按鈕回復本機行為
      if (this.core && this.core.syncClient) {
        this.core.syncClient.role = SyncManager.ROLE.LOCAL;
      }

      // 隱藏同步面板並更新指示器
      if (this.ui && this.ui.hidePanel) {
        this.ui.hidePanel();
      }
      if (this.ui && this.ui.updateIndicator) {
        this.ui.updateIndicator();
      }

      // 通知其他模組：連線中斷（保留 session 以便還原）
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.CONNECTION_LOST, {
          detail: event.detail || { reason: "disconnected" },
        }),
      );
      Logger.info("已派發 sync_connection_lost 事件");
    };

    window.addEventListener(SYNC_EVENTS.DISCONNECTED, disconnectedHandler);
    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.DISCONNECTED,
      handler: disconnectedHandler,
    });

    // 監聯 WebSocket 重新連線，嘗試還原工作階段
    // 注意：sync_connected 在首次認證成功時也會觸發，
    // 此時已經處於連線狀態，不需要再次還原。
    const connectedHandler = (event) => {
      // 如果已在同步模式或正在還原中，跳過避免重複 connect 造成迴圈
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
            if (this.ui && this.ui.updateIndicator) this.ui.updateIndicator();
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

    window.addEventListener(SYNC_EVENTS.CONNECTED, connectedHandler);
    this.eventListeners.push({
      target: window,
      event: SYNC_EVENTS.CONNECTED,
      handler: connectedHandler,
    });
  }

  startConnectionCheck() {
    if (this.isSyncMode === false) {
      Logger.debug("本機模式，不啟動連線檢查");
      return;
    }

    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }

    Logger.debug("啟動連線檢查", {
      interval: this.connectionCheckInterval,
    });

    this.connectionCheckTimer = setInterval(
      () => this.checkConnection(),
      this.connectionCheckInterval,
    );
  }

  adjustConnectionCheckInterval() {
    const newInterval =
      this.serverOnline === false
        ? this.offlineCheckInterval
        : this.connectionCheckInterval;

    if (newInterval !== this.connectionCheckInterval) {
      Logger.info(
        `調整連線檢查間隔: ${this.connectionCheckInterval}ms → ${newInterval}ms (伺服器${this.serverOnline ? "線上" : "已離線"})`,
      );
      this.connectionCheckInterval = newInterval;
      this.startConnectionCheck();
    }
  }

  async checkConnection() {
    // 在本機模式或 UI 未初始化時，跳過連線檢查
    if (this.isSyncMode === false || !this.ui.initialized) {
      return;
    }

    if (this.isCheckingConnection) {
      return; // 如果正在檢查中，跳過
    }

    this.isCheckingConnection = true;
    try {
      await this.core.checkConnection();
      // 只有在同步模式且 UI 已初始化時才更新指示器
      if (this.isSyncMode === true && this.ui && this.ui.initialized) {
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
    this.ui.cleanup();
    this.qr.cleanup();
    this.sessions.cleanup();
    this.core.cleanup();
  }
}

window.SyncManager = SyncManager;
window.syncManager = new SyncManager();
// 暴露 syncClient 到全局，供其他模組使用（如實驗日誌管理器）
window.syncClient = window.syncManager.core.syncClient;
export { SyncManager }; // 使用命名匯出以維持一致性
