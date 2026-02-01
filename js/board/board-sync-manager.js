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
    // core 會重新派發原始 sync detail 為 'experiment:sync:remote_state'
    window.addEventListener("experiment:sync:remote_state", (e) => {
      const detail = e.detail;
      if (!detail) return;

      // map types to existing page events
      if (detail.type === "experiment_started") {
        window.dispatchEvent(
          new CustomEvent("remote_experiment_started", { detail }),
        );
      } else if (detail.type === "experiment_state_change") {
        const map = {
          experiment_paused: "remote_experiment_paused",
          experiment_resumed: "remote_experiment_resumed",
          experiment_stopped: "remote_experiment_stopped",
        };
        if (detail.event && map[detail.event]) {
          window.dispatchEvent(new CustomEvent(map[detail.event], { detail }));
        }
      } else if (detail.type === "experiment_action") {
        window.dispatchEvent(
          new CustomEvent("remote_experiment_action", { detail }),
        );
      } else if (detail.type === "button_action") {
        window.dispatchEvent(
          new CustomEvent("remote_button_action", { detail }),
        );
      } else {
        // fallback: re-dispatch generic
        window.dispatchEvent(new CustomEvent("remote_sync_event", { detail }));
      }
    });
  }

  _bindDomEvents() {
    // Listen to local experiment events and forward to core
    document.addEventListener("experiment_started", (e) => {
      this.core.broadcastExperimentStart(e.detail);
    });
    document.addEventListener("experiment_paused", (e) => {
      this.core.broadcastExperimentPause(e.detail);
    });
    document.addEventListener("experiment_resumed", (e) => {
      this.core.broadcastExperimentResume(e.detail);
    });
    document.addEventListener("experiment_stopped", (e) => {
      this.core.broadcastExperimentStop(e.detail);
    });
    document.addEventListener("experiment_action_recorded", (e) => {
      this.core.broadcastExperimentAction(e.detail);
    });
    document.addEventListener("experimentStateChange", (e) => {
      if (e.detail?.type === "button_action") {
        this.core.broadcastButtonAction(e.detail);
      }
    });
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
      const hubManager = getExperimentHubManager();
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
      const _params = new URLSearchParams({
        action: "register",
        experiment_id: stateData.experiment_id || "",
        subject_name: stateData.subject_name || "",
        combination_name: stateData.combination_name || "",
        combination_id: stateData.combination_id || "",
        gesture_count: stateData.gesture_count || 0,
        gesture_sequence: JSON.stringify(stateData.gesture_sequence || []),
        current_step: stateData.current_step || 0,
        is_running: stateData.is_running ? "true" : "false",
        source: "experiment_manager",
      });

      // 移除 PHP 調用
      // 狀態管理由 ExperimentStateManager 和 WebSocket 處理
      Logger.debug("跳過 PHP API 調用");
    } catch (error) {
      Logger.warn("註冊實驗狀態失敗:", error);
    }
  }

  /** 廣播實驗ID更新到其他連線裝置 */
  broadcastExperimentIdUpdate(experimentId) {
    // 檢查是否存在同步工作階段
    if (!this.core?.isConnected?.()) {
      return;
    }

    const updateData = {
      type: "experimentIdUpdate",
      client_id: this.core?.syncClient?.clientId || "experiment_panel",
      experimentId: experimentId,
      timestamp: new Date().toISOString(),
    };

    // 使用統一的同步機制
    this.core.syncState(updateData).catch((error) => {
      Logger.warn("廣播實驗ID更新失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      }),
    );
  }

  /** 廣播暫停/還原狀態到其他連線裝置 */
  broadcastExperimentPauseState(isPaused) {
    // 檢查是否存在同步工作階段
    if (!this.core?.isConnected()) {
      return;
    }

    const updateData = {
      type: isPaused ? "experimentPaused" : "experimentResumed",
      client_id: this.clientId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      isPaused: isPaused,
      timestamp: new Date().toISOString(),
    };

    // 同步到伺服器
    this.core.syncState(updateData).catch((error) => {
      Logger.warn("同步實驗暫停狀態失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      }),
    );
  }

  /** 廣播實驗停止狀態到其他連線裝置 */
  broadcastExperimentStop() {
    // 檢查是否存在同步工作階段
    if (!this.core?.isConnected()) {
      return;
    }

    const updateData = {
      type: "experimentStopped",
      client_id: this.clientId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      timestamp: new Date().toISOString(),
    };

    // 同步到伺服器
    this.core.syncState(updateData).catch((error) => {
      Logger.warn("同步實驗停止狀態失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
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
