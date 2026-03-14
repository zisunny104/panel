/**
 * Experiment Sync Manager - 實驗狀態多裝置同步
 * 將實驗的開始、暫停、停止狀態及所有操作同步到同一工作階段的其他裝置
 */

// board-side adapter: thin layer that maps DOM/events <-> experimentSyncCore
class ExperimentSyncAdapter {
  constructor() {
    this.core = window.experimentSyncCore; // pure sync core
    this.clientId = null;
    this._bindCoreEvents();
    this._bindDomEvents();
    Logger.debug("ExperimentSyncAdapter 已建立");
  }

  _bindCoreEvents() {
    // ExperimentSyncCore 收到遠端狀態後，會重新派發為 REMOTE_STATE 事件
    window.addEventListener(window.SYNC_EVENTS.REMOTE_STATE, (e) => {
      const detail = e.detail;
      if (!detail) return;

      // 依 type 對應到本地頁面事件
      if (detail.type === window.SYNC_DATA_TYPES.EXPERIMENT_STARTED) {
        window.dispatchEvent(
          new CustomEvent(window.SYNC_EVENTS.REMOTE_EXPERIMENT_STARTED, {
            detail,
          }),
        );
      } else if (
        detail.type === window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE
      ) {
        const map = {
          [window.SYNC_DATA_TYPES.EXPERIMENT_PAUSED]:
            window.SYNC_EVENTS.REMOTE_EXPERIMENT_PAUSED,
          [window.SYNC_DATA_TYPES.EXPERIMENT_RESUMED]:
            window.SYNC_EVENTS.REMOTE_EXPERIMENT_RESUMED,
          [window.SYNC_DATA_TYPES.EXPERIMENT_STOPPED]:
            window.SYNC_EVENTS.REMOTE_EXPERIMENT_STOPPED,
        };
        if (detail.event && map[detail.event]) {
          window.dispatchEvent(new CustomEvent(map[detail.event], { detail }));
        }
      } else if (detail.type === window.SYNC_DATA_TYPES.EXPERIMENT_ACTION) {
        window.dispatchEvent(
          new CustomEvent(window.SYNC_EVENTS.REMOTE_EXPERIMENT_ACTION, {
            detail,
          }),
        );
      } else if (detail.type === window.SYNC_DATA_TYPES.BUTTON_ACTION) {
        window.dispatchEvent(
          new CustomEvent(window.SYNC_EVENTS.REMOTE_BUTTON_ACTION, { detail }),
        );
      } else {
        // fallback: re-dispatch generic
        window.dispatchEvent(
          new CustomEvent(window.SYNC_EVENTS.REMOTE_SYNC_EVENT, { detail }),
        );
      }
    });
  }

  _bindDomEvents() {
    // 監聽本地實驗 DOM 事件並轉送至 ExperimentSyncCore 廣播
    document.addEventListener(window.SYNC_EVENTS.EXPERIMENT_STARTED, (e) => {
      this.core?.broadcastExperimentStart(e.detail);
    });
    document.addEventListener(window.SYNC_EVENTS.EXPERIMENT_PAUSED, (e) => {
      this.core?.broadcastExperimentPause(e.detail);
    });
    document.addEventListener(window.SYNC_EVENTS.EXPERIMENT_RESUMED, (e) => {
      this.core?.broadcastExperimentResume(e.detail);
    });
    document.addEventListener(window.SYNC_EVENTS.EXPERIMENT_STOPPED, (e) => {
      this.core?.broadcastExperimentStop(e.detail);
    });
    document.addEventListener(
      window.SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      (e) => {
        if (e.detail?.type === window.SYNC_DATA_TYPES.BUTTON_ACTION) {
          this.core?.broadcastButtonAction(e.detail);
        }
      },
    );
  }

  // adapter status
  getStatus() {
    return {
      connected: this.core?.isConnected || false,
      clientId: this.core?.clientId || null,
    };
  }

  /** 註冊實驗ID到中樞 */
  async registerExperimentIdToHub(experimentId) {
    try {
      Logger.debug(`開始註冊實驗ID到中樞: ${experimentId}`);
      const hubManager = window.experimentHubManager;
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
      const hubManager = window.experimentHubManager;
      if (!hubManager?.registerExperimentState) {
        Logger.debug("ExperimentHubManager 不可用，跳過實驗狀態註冊");
        return false;
      }

      const payload = {
        type: stateData.type || window.SYNC_DATA_TYPES.EXPERIMENT_STARTED,
        event: stateData.event,
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
    if (!this.core?.isConnected) {
      return;
    }

    const updateData = {
      type: window.SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE,
      clientId: this.core?.syncClient?.clientId || "experiment_panel",
      experimentId: experimentId,
      timestamp: new Date().toISOString(),
    };

    this.core.syncState(updateData).catch((error) => {
      Logger.warn("廣播實驗ID更新失敗:", error);
    });

    document.dispatchEvent(
      new CustomEvent(window.SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: updateData,
      }),
    );
  }
}

// 初始化 adapter
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.experimentSyncManager = new ExperimentSyncAdapter();
  });
} else {
  window.experimentSyncManager = new ExperimentSyncAdapter();
}
