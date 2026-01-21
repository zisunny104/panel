// main.js - 應用程式主初始化與協調模組

class MainApp {
  constructor() {
    this.initializationComplete = false;
    this.modules = {};
  }

  // 初始化所有模組
  async initialize() {
    // 防止重複初始化
    if (this.initializationComplete) {
      Logger.warn("MainApp 已經初始化，跳過重複動作");
      return;
    }

    try {
      // 等待 DOM 完全載入
      if (document.readyState !== "complete") {
        await new Promise((resolve) =>
          window.addEventListener("load", resolve, { once: true }),
        );
      }

      // 第一優先級：確保 SyncManager 完全初始化
      // SyncManager 在 sync-manager.js 底部自動初始化，但需要等待初始化完成
      Logger.debug("[MainApp] 等待 SyncManager 初始化完成...");

      await new Promise((resolve) => {
        let resolved = false;

        // 先檢查是否已經初始化（避免錯過事件觸發）
        if (window.syncManager?.initialized) {
          Logger.debug(
            "[MainApp] SyncManager 已初始化（檢查標記）",
            window.syncManager?.core?.syncClient?.sessionId
              ? `同步模式 (sessionId: ${window.syncManager.core.syncClient.sessionId})`
              : "本機模式",
          );
          resolve();
          return;
        }

        // 監聽 CLIENT_INITIALIZED 事件（SyncManager 初始化完成後觸發）
        const handleClientInit = (event) => {
          if (!resolved) {
            resolved = true;
            Logger.debug(
              "[MainApp] SyncManager 已就緒（收到 CLIENT_INITIALIZED 事件）",
              window.syncManager?.core?.syncClient?.sessionId
                ? `同步模式 (sessionId: ${window.syncManager.core.syncClient.sessionId})`
                : "本機模式",
            );
            resolve();
          }
        };

        window.addEventListener("sync:client-initialized", handleClientInit, {
          once: true,
        });

        // 設置超時保護（最多等 10 秒）
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            Logger.warn("[MainApp] 等待 SyncManager 超時（10秒），繼續初始化");
            window.removeEventListener(
              "sync:client-initialized",
              handleClientInit,
            );
            resolve();
          }
        }, 10000);
      });

      // 並行初始化時間同步和設定（相互獨立，可提前完成）
      const timeSyncPromise = window.timeSyncManager
        ? (async () => {
            Logger.debug("開始時間同步初始化...");
            await window.timeSyncManager.initialize();
            Logger.info("時間同步已初始化");
          })()
        : Promise.resolve();

      const configPromise = (async () => {
        // ConfigManager 已在 config.js 中初始化，這裡只需要載入初始設定
        await this.loadInitialSettings();
      })();

      // 等待時間同步和設定完成
      await Promise.all([timeSyncPromise, configPromise]);

      // 初始化各個模組
      this.createModules(); // 建立模組
      await this.initializeModules(); // 初始化核心模組
      this.setupModuleDependencies(); // 設定模組間依賴

      // 注意：SyncManager 已在 sync-manager.js 底部自動初始化
      // 不需要在此重複建立，直接使用全局的 window.syncManager
      Logger.debug("SyncManager 已由 sync-manager.js 自動初始化");

      // 初始化 Experiment Hub Manager - 等待完成以避免後續模組等待超時
      if (!window.experimentHubManager) {
        try {
          Logger.debug("[MainApp] 開始初始化 ExperimentHubManager...");
          const { initializeExperimentHub } =
            await import("../sync/experiment-hub-manager.js");

          // 設置初始化超時（5秒）
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error("ExperimentHubManager 初始化超時 (5秒)"));
            }, 5000),
          );

          window.experimentHubManager = await Promise.race([
            initializeExperimentHub(),
            timeoutPromise,
          ]);

          Logger.info("ExperimentHubManager 已初始化（全域單一實例）", {
            syncMode: window.experimentHubManager.isInSyncMode(),
          });
        } catch (error) {
          Logger.warn("ExperimentHubManager 初始化失敗或超時:", error.message);
          // 建立備用實例，以保證系統繼續運作
          if (!window.experimentHubManager) {
            Logger.debug("[MainApp] 建立備用 ExperimentHubManager 實例");
            const { ExperimentHubManager } =
              await import("../sync/experiment-hub-manager.js");
            window.experimentHubManager = new ExperimentHubManager();
          }
        }
      } else {
        Logger.debug("ExperimentHubManager 已存在，使用現有實例");
      }

      this.initializationComplete = true;
      this.setupExperimentPanelButtonColor();
    } catch (error) {
      this.handleError(error, "初始化");
    }
  }

  // 根據實驗狀態切換 experimentPanelButton 底色
  setupExperimentPanelButtonColor() {
    // 初始狀態
    this.setExperimentPanelButtonColor("default");
    // 讓全域可以存取這個實例
    window.mainApp = this;
  }

  // 直接用 JS 切換 experimentPanelButton 底色
  setExperimentPanelButtonColor(status) {
    const btn = document.getElementById("experimentPanelButton");
    if (!btn) {
      // 在 experiment.html 等沒有此按鈕的頁面中，靜默跳過
      return;
    }
    if (status === "running") {
      btn.style.setProperty("background", "#27ae60", "important"); // 綠色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    } else if (status === "paused") {
      btn.style.setProperty("background", "#f39c12", "important"); // 橘色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    } else {
      btn.style.setProperty("background", "#888", "important"); // 灰色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    }
  }

  // 建立模組
  createModules() {
    this.modules = {
      config: window.configManager,
      uiControls: window.uiControls,
      buttonManager: window.buttonManager,
      mediaManager: window.mediaManager,
      logger: window.logger,
      experiment: window.panelExperiment, // 修正：使用正確的實驗管理器
      powerControl: window.powerControl,
      syncManager: window.syncManager || {},
    };

    // 建立動作管理器實例以支援action-based實驗
    this.createActionManager();

    // 將同步管理器設為全域可存取
    window.syncManager = this.modules.syncManager;
  }

  // 初始化各個模組
  async initializeModules() {
    // 設定管理器
    if (this.modules.config) {
      await this.modules.config.loadConfigSettings();
      this.modules.config.setupEventListeners();
    }
    // UI 控制
    if (this.modules.uiControls) {
      this.modules.uiControls.initializeUIState();
    }
    // 按鈕管理器
    if (this.modules.buttonManager) {
      await this.modules.buttonManager.loadButtonFunctions();
    }
    // 電源控制
    if (this.modules.powerControl) {
      this.modules.powerControl.initialize();
    }
    // 日誌系統、實驗管理器已在構造函數初始化

    // 在背景預先載入媒體檔案（不會阻塞初始化）
    this.preloadMediaInBackground();
  }

  /**
   * 在背景預先載入媒體檔案
   */
  async preloadMediaInBackground() {
    try {
      // 延遲一下再開始預先載入，避免影響初始載入性能
      setTimeout(async () => {
        if (
          window.mediaManager &&
          typeof window.mediaManager.preloadAllMedia === "function"
        ) {
          await window.mediaManager.preloadAllMedia();
        }
      }, 2000); // 2秒後開始預先載入
    } catch (error) {
      Logger.warn("背景媒體預先載入失敗:", error);
    }
  }

  // 設定模組間依賴（可擴充）
  setupModuleDependencies() {
    // 監聽同步狀態更新事件 - 用於虛擬面板接收實驗狀態
    window.addEventListener("sync_state_update", (event) => {
      const state = event.detail;
      if (state && state.type === "experiment_started") {
        this.handleSyncExperimentStart(state);
      }
      //處理暫停同步訊號
      else if (state && state.type === "experiment_paused") {
        this.handleSyncExperimentPaused(state);
      }
      //處理繼續同步訊號
      else if (state && state.type === "experiment_resumed") {
        this.handleSyncExperimentResumed(state);
      }
      //處理停止同步訊號
      else if (state && state.type === "experiment_stopped") {
        this.handleSyncExperimentStopped(state);
      }
      //處理實驗ID更新訊號
      else if (state && state.type === "experimentIdUpdate") {
        this.handleSyncExperimentIdUpdate(state);
      }
    });
  }

  // 處理同步的實驗開始狀態
  handleSyncExperimentStart(syncData) {
    const source = syncData.source || "unknown";

    // 更新面板的實驗資訊（如果有實驗 ID）
    const expIdInput = document.getElementById("experimentIdInput");
    const subjectInput = document.getElementById("subjectName");

    if (expIdInput && syncData.experiment_id) {
      expIdInput.value = syncData.experiment_id;
    }
    if (subjectInput && syncData.subject_name) {
      subjectInput.value = syncData.subject_name;
    }

    //優先檢查是否在 experiment.html（有 experimentPageManager）
    if (this.modules.experimentPageManager) {
      const isRunning =
        this.modules.experimentPageManager.experimentRunning ||
        this.modules.experimentPageManager.state?.running ||
        false;

      if (!isRunning) {
        // 直接調用實驗管理器的方法
        if (
          typeof this.modules.experimentPageManager.startExperiment ===
          "function"
        ) {
          try {
            this.modules.experimentPageManager.startExperiment();
          } catch (error) {
            Logger.error("[MainApp] 直接調用失敗:", error);
          }
        }
      }
    }
    //檢查是否在 index.html（有 panelExperiment 的 PanelExperimentManager）
    else if (
      window.panelExperiment &&
      typeof window.panelExperiment.startExperiment === "function"
    ) {
      // 檢查實驗是否已在執行
      const isRunning = window.panelExperiment.isExperimentRunning || false;

      if (!isRunning) {
        try {
          window.panelExperiment.startExperiment();
        } catch (error) {
          Logger.error(
            "[MainApp] panelExperiment.startExperiment() 失敗:",
            error,
          );
        }
      }
    } else {
      Logger.warn("[MainApp]找不到有效的實驗管理器");
    }

    // 記錄這個同步事件到日誌
    if (this.modules.logger) {
      const deviceId = localStorage.getItem("sync_client_id") || "unknown";
      this.modules.logger.logAction(
        `[同步] 實驗開始訊號來自: ${source}`,
        null,
        "handleSyncExperimentStart",
        false,
        false,
        false,
        null,
        { device_id: deviceId, source: source },
      );
    }
  }

  //處理同步的實驗暫停狀態
  handleSyncExperimentPaused(syncData) {
    const source = syncData.source || "unknown";

    // 優先檢查是否在 experiment.html
    if (this.modules.experimentPageManager) {
      if (
        typeof this.modules.experimentPageManager.pauseExperiment === "function"
      ) {
        try {
          this.modules.experimentPageManager.togglePauseExperiment();
        } catch (error) {
          Logger.error("[MainApp] 暫停實驗失敗:", error);
        }
      }
    }
    // 檢查是否在 index.html
    else if (
      window.panelExperiment &&
      typeof window.panelExperiment.pauseExperiment === "function"
    ) {
      try {
        window.panelExperiment.togglePauseExperiment();
      } catch (error) {
        Logger.error(
          "[MainApp] panelExperiment.togglePauseExperiment() 失敗:",
          error,
        );
      }
    }

    // 記錄到日誌
    if (this.modules.logger) {
      const deviceId = localStorage.getItem("sync_client_id") || "unknown";
      this.modules.logger.logAction(
        `[同步] 實驗暫停訊號來自: ${source}`,
        null,
        "handleSyncExperimentPaused",
        false,
        false,
        false,
        null,
        { device_id: deviceId, source: source },
      );
    }
  }

  //處理同步的實驗還原狀態
  handleSyncExperimentResumed(syncData) {
    const source = syncData.source || "unknown";

    // 優先檢查是否在 experiment.html
    if (this.modules.experimentPageManager) {
      if (
        typeof this.modules.experimentPageManager.resumeExperiment ===
        "function"
      ) {
        try {
          this.modules.experimentPageManager.togglePauseExperiment();
        } catch (error) {
          Logger.error("[MainApp] 還原實驗失敗:", error);
        }
      }
    }
    // 檢查是否在 index.html
    else if (
      window.panelExperiment &&
      typeof window.panelExperiment.stopExperiment === "function"
    ) {
      try {
        window.panelExperiment.togglePauseExperiment();
      } catch (error) {
        Logger.error(
          "[MainApp] panelExperiment.togglePauseExperiment() 失敗:",
          error,
        );
      }
    }

    // 記錄到日誌
    if (this.modules.logger) {
      const deviceId = localStorage.getItem("sync_client_id") || "unknown";
      this.modules.logger.logAction(
        `[同步] 實驗還原訊號來自: ${source}`,
        null,
        "handleSyncExperimentResumed",
        false,
        false,
        false,
        null,
        { device_id: deviceId, source: source },
      );
    }
  }

  //處理同步的實驗停止狀態
  handleSyncExperimentStopped(syncData) {
    const source = syncData.source || "unknown";

    // 優先檢查是否在 experiment.html
    if (this.modules.experimentPageManager) {
      if (
        typeof this.modules.experimentPageManager.stopExperiment === "function"
      ) {
        try {
          //響應遠端停止訊號時不廣播（false = 不廣播）
          this.modules.experimentPageManager.stopExperiment(false);
        } catch (error) {
          Logger.error("[MainApp] 停止實驗失敗:", error);
        }
      }
    }
    // 檢查是否在 index.html
    else if (
      window.panelExperiment &&
      typeof window.panelExperiment.stopExperiment === "function"
    ) {
      try {
        //響應遠端停止訊號時不廣播（false = 不廣播）
        window.panelExperiment.stopExperiment(false);
      } catch (error) {
        Loggererror("[MainApp] panelExperiment.stopExperiment() 失敗:", error);
      }
    }
  }

  //處理同步的實驗ID更新
  handleSyncExperimentIdUpdate(syncData) {
    const { experimentId, timestamp } = syncData;

    // 更新機台面板上的實驗ID
    const expIdInput = document.getElementById("experimentIdInput");
    if (expIdInput && experimentId && expIdInput.value !== experimentId) {
      expIdInput.value = experimentId;

      // 分派事件通知其他模組（如果需要）
      document.dispatchEvent(
        new CustomEvent("experimentIdChanged", {
          detail: { experimentId, timestamp },
        }),
      );
    }
  }

  // 載入初始設定
  async loadInitialSettings() {
    // Logger 顯示狀態
    const showLogger = localStorage.getItem("showLogger");
    const loggerMinimized = localStorage.getItem("loggerMinimized");
    if (this.modules.logger) {
      if (showLogger === "true") {
        loggerMinimized === "true"
          ? this.modules.logger.minimizeLogger()
          : this.modules.logger.showLoggerPanel();
      } else {
        this.modules.logger.hideLoggerPanel();
      }
    }
    // 隱藏參考卡片與設定面板
    const refCard = document.getElementById("refCard");
    const settingsPanel = document.getElementById("settingsPanel");
    if (refCard) refCard.style.display = "none";
    if (settingsPanel) settingsPanel.classList.add("hidden");
  }

  // 取得模組實例
  getModule(name) {
    return this.modules[name];
  }

  // 檢查初始化狀態
  isInitialized() {
    return this.initializationComplete;
  }

  // 重新載入設定
  async reloadConfig() {
    if (this.modules.config) {
      await this.modules.config.loadConfigSettings();
    }
  }

  // 重設應用程式狀態
  reset() {
    if (this.modules.logger) this.modules.logger.clearLog();
    if (this.modules.mediaManager) this.modules.mediaManager.reset();
    if (this.modules.buttonManager) {
      this.modules.buttonManager.clearButtonFunctions();
      this.modules.buttonManager.loadButtonFunctions();
    }
    if (this.modules.powerControl) {
      this.modules.powerControl.isPowerOn = false;
      this.modules.powerControl.isPowerVideoPlaying = false;
      this.modules.powerControl.updatePowerUIWithoutSync(); // 重置時不觸發同步事件
    }
    if (
      this.modules.experiment &&
      this.modules.experiment.isExperimentRunning
    ) {
      //重置時不廣播（false = 不廣播）
      this.modules.experiment.stopExperiment(false);
    }
  }

  // 錯誤處理
  handleError(error, context = "") {
    Logger.error(`錯誤 ${context}:`, error);
    if (this.modules.logger) {
      this.modules.logger.logAction(`錯誤 ${context}: ${error.message}`);
    }
  }

  // 建立動作管理器以支援 action-based 實驗
  createActionManager() {
    // 使用共用的 ActionManager 類別
    if (!window.actionManager) {
      window.actionManager = new ActionManager();
      this.modules.actionManager = window.actionManager;
    } else {
      this.modules.actionManager = window.actionManager;
    }
  }
}

// 建立並初始化主應用程式
const mainApp = new MainApp();

// DOM 載入完成時初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mainApp.initialize());
} else {
  mainApp.initialize();
}

// 匯出主應用程式實例
window.mainApp = mainApp;
