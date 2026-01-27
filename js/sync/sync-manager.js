/**
 * SyncManager - 多裝置同步管理器主入口
 *
 * 整合核心、UI、QR、Sessions 四個模組
 */
import { SyncManagerCore } from "./sync-manager-core.js";
import { SyncManagerUI } from "./sync-manager-ui.js";
import { SyncManagerQR } from "./sync-manager-qr.js";
import { SyncManagerSessions } from "./sync-manager-sessions.js";
import { SyncEvents } from "../core/sync-events-constants.js";

class SyncManager {
  // ========== 靜態常數 ==========
  /**
   * 角色鍵名常數
   */
  static ROLE = {
    VIEWER: "viewer",
    OPERATOR: "operator",
    LOCAL: "local",
  };

  /**
   * 狀態鍵名常數
   * 集中定義所有系統狀態鍵名，避免在代碼中硬編碼
   */
  static STATUS = {
    IDLE: "idle",
    OFFLINE: "offline",
    VIEWER: "viewer",
    OPERATOR: "operator",
  };

  /**
   * 角色身份文字常數
   * 集中定義所有角色身份的顯示文字
   * @static
   */
  static ROLE_TEXTS = {
    viewer: "檢視者", // 檢視者角色
    operator: "操作者", // 操作者角色
    local: "本機", // 本機專用角色
  };

  /**
   * 連線狀態文字常數
   * 集中定義所有連線狀態的顯示文字
   * @static
   */
  static STATUS_TEXTS = {
    idle: "未同步", // 未連線至工作階段
    viewer: "僅檢視", // 檢視者連線狀態
    operator: "同步中", // 操作者連線狀態
    offline: "已離線", // 伺服器已離線
  };

  /**
   * 頁面鍵名常數
   * 集中定義系統中可用的頁面鍵名
   */
  static PAGE = {
    PANEL: "panel",
    EXPERIMENT: "experiment",
  };

  /**
   * 頁面清單常數
   * 集中定義所有系統頁面的名稱和路徑
   * @static
   */
  static PAGE_LIST = {
    panel: {
      name: "機台面板", // 頁面顯示名稱
      path: "index.html", // 頁面路徑 (index.html kept for backward compatibility)
    },
    experiment: {
      name: "實驗管理", // 頁面顯示名稱
      path: "board.html", // 頁面路徑
    },
  };

  // ========== 靜態方法 - 角色文字 ==========
  /**
   * 取得角色身份文字
   * 根據角色鍵名回傳對應的顯示文字，若無法識別則回傳原值
   * @static
   * @param {string} role - 角色鍵名（如 "viewer"、"operator"）
   * @returns {string} 角色文字，預設回傳原值以防角色鍵名無法識別
   */
  static getRoleText(role) {
    if (!role) {
      Logger.warn("getRoleText 收到無效角色值:", role);
      return "未知角色";
    }
    return this.ROLE_TEXTS[role] || role;
  }

  /**
   * 新增新的角色身份類型（用於動態擴展）
   * @static
   * @param {string} key - 角色鍵名
   * @param {string} text - 顯示文字
   * @returns {boolean} 若新增成功回傳 true，若鍵名已存在回傳 false
   */
  static addRoleText(key, text) {
    if (this.ROLE_TEXTS.hasOwnProperty(key)) {
      Logger.warn("角色鍵名已存在，跳過新增:", key);
      return false;
    }
    this.ROLE_TEXTS[key] = text;
    return true;
  }

  // ========== 靜態方法 - 狀態文字 ==========
  /**
   * 取得連線狀態文字
   * 根據狀態鍵名回傳對應的顯示文字，若無法識別則回傳原值
   * @static
   * @param {string} status - 狀態鍵名（如 "idle"、"viewer"、"operator"、"offline"）
   * @returns {string} 狀態文字，預設回傳原值以防狀態鍵名無法識別
   */
  static getStatusText(status) {
    if (!status) {
      Logger.warn("getStatusText 收到無效狀態值:", status);
      return "未知狀態";
    }
    return this.STATUS_TEXTS[status] || status;
  }

  /**
   * 新增新的連線狀態類型（用於動態擴展）
   * @static
   * @param {string} key - 狀態鍵名
   * @param {string} text - 顯示文字
   * @returns {boolean} 若新增成功回傳 true，若鍵名已存在回傳 false
   */
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
   * 根據頁面鍵名回傳對應的顯示名稱，若無法識別則回傳原值
   * @static
   * @param {string} pageKey - 頁面鍵名（index 或 experiment）
   * @returns {string} 頁面顯示名稱
   */
  static getPageName(pageKey) {
    // 支援舊鍵名 'index' 的向後相容（對應到 PAGE.PANEL）
    const key = pageKey === "index" ? this.PAGE.PANEL : pageKey;
    return this.PAGE_LIST[key]?.name || pageKey;
  }

  /**
   * 取得頁面路徑
   * 根據頁面鍵名回傳對應的頁面路徑，若無法識別則回傳原值
   * @static
   * @param {string} pageKey - 頁面鍵名（panel 或 experiment）
   * @returns {string} 頁面路徑
   */
  static getPagePath(pageKey) {
    // 支援舊鍵名 'index' 的向後相容（對應到 PAGE.PANEL）
    const key = pageKey === "index" ? this.PAGE.PANEL : pageKey;
    return this.PAGE_LIST[key]?.path || pageKey;
  }

  /**
   * 新增新的頁面類型（用於動態擴展）
   * @static
   * @param {string} key - 頁面鍵名
   * @param {string} name - 頁面顯示名稱
   * @param {string} path - 頁面路徑
   * @returns {boolean} 若新增成功回傳 true，若鍵名已存在回傳 false
   */
  static addPage(key, name, path) {
    if (this.PAGE_LIST.hasOwnProperty(key)) {
      Logger.warn("頁面鍵名已存在，跳過新增:", key);
      return false;
    }
    this.PAGE_LIST[key] = { name, path };
    return true;
  }

  // ========== 實例方法 - 構造和初始化 ==========
  constructor() {
    this.core = new SyncManagerCore();
    this.ui = new SyncManagerUI(this.core);
    this.qr = new SyncManagerQR(this.core);
    this.sessions = new SyncManagerSessions(this.core);
    this.connectionCheckTimer = null;
    this.connectionCheckInterval = 5000; // 預設5秒檢查一次
    this.offlineCheckInterval = 20000; // 離線時20秒檢查一次
    this.serverOnline = null;
    this.isCheckingConnection = false; // 防止重疊檢查
    this.eventListeners = []; // 記錄所有事件監聽器，方便清理
    this.isSyncMode = null; // 記錄同步模式狀態 (null=未知, true=同步, false=本機)
    this.initialized = false; // 初始化完成標記
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
          Logger.info("進入同步模式 - 初始化完整 UI、QR、Sessions");
          // UI 的其他部分（控制面板、事件監聽等）
          this.ui.createControlPanel();
          this.ui.setupEventListeners();
          this.sessions.initialize();
          this.ui.initialized = true;
          // 同步模式下立即更新膠囊狀態（根據實際 role）
          this.ui.updateIndicator();
        } else {
          Logger.debug("進入本機模式 - 初始化控制面板以支援膠囊點擊");
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
          new CustomEvent(SyncEvents.CLIENT_INITIALIZED, {
            detail: { serverOnline: online },
          }),
        );

        Logger.debug("初始化完成，已觸發 CLIENT_INITIALIZED 事件");
      })
      .catch((error) => {
        Logger.warn("伺服器心跳檢測失敗", error);
        // 即使心跳檢測失敗，也觸發初始化完成事件
        window.dispatchEvent(
          new CustomEvent(SyncEvents.CLIENT_INITIALIZED, {
            detail: { serverOnline: false },
          }),
        );
      });

    // 當工作階段加入時，初始化 QR 和 Sessions 模組（動態進入同步模式）
    window.addEventListener(SyncEvents.SESSION_JOINED, () => {
      Logger.debug("工作階段已加入，初始化 QR 和 Sessions 模組");

      // 如果之前在本機模式，現在需要動態初始化 QR 和 Sessions
      if (this.isSyncMode === false) {
        Logger.info("動態進入同步模式 - 初始化 QR 和 Sessions");
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
      SyncEvents.SERVER_STATUS_CHANGED,
      serverStatusHandler,
    );
    this.eventListeners.push({
      target: window,
      event: SyncEvents.SERVER_STATUS_CHANGED,
      handler: serverStatusHandler,
    });
  }

  // ========== 實例方法 - 工作階段管理 ==========
  /**
   * 嘗試還原已儲存的工作階段連線
   * 當頁面重新整理時，如果有之前儲存的 sessionId，自動重新連線
   * @returns {Promise<boolean>} - true 表示同步模式，false 表示本機模式
   */
  async attemptSessionRestore() {
    try {
      // 從 sessionStorage 讀取（與 SyncClient 一致）
      const sessionId = sessionStorage.getItem("sync_sessionId");
      const clientId = sessionStorage.getItem("sync_clientId");
      const role =
        sessionStorage.getItem("sync_role") || SyncManager.ROLE.VIEWER;

      if (!sessionId || !clientId) {
        Logger.debug("沒有已儲存的工作階段，進入本機模式", {
          hasSessionId: !!sessionId,
          hasClientId: !!clientId,
        });
        return false; // 本機模式
      }

      Logger.debug("偵測到已儲存的工作階段，嘗試還原", {
        sessionId,
        clientId,
        role,
      });

      // 等待伺服器心跳檢測
      const isOnline = await this.core.checkServerHealth();
      if (!isOnline) {
        Logger.warn("伺服器離線，進入本機模式");
        return false; // 本機模式
      }

      // 嘗試恢復連線
      try {
        const result = await this.core.syncClient.restoreSession(
          sessionId,
          clientId,
          role, // 新增：傳遞儲存的角色
        );
        if (result && result.success !== false) {
          Logger.info("工作階段還原成功", {
            sessionId,
            clientId,
          });

          // 新增：從伺服器取得工作階段的完整客戶端資訊
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

          // 觸發工作階段還原事件
          window.dispatchEvent(
            new CustomEvent(SyncEvents.SESSION_JOINED, {
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
        Logger.warn("工作階段還原失敗，進入本機模式", error);
        // 清除無效的工作階段資訊
        localStorage.removeItem("sync_session_id");
        sessionStorage.removeItem("sync_sessionId");
        sessionStorage.removeItem("sync_clientId");
        sessionStorage.removeItem("sync_role");
        return false; // 本機模式
      }
    } catch (error) {
      Logger.error("還原工作階段出錯，進入本機模式", error);
      return false; // 本機模式
    }
  }

  // ========== 實例方法 - 事件監聽 ==========
  setupEventListeners() {
    const sessionJoinedHandler = () => {
      this.ui.updateIndicator();
      this.ui.updateConnectedSessionInfo();
    };
    window.addEventListener(SyncEvents.SESSION_JOINED, sessionJoinedHandler);
    this.eventListeners.push({
      target: window,
      event: SyncEvents.SESSION_JOINED,
      handler: sessionJoinedHandler,
    });

    const showPanelHandler = () => {
      this.ui.showPanel();
    };
    window.addEventListener(SyncEvents.SHOW_PANEL, showPanelHandler);
    this.eventListeners.push({
      target: window,
      event: SyncEvents.SHOW_PANEL,
      handler: showPanelHandler,
    });

    // 監聽實驗狀態變化事件，並將其同步到其他裝置
    const stateChangeHandler = (event) => {
      this.syncState(event.detail);
    };
    document.addEventListener("experimentStateChange", stateChangeHandler);
    this.eventListeners.push({
      target: document,
      event: "experimentStateChange",
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
        new CustomEvent(SyncEvents.DATA_CLEARED, {
          detail: { reason, message, timestamp: Date.now() },
        }),
      );
      Logger.info("已派發 SYNC_DATA_CLEARED 事件");
    };

    window.addEventListener("sync_data_cleared", syncDataClearedHandler);
    Logger.debug("已監聽 sync_data_cleared 事件");

    this.eventListeners.push({
      target: window,
      event: "sync_data_cleared",
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
        new CustomEvent("sync_connection_lost", {
          detail: event.detail || { reason: "disconnected" },
        }),
      );
      Logger.info("已派發 sync_connection_lost 事件");
    };

    window.addEventListener("sync_disconnected", disconnectedHandler);
    this.eventListeners.push({
      target: window,
      event: "sync_disconnected",
      handler: disconnectedHandler,
    });

    // 監聽 WebSocket 重新連線，嘗試還原工作階段
    const connectedHandler = (event) => {
      Logger.debug("收到 sync_connected，嘗試還原工作階段");
      this.attemptSessionRestore()
        .then((isSync) => {
          if (isSync) {
            this.isSyncMode = true;
            Logger.info("連線恢復且工作階段還原成功，回到同步模式");
            if (this.ui && this.ui.updateIndicator) this.ui.updateIndicator();
            window.dispatchEvent(
              new CustomEvent(SyncEvents.SESSION_RESTORED, {
                detail: { restored: true },
              }),
            );
          } else {
            Logger.debug("連線恢復但沒有可還原的工作階段，保持本機模式");
          }
        })
        .catch((err) => {
          Logger.error("嘗試還原工作階段失敗:", err);
        });
    };

    window.addEventListener("sync_connected", connectedHandler);
    this.eventListeners.push({
      target: window,
      event: "sync_connected",
      handler: connectedHandler,
    });
  }

  // ========== 實例方法 - 連線檢查 ==========
  startConnectionCheck() {
    // 只在同步模式下才啟動連線檢查
    if (this.isSyncMode === false) {
      Logger.debug("本機模式，不啟動連線檢查");
      return;
    }

    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }

    Logger.debug("啟動連線檢查，間隔", {
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
        `調整連線檢查間隔: ${
          this.connectionCheckInterval
        }ms → ${newInterval}ms (伺服器${this.serverOnline ? "線上" : "已離線"})`,
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

  // ========== 實例方法 - 狀態同步 ==========
  async syncState(state) {
    return await this.core.syncState(state);
  }

  // ========== 實例方法 - 查詢方法 ==========
  getSessionId() {
    return this.core.getSessionId();
  }

  isConnected() {
    return this.core.isConnected();
  }

  getRole() {
    return this.core.getRole();
  }

  // ========== 實例方法 - 清理 ==========
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
