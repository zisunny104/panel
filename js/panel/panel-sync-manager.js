/**
 * PanelSyncManager - 面板頁面同步事件管理器
 *
 * 負責處理面板頁面的同步狀態更新事件，包括實驗控制和UI同步
 */
import {
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";

class PanelSyncManager {
  constructor({
    logger = null,
    syncClient = null,
    experimentSyncCore = null,
    experimentFlowManager = null,
    experimentSystemManager = null,
    experimentActionHandler = null,
    experimentCombinationManager = null,
    powerControl = null,
  } = {}) {
    this.logger = logger;
    this.syncClient = syncClient;
    this.experimentSyncCore = experimentSyncCore;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSystemManager = experimentSystemManager;
    this.experimentActionHandler = experimentActionHandler;
    this.experimentCombinationManager = experimentCombinationManager;
    this.powerControl = powerControl;
    this.initialized = false;
    this._remoteStartInProgress = false;
    this._remoteExperimentActive = false;
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 檢查是否可以廣播（必須在工作階段中 + 連線狀態 + 防回聲）
   */
  _canBroadcast() {
    return (
      this._isInSession() &&
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
   * 設定同步事件監聽器
   */
  /**
   * 判斷目前是否在有效的同步工作階段中
   * 本機模式（無 session）時，遠端狀態更新一律忽略，避免污染本機實驗狀態
   */
  _isInSession() {
    return !!this.syncClient?.getSessionId?.();
  }

  setupSyncEventListeners() {
    // 監聽同步狀態更新事件
    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (event) => {
      const state = event.detail;
      if (!state) return;

      // 未加入工作階段時，忽略所有遠端狀態更新（本機獨立模式）
      // _sessionRestore 是工作階段還原流程，允許通過
      if (!state._sessionRestore && !this._isInSession()) return;

      // 防止自我回聲：拋棄自己廣播們回來的訊息
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
      }
    });

    // 監聽受試者名稱輸入，廣播變更到其他裝置（使用事件委派，支援動態 DOM）
    let _participantNameDebounce = null;
    document.addEventListener("input", (e) => {
      if (e.target.id !== "participantNameInput") return;
      if (!this._isInSession()) return;
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
    if (!this.experimentSystemManager) {
      Logger.warn("找不到有效的實驗管理器");
      return;
    }
    if (!this.experimentSystemManager.isExperimentRunning?.()) {
      this._remoteExperimentActive = true;
      this._setDeferCompletion(true);
      this._remoteStartInProgress = true;
      try {
        await this.experimentSystemManager.handleSyncExperimentStart?.(syncData);
      } catch (error) {
        Logger.error("experimentSystemManager.handleSyncExperimentStart() 失敗:", error);
      } finally {
        setTimeout(() => {
          this._remoteStartInProgress = false;
        }, 500);
      }
    }
  }

  /**
   * 處理同步的實驗暫停狀態
   */
  handleSyncExperimentPaused(syncData) {
    return this.experimentSystemManager?.handleSyncExperimentPaused?.(syncData);
  }

  /**
   * 處理同步的實驗還原狀態
   */
  handleSyncExperimentResumed(syncData) {
    return this.experimentSystemManager?.handleSyncExperimentResumed?.(syncData);
  }

  /**
   * 處理同步的實驗停止狀態
   */
  handleSyncExperimentStopped(syncData) {
    const myId = this.syncClient?.clientId;
    if (myId && syncData?.clientId === myId) {
      Logger.debug("[PanelSync] EXPERIMENT_STOPPED 來自本機，忽略", {
        clientId: syncData?.clientId,
        timestamp: syncData?.timestamp,
      });
      return;
    }
    this._remoteExperimentActive = false;
    this._setDeferCompletion(false);
    return this.experimentSystemManager?.handleSyncExperimentStopped?.(syncData);
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
      if (!this._remoteStartInProgress) {
        this._remoteExperimentActive = false;
        this._setDeferCompletion(false);
      }
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
    flowManager.on(ExperimentFlowManager.EVENT.STOPPED, (stopData = {}) => {
      this._remoteExperimentActive = false;
      this._setDeferCompletion(false);
      if (stopData.broadcast === false) {
        Logger.debug("[PanelSync] STOPPED 標記為本機收尾，不廣播到其他裝置", {
          reason: stopData.reason,
        });
        return;
      }
      if (!this._canBroadcast()) return;
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      }).catch((err) => Logger.warn("廣播實驗停止失敗:", err));
    });

    Logger.debug("PanelSyncManager: 已綁定所有實驗狀態廣播");
  }

  _setDeferCompletion(shouldDefer) {
    if (!this.experimentFlowManager?.setDeferCompletion) return;
    this.experimentFlowManager.setDeferCompletion(shouldDefer);
    Logger.debug("[PanelSync] deferCompletion 狀態更新", {
      shouldDefer,
      remoteActive: this._remoteExperimentActive,
    });
  }

  /**
   * 處理同步的實驗ID更新
   */
  handleSyncExperimentIdUpdate(syncData) {
    return this.experimentSystemManager?.handleSyncExperimentIdUpdate?.(
      syncData,
    );
  }

  /**
   * 處理同步的受試者名稱更新（從 board 端收到）
   */
  handleSyncParticipantNameUpdate(syncData) {
    return this.experimentSystemManager?.handleSyncParticipantNameUpdate?.(
      syncData,
    );
  }

}

// ES6 模組匯出
export default PanelSyncManager;
export { PanelSyncManager };
