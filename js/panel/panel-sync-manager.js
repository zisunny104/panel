/**
 * PanelSyncManager - panel 端（受試者）同步事件管理器
 *
 * 負責處理 panel（受試者/participant）頁面的同步狀態更新事件，
 * 包括接收 board（實驗者）發出的實驗控制訊號，以及廣播本機狀態給其他裝置。
 *
 * 角色說明：
 * - Panel（panel.html）：受試者配戴 MR 裝置操作，本機發出的廣播以
 *   實驗生命週期事件（開始/暫停/繼續/停止）為主。
 * - Board（board.html）：實驗者控制流程，panel 端透過此 manager 接收
 *   board 廣播的控制訊號並套用至本機 ExperimentSystemManager。
 */
import {
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";
import { dispatchSessionRestoreEvents } from "../core/session-restore-events.js";

class PanelSyncManager {
  constructor({
    logger = null,
    syncClient = null,
    experimentSyncCore = null,
    experimentFlowManager = null,
    experimentSystemManager = null,
    experimentCombinationManager = null,
  } = {}) {
    this.logger = logger;
    this.syncClient = syncClient;
    this.experimentSyncCore = experimentSyncCore;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSystemManager = experimentSystemManager;
    this.experimentCombinationManager = experimentCombinationManager;
    this.initialized = false;
    this._remoteStartInProgress = false;
    this._remoteExperimentActive = false;
    this._broadcastBound = false;
    this._broadcastUnsubscribers = [];
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

  _getSyncRole() {
    return this.syncClient?.getRole?.() || this.syncClient?.role || null;
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
    // 工作階段快照由使用端解讀：將可恢復的狀態轉成一般同步事件
    window.addEventListener(SYNC_EVENTS.SESSION_STATE, (event) => {
      // Panel 端不再從 session snapshot 還原電源狀態。
      // 重新整理後實驗流程無法完整還原時，電源狀態也必須保持初始值，避免狀態漂移。
      dispatchSessionRestoreEvents(event.detail, { includePowerState: false });
    });

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
    if (!flowManager) return () => {};

    if (this._broadcastBound) {
      Logger.debug("PanelSyncManager: 實驗廣播事件已綁定，略過重複綁定");
      return () => this.unbindExperimentBroadcast();
    }

    this._broadcastBound = true;
    const unsubscribers = [];

    // 廣播實驗開始
    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.STARTED, (startData = {}) => {
      if (!this._remoteStartInProgress) {
        this._remoteExperimentActive = false;
        this._setDeferCompletion(false);
      }
      if (startData.broadcast === false) return;
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
        role: this._getSyncRole(),
        source: startData.source || "flow_local",
        experimentId,
        participantName,
        combinationId: currentCombo?.combinationId || "",
        combinationName: currentCombo?.combinationName || "",
        })
        .catch((err) => Logger.warn("廣播實驗開始失敗:", err));
      }));

    // 廣播實驗暫停
    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.PAUSED, (pauseData = {}) => {
      if (pauseData.broadcast === false) return;
      if (!this._canBroadcast()) return;
      const experimentId = this.experimentSystemManager?.getExperimentId?.() || "";
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
        role: this._getSyncRole(),
        source: pauseData.source || "flow_local",
        experimentId,
      }).catch((err) => Logger.warn("廣播實驗暫停失敗:", err));
    }));

    // 廣播實驗繼續
    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.RESUMED, (resumeData = {}) => {
      if (resumeData.broadcast === false) return;
      if (!this._canBroadcast()) return;
      const experimentId = this.experimentSystemManager?.getExperimentId?.() || "";
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
        role: this._getSyncRole(),
        source: resumeData.source || "flow_local",
        experimentId,
      }).catch((err) => Logger.warn("廣播實驗繼續失敗:", err));
    }));

    // 廣播實驗停止（使用者中斷）
    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.STOPPED, (stopData = {}) => {
      this._remoteExperimentActive = false;
      this._setDeferCompletion(false);
      if (stopData.broadcast === false) {
        Logger.debug("[PanelSync] STOPPED 標記為本機收尾，不廣播到其他裝置", {
          reason: stopData.reason,
        });
        return;
      }
      if (!this._canBroadcast()) return;
      const experimentId = this.experimentSystemManager?.getExperimentId?.() || "";
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
        role: this._getSyncRole(),
        source: stopData.source || "flow_local",
        experimentId,
        reason: stopData.reason || "manual",
      }).catch((err) => Logger.warn("廣播實驗停止失敗:", err));
    }));

    // 廣播實驗自然完成（所有單元跑完，無使用者中斷）
    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.COMPLETED, (completedData = {}) => {
      this._remoteExperimentActive = false;
      this._setDeferCompletion(false);
      if (completedData.broadcast === false) return;
      if (!this._canBroadcast()) return;
      const experimentId = this.experimentSystemManager?.getExperimentId?.() || "";
      this.experimentSyncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
        role: this._getSyncRole(),
        source: completedData.source || "flow_local",
        experimentId,
        reason: completedData.reason || "completed",
      }).catch((err) => Logger.warn("廣播實驗完成失敗:", err));
    }));

    this._broadcastUnsubscribers = unsubscribers;

    Logger.debug("PanelSyncManager: 已綁定所有實驗狀態廣播");
    return () => this.unbindExperimentBroadcast();
  }

  unbindExperimentBroadcast() {
    this._broadcastUnsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe?.();
      } catch (error) {
        Logger.warn("PanelSyncManager: 解除廣播事件失敗", error);
      }
    });
    this._broadcastUnsubscribers = [];
    this._broadcastBound = false;
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
