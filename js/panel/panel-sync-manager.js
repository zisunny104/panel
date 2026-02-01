/**
 * PanelSyncManager - 面板頁面同步事件管理器
 *
 * 負責處理面板頁面的同步狀態更新事件，包括實驗控制和UI同步
 */

class PanelSyncManager {
  constructor() {
    this.initialized = false;
    this.modules = {};
  }

  /**
   * 初始化同步管理器
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      Logger.debug("PanelSyncManager 初始化開始");

      // 設定模組引用
      this.setupModuleReferences();

      // 設定同步事件監聽器
      this.setupSyncEventListeners();

      this.initialized = true;
      Logger.debug("PanelSyncManager 初始化完成");
    } catch (error) {
      Logger.error("PanelSyncManager 初始化失敗:", error);
    }
  }

  /**
   * 設定模組引用
   */
  setupModuleReferences() {
    this.modules = {
      logger: window.logger,
      panelExperiment: window.panelExperiment,
      boardPageManager: window.boardPageManager,
    };
  }

  /**
   * 設定同步事件監聽器
   */
  setupSyncEventListeners() {
    // 監聽同步狀態更新事件
    window.addEventListener("sync_state_update", (event) => {
      const state = event.detail;
      if (state?.type === "experiment_started") {
        this.handleSyncExperimentStart(state);
      } else if (state?.type === "experiment_paused") {
        this.handleSyncExperimentPaused(state);
      } else if (state?.type === "experiment_resumed") {
        this.handleSyncExperimentResumed(state);
      } else if (state?.type === "experiment_stopped") {
        this.handleSyncExperimentStopped(state);
      } else if (state?.type === "experimentIdUpdate") {
        this.handleSyncExperimentIdUpdate(state);
      }
    });
  }

  /**
   * 處理同步的實驗開始狀態
   */
  handleSyncExperimentStart(syncData) {
    // 更新面板的實驗資訊
    const expIdInput = document.getElementById("experimentIdInput");
    const participantInput = document.getElementById("participantNameInput");

    if (expIdInput && syncData.experiment_id) {
      expIdInput.value = syncData.experiment_id;
    }
    if (participantInput && syncData.participant_name) {
      participantInput.value = syncData.participant_name;
    }

    // 檢查是否在 board.html
    if (this.modules.boardPageManager) {
      const isRunning =
        this.modules.boardPageManager.experimentRunning ||
        this.modules.boardPageManager.state?.running ||
        false;

      if (!isRunning) {
        try {
          this.modules.boardPageManager.startExperiment();
        } catch (error) {
          Logger.error("boardPageManager.startExperiment() 失敗:", error);
        }
      }
    }
    // 檢查是否在 index.html
    else if (this.modules.panelExperiment?.startExperiment) {
      const isRunning =
        this.modules.panelExperiment.isExperimentRunning || false;

      if (!isRunning) {
        try {
          this.modules.panelExperiment.startExperiment();
        } catch (error) {
          Logger.error("panelExperiment.startExperiment() 失敗:", error);
        }
      }
    } else {
      Logger.warn("找不到有效的實驗管理器");
    }

    // 記錄這個同步事件到日誌
    if (this.modules.logger) {
      const clientId = localStorage.getItem("sync_client_id") || "unknown";
      const sourceClientId = syncData.clientId || "unknown";
      const sourceType = syncData.source || "unknown";
      this.modules.logger.logAction(
        `[同步] 實驗開始訊號來自 ${sourceType} (${sourceClientId})`,
        null,
        "handleSyncExperimentStart",
        false,
        false,
        false,
        null,
        {
          client_id: clientId,
          source_client_id: sourceClientId,
          source_type: sourceType,
        },
      );
    }
  }

  /**
   * 處理同步的實驗暫停狀態
   */
  handleSyncExperimentPaused(syncData) {
    this.callExperimentMethod("togglePauseExperiment", "暫停實驗失敗");
  }

  /**
   * 處理同步的實驗還原狀態
   */
  handleSyncExperimentResumed(syncData) {
    this.callExperimentMethod("togglePauseExperiment", "還原實驗失敗");
  }

  /**
   * 處理同步的實驗停止狀態
   */
  handleSyncExperimentStopped(syncData) {
    this.callExperimentMethod("stopExperiment", "停止實驗失敗", false);
  }

  /**
   * 通用實驗方法調用器
   */
  callExperimentMethod(methodName, errorMessage, ...args) {
    if (this.modules.boardPageManager?.[methodName]) {
      try {
        this.modules.boardPageManager[methodName](...args);
      } catch (error) {
        Logger.error(`${errorMessage}:`, error);
      }
    } else if (this.modules.panelExperiment?.[methodName]) {
      try {
        this.modules.panelExperiment[methodName](...args);
      } catch (error) {
        Logger.error(`panelExperiment.${methodName}() 失敗:`, error);
      }
    }
  }

  /**
   * 處理同步的實驗ID更新
   */
  handleSyncExperimentIdUpdate(syncData) {
    const { experimentId, timestamp } = syncData;

    // 更新機台面板上的實驗ID
    const expIdInput = document.getElementById("experimentIdInput");
    if (expIdInput && experimentId && expIdInput.value !== experimentId) {
      expIdInput.value = experimentId;

      // 分派事件通知其他模組（如果需要）
      document.dispatchEvent(
        new CustomEvent("experiment_id_changed", {
          detail: { experimentId, timestamp },
        }),
      );
    }
  }
}

// 建立全域實例
window.panelSyncManager = new PanelSyncManager();
