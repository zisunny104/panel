/**
 * PanelSyncManager - 面板頁面同步事件管理器
 *
 * 負責處理面板頁面的同步狀態更新事件，包括實驗控制和UI同步
 */

class PanelSyncManager {
  constructor() {
    this.initialized = false;
    this.modules = {};
    this._remoteStartInProgress = false;
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
    window.addEventListener(window.SYNC_EVENTS.STATE_UPDATE, (event) => {
      const state = event.detail;
      if (!state) return;
      // 防止自我回聲：拋棄自己廣播們回來的訊息
      // _sessionRestore 旗標由 sync-client.js 的工作階段狀態還原流程設置，應豁免此限制
      const myId = window.syncClient?.clientId;
      if (myId && state.clientId === myId && !state._sessionRestore) return;
      if (state?.type === window.SYNC_DATA_TYPES.EXPERIMENT_STARTED) {
        this.handleSyncExperimentStart(state);
      } else if (
        state?.type === window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE &&
        state?.event === window.SYNC_DATA_TYPES.EXPERIMENT_PAUSED
      ) {
        this.handleSyncExperimentPaused(state);
      } else if (
        state?.type === window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE &&
        state?.event === window.SYNC_DATA_TYPES.EXPERIMENT_RESUMED
      ) {
        this.handleSyncExperimentResumed(state);
      } else if (
        state?.type === window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE &&
        state?.event === window.SYNC_DATA_TYPES.EXPERIMENT_STOPPED
      ) {
        this.handleSyncExperimentStopped(state);
      } else if (state?.type === window.SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE) {
        this.handleSyncExperimentIdUpdate(state);
      } else if (state?.type === window.SYNC_DATA_TYPES.SUBJECT_NAME_UPDATE) {
        this.handleSyncSubjectNameUpdate(state);
      }
    });

    // 監聽受試者名稱輸入，廣播變更到其他裝置（使用事件委派，支援動態 DOM）
    let _subjectNameDebounce = null;
    document.addEventListener("input", (e) => {
      if (e.target.id !== "participantNameInput") return;
      const newName = e.target.value.trim();
      if (!newName) return;
      if (_subjectNameDebounce) clearTimeout(_subjectNameDebounce);
      _subjectNameDebounce = setTimeout(() => {
        _subjectNameDebounce = null;
        if (!window.syncManager?.core?.isConnected()) return;
        window.syncManager.core
          .syncState({
            type: window.SYNC_DATA_TYPES.SUBJECT_NAME_UPDATE,
            clientId: window.syncClient?.clientId,
            subjectName: newName,
            timestamp: new Date().toISOString(),
          })
          .catch((err) => Logger.warn("廣播受試者名稱失敗:", err));
      }, 300);
    });
  }

  /**
   * 處理同步的實驗開始狀態
   */
  async handleSyncExperimentStart(syncData) {
    Logger.debug("[PanelSync] handleSyncExperimentStart 被呼叫", {
      clientId: syncData.clientId,
      experimentId: syncData.experimentId,
      _sessionRestore: syncData._sessionRestore,
      isRunning: window.experimentFlowManager?.isRunning,
    });
    // 更新面板的實驗資訊（使用 camelCase 欄位名稱，與 board 廣播一致）
    const expIdInput = document.getElementById("experimentIdInput");
    const participantInput = document.getElementById("participantNameInput");

    if (expIdInput && syncData.experimentId) {
      expIdInput.value = syncData.experimentId;
    }
    if (participantInput && syncData.subjectName) {
      participantInput.value = syncData.subjectName;
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
    // 檢查是否在 index.html（使用 experimentFlowManager）
    else if (window.experimentFlowManager) {
      const isRunning = window.experimentFlowManager.isRunning || false;

      if (!isRunning) {
        this._remoteStartInProgress = true;
        try {
          // 檢查遠端組合是否與本機相同（A3a）
          const currentCombo =
            window.experimentSystemManager?.combinationManager?.getCurrentCombination?.();
          const remoteComboId = syncData.combinationId;
          const localComboId = currentCombo?.combinationId;

          Logger.debug("[PanelSync] 組合一致性檢查:", {
            remoteComboId,
            localComboId,
            isSame: remoteComboId === localComboId,
          });

          // 若同步資料包含 combinationId，先套用組合確保有單元可載入
          if (
            syncData.combinationId &&
            window.experimentSystemManager?.selectCombination
          ) {
            if (
              !currentCombo ||
              currentCombo.combinationId !== syncData.combinationId
            ) {
              Logger.info(
                `[PanelSync] 組合不一致，同步遠端組合: ${syncData.combinationId}`,
              );
              await window.experimentSystemManager
                .selectCombination(syncData.combinationId)
                .catch((err) =>
                  Logger.warn("[PanelSync] 設定遠端組合失敗:", err),
                );
            } else {
              Logger.debug("[PanelSync] 組合已匹配，無需同步");
            }
          }
          window.experimentFlowManager.startExperiment();
        } catch (error) {
          Logger.error("experimentFlowManager.startExperiment() 失敗:", error);
        } finally {
          setTimeout(() => {
            this._remoteStartInProgress = false;
          }, 500);
        }
      } else {
        Logger.debug("[PanelSync] 實驗已在進行中，忽略遠端開始請求");
      }
    } else {
      Logger.warn("找不到有效的實驗管理器（experimentFlowManager 不可用）");
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
    this.callExperimentMethod("pauseExperiment", "暫停實驗失敗");
  }

  /**
   * 處理同步的實驗還原狀態
   */
  handleSyncExperimentResumed(syncData) {
    this.callExperimentMethod("resumeExperiment", "還原實驗失敗");
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
    } else if (window.experimentFlowManager) {
      // Panel page fallback: map to ExperimentFlowManager methods
      const fm = window.experimentFlowManager;
      const flowMethodMap = {
        pauseExperiment: "pauseExperiment",
        resumeExperiment: "resumeExperiment",
        stopExperiment: "stopExperiment",
      };
      const flowMethod = flowMethodMap[methodName];
      if (flowMethod && typeof fm[flowMethod] === "function") {
        try {
          fm[flowMethod](...args);
        } catch (error) {
          Logger.error(`experimentFlowManager.${flowMethod}() 失敗:`, error);
        }
      } else {
        Logger.warn(`找不到有效的實驗管理器來呼叫 ${methodName}`);
      }
    } else {
      Logger.warn(`找不到有效的實驗管理器來呼叫 ${methodName}`);
    }
  }

  /**
   * 綁定 ExperimentFlowManager 的廣播（由 PanelPageManager 初始化後呼叫）
   * 當 panel 本地發起實驗開始時，廣播到其他裝置
   * @param {ExperimentFlowManager} flowManager
   */
  bindExperimentBroadcast(flowManager) {
    if (!flowManager) return;

    flowManager.on(ExperimentFlowManager.EVENT.STARTED, () => {
      if (this._remoteStartInProgress) return; // 防止回聲
      if (!window.syncManager?.core?.isConnected()) return;
      const experimentId =
        window.experimentSystemManager?.getExperimentId?.() || "";
      const subjectName =
        document.getElementById("participantNameInput")?.value?.trim() || "";
      const currentCombo =
        window.experimentSystemManager?.getCurrentCombination?.() ||
        window.experimentSystemManager?.combinationManager?.getCurrentCombination?.() ||
        null;
      window.syncManager.core
        .syncState({
          type: window.SYNC_DATA_TYPES.EXPERIMENT_STARTED,
          clientId: window.syncClient?.clientId,
          experimentId,
          subjectName,
          combinationId: currentCombo?.combinationId || "",
          combinationName: currentCombo?.combinationName || "",
          timestamp: new Date().toISOString(),
        })
        .catch((err) => Logger.warn("廣播實驗開始失敗:", err));
    });

    Logger.debug("PanelSyncManager: 已綁定實驗開始廣播");
  }

  /**
   * 處理同步的實驗ID更新
   */
  handleSyncExperimentIdUpdate(syncData) {
    const { experimentId } = syncData;
    if (!experimentId) return;

    if (!window.experimentSystemManager?.setExperimentId) {
      Logger.error(
        "handleSyncExperimentIdUpdate: experimentSystemManager 不存在，無法套用實驗ID",
      );
      return;
    }

    const currentId = window.experimentSystemManager.getExperimentId();
    if (currentId !== experimentId) {
      window.experimentSystemManager.setExperimentId(experimentId, {
        registerToHub: false,
        broadcast: false,
        reapplyCombination: true,
      });
    }
  }

  /**
   * 處理同步的受試者名稱更新（從 board 端收到）
   */
  handleSyncSubjectNameUpdate(syncData) {
    const { subjectName } = syncData;
    if (!subjectName) return;
    const input = document.getElementById("participantNameInput");
    if (input && input.value.trim() !== subjectName) {
      input.value = subjectName;
    }
  }
}

// 建立全域實例
window.panelSyncManager = new PanelSyncManager();
