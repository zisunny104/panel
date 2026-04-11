/**
 * Experiment Sync Manager - 實驗狀態多裝置同步
 *
 * 將實驗的開始、暫停、停止狀態及所有操作同步到同一工作階段的其他裝置
 */

import { dispatchRemoteSync } from "./board-sync-dispatcher.js";
import { SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";

// board-side adapter: thin layer that maps DOM/events <-> experimentSyncCore
class ExperimentSyncAdapter {
  constructor({
    syncManager = null,
    syncClient = null,
    experimentSyncCore = null,
    experimentHubManager = null,
  } = {}) {
    this.syncManager = syncManager;
    this.syncClient = syncClient;
    this.experimentHubManager = experimentHubManager;
    this._core = experimentSyncCore; // 懶加載 experimentSyncCore
    this.clientId = null;
    this._bindCoreEvents();
    this._bindDomEvents();
    Logger.debug("ExperimentSyncAdapter 已建立");
  }

  updateDependencies({
    syncManager,
    syncClient,
    experimentSyncCore,
    experimentHubManager,
  } = {}) {
    if (syncManager) this.syncManager = syncManager;
    if (syncClient) this.syncClient = syncClient;
    if (experimentSyncCore) this._core = experimentSyncCore;
    if (experimentHubManager) this.experimentHubManager = experimentHubManager;
  }

  get core() {
    if (!this._core) {
      Logger.warn("ExperimentSyncAdapter: experimentSyncCore 未設定");
    }
    return this._core;
  }

  get resolvedSyncClient() {
    return this.syncClient || this.syncManager?.core?.syncClient;
  }

  get resolvedHubManager() {
    return this.experimentHubManager;
  }

  _bindCoreEvents() {
    // ExperimentSyncCore 收到遠端狀態後，會重新派發為 REMOTE_STATE 事件
    window.addEventListener(SYNC_EVENTS.REMOTE_STATE, (e) => {
      const detail = e.detail;
      dispatchRemoteSync(detail);
    });
  }

  _bindDomEvents() {
    // 監聽本機實驗 DOM 事件並轉送至 ExperimentSyncCore 廣播
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_STARTED, (e) => {
      this.core.broadcastExperimentStart(e.detail);
    });
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_PAUSED, (e) => {
      this.core.broadcastExperimentPause(e.detail);
    });
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_RESUMED, (e) => {
      this.core.broadcastExperimentResume(e.detail);
    });
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_STOPPED, (e) => {
      this.core.broadcastExperimentStop(e.detail);
    });
  }

  // adapter status
  getStatus() {
    const syncClient = this.resolvedSyncClient;
    return {
      connected: syncClient?.isConnected?.() || false,
      clientId: syncClient?.clientId,
    };
  }

  /** 註冊實驗ID到中樞 */
  async registerExperimentIdToHub(experimentId) {
    try {
      Logger.debug(`開始註冊實驗ID到中樞: ${experimentId}`);
      const hubManager = this.resolvedHubManager;
      const success = await hubManager.registerExperimentId(
        experimentId,
        "experiment_manager",
      );
      if (success) {
        Logger.info(`實驗ID已成功註冊到中樞: ${experimentId}`);
      } else {
        Logger.warn(`實驗ID註冊失敗: ${experimentId}`);
      }
    } catch (error) {
      Logger.warn(`無法連線到實驗中樞: ${error.message}`);
    }
  }

  /** 註冊實驗狀態到中樞 */
  async registerExperimentStateToHub(stateData) {
    try {
      const hubManager = this.resolvedHubManager;
      if (!hubManager?.registerExperimentState) {
        Logger.debug("ExperimentHubManager 不可用，跳過實驗狀態註冊");
        return false;
      }

      const payload = {
        type: stateData.type || SYNC_DATA_TYPES.EXPERIMENT_STARTED,
        experimentId: stateData.experiment_id || stateData.experimentId || "",
        subjectName: stateData.subject_name || stateData.subjectName || "",
        combinationId:
          stateData.combination_id || stateData.combinationId || "",
        combinationName:
          stateData.combination_name || stateData.combinationName || "",
        gestureCount: stateData.gesture_count || stateData.gestureCount || 0,
        gestureSequence:
          stateData.gesture_sequence || stateData.gestureSequence || [],
        currentStep: stateData.current_step || stateData.currentStep || 0,
        isRunning: stateData.is_running || stateData.isRunning || false,
        source: "experiment_manager",
      };

      return await hubManager.registerExperimentState(payload);
    } catch (error) {
      Logger.warn("註冊實驗狀態失敗:", error);
      return false;
    }
  }

  /** 廣播實驗ID更新到其他連線裝置 */
  broadcastExperimentIdUpdate(experimentId) {
    const syncClient = this.resolvedSyncClient;
    const updateData = {
      type: SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE,
      clientId: syncClient?.clientId || "experiment_panel",
      timestamp: Date.now(),
      experimentId: experimentId,
    };

    this.core?.safeBroadcast?.(updateData).catch((error) => {
      Logger.warn("廣播實驗ID更新失敗:", error);
    });

    document.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: updateData,
      }),
    );
  }
}

const experimentSyncManager = new ExperimentSyncAdapter();

export { ExperimentSyncAdapter, experimentSyncManager };
export default ExperimentSyncAdapter;
