/**
 * PanelSyncManager - 面板頁面同步事件管理器
 *
 * 負責處理面板頁面的同步狀態更新事件，包括實驗控制和UI同步
 */
import {
  ACTION_IDS,
  LOG_SOURCES,
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";

class PanelSyncManager {
  constructor({
    logger = null,
    panelExperiment = null,
    syncClient = null,
    experimentSyncCore = null,
    experimentFlowManager = null,
    experimentSystemManager = null,
    experimentActionHandler = null,
    experimentCombinationManager = null,
    powerControl = null,
  } = {}) {
    this.logger = logger;
    this.panelExperiment = panelExperiment;
    this.syncClient = syncClient;
    this.experimentSyncCore = experimentSyncCore;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSystemManager = experimentSystemManager;
    this.experimentActionHandler = experimentActionHandler;
    this.experimentCombinationManager = experimentCombinationManager;
    this.powerControl = powerControl;
    this.initialized = false;
    this.modules = {};
    this._remoteStartInProgress = false;
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 檢查是否可以廣播（連線狀態 + 防回聲）
   */
  _canBroadcast() {
    return (
      !this._remoteStartInProgress &&
      this.experimentSyncCore?.canBroadcast?.()
    );
  }

  /**
   * 取得實驗組合，統一處理多個可能的路徑
   */
  _getExperimentCombo() {
    return this.experimentCombinationManager?.getCurrentCombination?.();
  }

  /**
   * 初始化同步管理器
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    const initStart = performance.now();

    try {
      Logger.debug("PanelSyncManager 初始化開始");

      // 設定模組引用
      this.setupModuleReferences();

      // 設定同步事件監聽器
      this.setupSyncEventListeners();

      this.initialized = true;
      const duration = performance.now() - initStart;
      Logger.debug(
        `PanelSyncManager 初始化完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error("PanelSyncManager 初始化失敗:", error);
    }
  }

  /**
   * 設定模組引用
   */
  setupModuleReferences() {
    this.modules = {
      logger: this.logger,
      panelExperiment: this.panelExperiment,
      boardPageManager: null,
    };
  }

  /**
   * 設定同步事件監聽器
   */
  setupSyncEventListeners() {
    // 監聽同步狀態更新事件
    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (event) => {
      const state = event.detail;
      if (!state) return;
      // 防止自我回聲：拋棄自己廣播們回來的訊息
      // _sessionRestore 旗標由 sync-client.js 的工作階段狀態還原流程設置，應豁免此限制
      const myId = this.syncClient?.clientId;
      if (myId && state.clientId === myId && !state._sessionRestore) return;
      if (state.type === SYNC_DATA_TYPES.EXPERIMENT_STARTED) {
        this.handleSyncExperimentStart(state);
      } else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_PAUSED) {
        this.handleSyncExperimentPaused(state);
      } else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_RESUMED) {
        this.handleSyncExperimentResumed(state);
      } else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_STOPPED) {
        this.handleSyncExperimentStopped(state);
      } else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE) {
        this.handleSyncExperimentIdUpdate(state);
      } else if (state.type === SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE) {
        this.handleSyncParticipantNameUpdate(state);
      } else if (state.type === SYNC_DATA_TYPES.ACTION_COMPLETED) {
        this.handleSyncActionCompleted(state);
      } else if (state.type === SYNC_DATA_TYPES.ACTION_CANCELLED) {
        this.handleSyncActionCancelled(state);
      }
    });

    // 監聽受試者名稱輸入，廣播變更到其他裝置（使用事件委派，支援動態 DOM）
    let _participantNameDebounce = null;
    document.addEventListener("input", (e) => {
      if (e.target.id !== "participantNameInput") return;
      const newName = e.target.value.trim();
      if (!newName) return;
      if (_participantNameDebounce) clearTimeout(_participantNameDebounce);
      _participantNameDebounce = setTimeout(() => {
        _participantNameDebounce = null;
        this.experimentSyncCore?.safeBroadcast?.({
          type: SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE,
          clientId: this.syncClient?.clientId,
          timestamp: Date.now(),
          participantName: newName,
        }).catch((err) => Logger.warn("廣播受試者名稱失敗:", err));
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
      isRunning: this.experimentFlowManager?.isRunning,
    });
    // 更新面板的實驗資訊（使用 camelCase 欄位名稱，與 board 廣播一致）
    const expIdInput = document.getElementById("experimentIdInput");
    const participantInput = document.getElementById("participantNameInput");

    if (expIdInput && syncData.experimentId) {
      expIdInput.value = syncData.experimentId;
    }
    if (participantInput && syncData.participantName) {
      participantInput.value = syncData.participantName;
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
    // 在 index.html（panel）端或其他環境，直接使用 FlowManager
    else if (this.experimentFlowManager) {
      const isRunning = this.experimentFlowManager.isRunning || false;

      if (!isRunning) {
        this._remoteStartInProgress = true;
        try {
          // 檢查遠端組合是否與本機相同
          const currentCombo = this._getExperimentCombo();
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
            this.experimentSystemManager?.selectCombination
          ) {
            if (
              !currentCombo ||
              currentCombo.combinationId !== syncData.combinationId
            ) {
              Logger.info(
                `[PanelSync] 組合不一致，同步遠端組合: ${syncData.combinationId}`,
              );
              await this.experimentSystemManager
                .selectCombination(syncData.combinationId)
                .catch((err) =>
                  Logger.warn("[PanelSync] 設定遠端組合失敗:", err),
                );
            } else {
              Logger.debug("[PanelSync] 組合已匹配，無需同步");
            }
          }
          // 呼叫 FlowManager 啟動實驗
          // FlowManager 會自動發出所有必要的事件和廣播
          this.experimentFlowManager.startExperiment();
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
    } else if (this.experimentFlowManager) {
      const fm = this.experimentFlowManager;
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
   * 當 panel 本機發起任何實驗狀態變化時，廣播到其他裝置
   * @param {ExperimentFlowManager} flowManager
   */
  bindExperimentBroadcast(flowManager) {
    if (!flowManager) return;

    // 廣播實驗開始
    flowManager.on(ExperimentFlowManager.EVENT.STARTED, () => {
      if (!this._canBroadcast()) return;
      const currentCombo = this._getExperimentCombo();
      const experimentId =
        this.experimentSystemManager?.getExperimentId?.() || "";
      const participantName =
        document.getElementById("participantNameInput")?.value?.trim() || "";
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_STARTED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
        experimentId,
        participantName,
        combinationId: currentCombo?.combinationId || "",
        combinationName: currentCombo?.combinationName || "",
        })
        .catch((err) => Logger.warn("廣播實驗開始失敗:", err));
    });

    // 廣播實驗暫停
    flowManager.on(ExperimentFlowManager.EVENT.PAUSED, () => {
      if (!this._canBroadcast()) return;
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      }).catch((err) => Logger.warn("廣播實驗暫停失敗:", err));
    });

    // 廣播實驗繼續
    flowManager.on(ExperimentFlowManager.EVENT.RESUMED, () => {
      if (!this._canBroadcast()) return;
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      }).catch((err) => Logger.warn("廣播實驗繼續失敗:", err));
    });

    // 廣播實驗停止
    flowManager.on(ExperimentFlowManager.EVENT.STOPPED, () => {
      if (!this._canBroadcast()) return;
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      }).catch((err) => Logger.warn("廣播實驗停止失敗:", err));
    });

    Logger.debug("PanelSyncManager: 已綁定所有實驗狀態廣播");
  }

  /**
   * 處理同步的實驗ID更新
   */
  handleSyncExperimentIdUpdate(syncData) {
    const { experimentId } = syncData;
    if (!experimentId) return;

    const currentId = this.experimentSystemManager?.getExperimentId?.();
    if (currentId !== experimentId) {
      this.experimentSystemManager?.setExperimentId?.(
        experimentId,
        LOG_SOURCES.REMOTE_SYNC,
        {
          registerToHub: false,
          broadcast: false,
          reapplyCombination: true,
        },
      );
    }
  }

  /**
   * 處理同步的受試者名稱更新（從 board 端收到）
   */
  handleSyncParticipantNameUpdate(syncData) {
    const { participantName } = syncData;
    if (!participantName) return;
    if (this.experimentSystemManager?.updateParticipantNameUi) {
      this.experimentSystemManager.updateParticipantNameUi(participantName);
      return;
    }
    const input = document.getElementById("participantNameInput");
    if (input && input.value.trim() !== participantName) {
      input.value = participantName;
    }
  }

  /**
   * 處理遠端 ACTION_COMPLETED 廣播
   * 接收來自 Board 端的 action 完成資訊
   * 若 Panel 未開機，則強制開機並推進至該 action 的下一個
   */
  async handleSyncActionCompleted(syncData) {
    const { actionId, clientId } = syncData;

    Logger.debug("[PanelSync] handleSyncActionCompleted 被呼叫", {
      actionId,
      clientId,
      panelRunning: this.experimentFlowManager?.isRunning,
    });

    // 若收到的廣播來自本機，忽略（已經由本地邏輯處理）
    const myId = this.syncClient?.clientId;
    if (myId && clientId === myId) {
      Logger.debug("[PanelSync] ACTION_COMPLETED 來自本機，忽略");
      return;
    }

    // 若 Panel 未開機，使用 Board 端的實驗資訊強制開機並推進至該 action
    if (!this.experimentFlowManager?.isRunning) {
      Logger.info("[PanelSync] Panel 未開機，嘗試以遠端資訊開機並推進至 action");

      // 若有 Board 端傳來的實驗資訊（experimentId, combinationId 等在廣播中）
      if (syncData.experimentId && syncData.combinationId) {
        try {
          // 同步實驗識別與組合，確保可載入單元
          const expIdInput = document.getElementById("experimentIdInput");
          if (expIdInput) {
            expIdInput.value = syncData.experimentId;
          }

          if (syncData.participantName) {
            const participantInput = document.getElementById("participantNameInput");
            if (participantInput) {
              participantInput.value = syncData.participantName;
            }
          }

          if (this.experimentSystemManager?.selectCombination) {
            const currentCombo = this.experimentCombinationManager?.getCurrentCombination?.();
            if (!currentCombo || currentCombo.combinationId !== syncData.combinationId) {
              await this.experimentSystemManager.selectCombination(syncData.combinationId);
            }
          }

          // 啟動實驗流程
          if (this.experimentFlowManager?.startExperiment) {
            this.experimentFlowManager.startExperiment();
            Logger.info("[PanelSync] Panel 已啟動實驗");
          }
        } catch (error) {
          Logger.error("[PanelSync] 遠端強制開機失敗:", error);
          return;
        }
      } else {
        Logger.warn("[PanelSync] 廣播缺少實驗資訊 (experimentId/combinationId)，無法遠端開機");
        return;
      }
    }

    // 非電源 action 且尚未開機時，先強制開機再推進 action
    if (
      !this.powerControl?.isPowerOn &&
      actionId !== ACTION_IDS.POWER_ON &&
      actionId !== ACTION_IDS.POWER_OFF
    ) {
      this.powerControl?.setPowerState(true, "sync");
    }

    const isPowerAction =
      actionId === ACTION_IDS.POWER_ON || actionId === ACTION_IDS.POWER_OFF;
    if (isPowerAction && this.powerControl) {
      const desiredState = actionId === ACTION_IDS.POWER_ON;
      if (this.powerControl.isPowerOn === desiredState) {
        this.experimentActionHandler?.handleRemoteAction?.({
          actionId,
          status: "completed",
          source: clientId,
        });
        return;
      }

      this.powerControl.setPowerState(desiredState, "sync");
      return;
    }

    // Panel 已開機（或剛才被強制開機）
    // 將該 action 標記為已完成，推進至下一個 action
    if (this.experimentActionHandler) {
      this.experimentActionHandler.handleRemoteAction({
        actionId: actionId,
        status: "completed",
        source: clientId,
      });
      Logger.debug("[PanelSync] 已將 action 推進至下一個", { actionId });
    } else {
      Logger.warn("[PanelSync] experimentActionHandler 不可用");
    }
  }

  /**
   * 處理遠端 ACTION_CANCELLED 廣播
   * 接收來自 Board 端的 action 取消資訊
   */
  handleSyncActionCancelled(syncData) {
    const { actionId, clientId } = syncData;

    Logger.debug("[PanelSync] handleSyncActionCancelled 被呼叫", {
      actionId,
      clientId,
    });

    // 若收到的廣播來自本機，忽略
    const myId = this.syncClient?.clientId;
    if (myId && clientId === myId) {
      return;
    }

    // 若 Panel 未開機，無法處理取消操作
    if (!this.experimentFlowManager?.isRunning) {
      Logger.debug("[PanelSync] Panel 未開機，忽略 ACTION_CANCELLED");
      return;
    }

    // 通知 actionHandler 取消該 action（若實現了此邏輯）
    if (this.experimentActionHandler?.handleRemoteAction) {
      this.experimentActionHandler.handleRemoteAction({
        actionId: actionId,
        status: "cancelled",
        source: clientId,
      });
    }
  }
}

// ES6 模組匯出
export default PanelSyncManager;
export { PanelSyncManager };
