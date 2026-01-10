/**
 * SyncManager - 多裝置同步管理器主入口
 * 整合核心、UI、QR、Sessions四個模組
 */
import SyncManagerCore from "./sync-manager-core.js";
import SyncManagerUI from "./sync-manager-ui.js";
import SyncManagerQR from "./sync-manager-qr.js";
import { SyncManagerSessions } from "./sync-manager-sessions.js";
import { SyncEvents } from "../core/sync-events-constants.js";

class SyncManager {
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
    Logger.debug("[SyncManager] 開始初始化");

    // 膠囊指示器總是被建立（本機模式也需要）
    Logger.debug("[SyncManager] 建立膠囊指示器");
    this.ui.createCapsuleIndicator();

    // 先嘗試還原工作階段，判斷是本機模式還是同步模式
    this.attemptSessionRestore()
      .then((isSync) => {
        this.isSyncMode = isSync; // 記錄模式狀態
        Logger.debug("[SyncManager] 工作階段還原檢查完成", {
          isSync,
          hasSessionId: !!this.core.syncClient.getSessionId?.(),
        });

        // 只在同步模式下初始化完整功能
        if (isSync) {
          Logger.info(
            "[SyncManager] 進入同步模式 - 初始化完整 UI、QR、Sessions"
          );
          // UI 的其他部分（控制面板、事件監聽等）
          this.ui.createControlPanel();
          this.ui.setupEventListeners();
          this.qr.initialize();
          this.sessions.initialize();
          this.ui.initialized = true;
          // 同步模式下立即更新膠囊狀態（根據實際 role）
          this.ui.updateIndicator();
        } else {
          Logger.debug(
            "[SyncManager] 進入本機模式 - 初始化控制面板以支援膠囊點擊"
          );
          // 本機模式下也需要初始化控制面板和事件監聽，讓膠囊可以點擊打開同步面板
          // 但不需要初始化 QR 和 Sessions
          this.ui.createControlPanel();
          this.ui.setupEventListeners();
          this.ui.initialized = true;
          // 膠囊根據 SyncClient.getStatusText() 自動顯示 "idle"（未同步）
        }

        // 無論模式如何，都檢查URL參數（處理分享連結進入）
        Logger.debug("[SyncManager] 檢查URL參數以處理分享連結");
        this.qr.initialize();

        // 模式確認後才啟動連線檢查
        this.startConnectionCheck();
      })
      .catch((error) => {
        Logger.warn("[SyncManager] 工作階段還原過程中發生錯誤", error);

        // 發生錯誤時預設為本機模式
        this.isSyncMode = false;
        this.startConnectionCheck();
      });

    this.setupEventListeners();

    // 標記初始化流程已啟動（在異步健康檢查前設置，避免競態條件）
    this.initialized = true;

    // 初始化時執行一次健康檢查並設定初始狀態
    this.core
      .checkServerHealth()
      .then((online) => {
        this.serverOnline = online;
        Logger.debug("[SyncManager] 伺服器健康檢查完成", { online });

        // 只在 UI 已初始化且存在時更新（同步模式）
        if (this.ui && this.ui.initialized) {
          Logger.debug("[SyncManager] UI 已初始化，更新指示器");
          this.ui.updateIndicator();
        } else if (this.ui && !this.ui.initialized) {
          Logger.debug("[SyncManager] UI 尚未初始化，暫不更新指示器");
        }

        // 初始化完成後，觸發事件讓日誌管理器知道 syncClient 已就緒
        window.dispatchEvent(
          new CustomEvent(SyncEvents.CLIENT_INITIALIZED, {
            detail: { serverOnline: online },
          })
        );

        Logger.debug(
          "[SyncManager] 初始化完成，已觸發 CLIENT_INITIALIZED 事件"
        );
      })
      .catch((error) => {
        Logger.warn("[SyncManager] 伺服器健康檢查失敗", error);
        // 即使健康檢查失敗，也觸發初始化完成事件
        window.dispatchEvent(
          new CustomEvent(SyncEvents.CLIENT_INITIALIZED, {
            detail: { serverOnline: false },
          })
        );
      });

    // 當工作階段加入時，初始化 QR 和 Sessions 模組（動態進入同步模式）
    window.addEventListener(SyncEvents.SESSION_JOINED, () => {
      Logger.debug("[SyncManager] 工作階段已加入，初始化 QR 和 Sessions 模組");

      // 如果之前在本機模式，現在需要動態初始化 QR 和 Sessions
      if (this.isSyncMode === false) {
        Logger.info("[SyncManager] 動態進入同步模式 - 初始化 QR 和 Sessions");
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
      serverStatusHandler
    );
    this.eventListeners.push({
      target: window,
      event: SyncEvents.SERVER_STATUS_CHANGED,
      handler: serverStatusHandler,
    });
  }

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
      const role = sessionStorage.getItem("sync_role") || "viewer";

      if (!sessionId || !clientId) {
        Logger.debug("[SyncManager] 沒有已儲存的工作階段，進入本機模式", {
          hasSessionId: !!sessionId,
          hasClientId: !!clientId,
        });
        return false; // 本機模式
      }

      Logger.debug("[SyncManager] 偵測到已儲存的工作階段，嘗試還原", {
        sessionId,
        clientId,
        role,
      });

      // 等待伺服器健康檢查
      const isOnline = await this.core.checkServerHealth();
      if (!isOnline) {
        Logger.warn("[SyncManager] 伺服器離線，進入本機模式");
        return false; // 本機模式
      }

      // 嘗試恢復連線
      try {
        const result = await this.core.syncClient.restoreSession(
          sessionId,
          clientId,
          role // 新增：傳遞儲存的角色
        );
        if (result && result.success !== false) {
          Logger.info("[SyncManager] 工作階段還原成功", {
            sessionId,
            clientId,
          });

          // 新增：從伺服器取得工作階段的完整客戶端資訊
          try {
            const sessionInfo = await this.core.syncClient.getSessionClients(
              sessionId
            );
            if (sessionInfo && sessionInfo.clients) {
              const clientList = sessionInfo.clients
                .map((c) => `${c.id}(${c.role})`)
                .join(", ");
              Logger.debug("[SyncManager] 工作階段客戶端列表", {
                count: sessionInfo.clientCount,
                clients: clientList,
                state: sessionInfo.state ? "有狀態" : "無狀態",
              });
            }
          } catch (error) {
            Logger.warn(
              "[SyncManager] 無法取得工作階段客戶端資訊:",
              error.message
            );
          }

          // 觸發工作階段還原事件
          window.dispatchEvent(
            new CustomEvent(SyncEvents.SESSION_JOINED, {
              detail: {
                sessionId,
                clientId,
                role: result.role || "viewer",
              },
            })
          );

          // 更新 UI（延遲初始化，但由於 initialize() 已做，這裡只是更新狀態）
          if (this.ui) {
            this.ui.updateIndicator();
            this.ui.updateConnectedSessionInfo();
          }

          return true; // 同步模式
        }
      } catch (error) {
        Logger.warn("[SyncManager] 工作階段還原失敗，進入本機模式", error);
        // 清除無效的工作階段資訊
        localStorage.removeItem("sync_session_id");
        return false; // 本機模式
      }
    } catch (error) {
      Logger.error("[SyncManager] 還原工作階段出錯，進入本機模式", error);
      return false; // 本機模式
    }
  }

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
  }

  startConnectionCheck() {
    // 只在同步模式下才啟動連線檢查
    if (this.isSyncMode === false) {
      Logger.debug("[SyncManager] 本機模式，不啟動連線檢查");
      return;
    }

    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }

    Logger.debug("[SyncManager] 啟動連線檢查，間隔", {
      interval: this.connectionCheckInterval,
    });

    this.connectionCheckTimer = setInterval(
      () => this.checkConnection(),
      this.connectionCheckInterval
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
        }ms → ${newInterval}ms (伺服器${this.serverOnline ? "線上" : "離線"})`
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

window.syncManager = new SyncManager();
// 暴露 syncClient 到全局，供其他模組使用（如實驗日誌管理器）
window.syncClient = window.syncManager.core.syncClient;
export default SyncManager;
