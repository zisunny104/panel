/**
 * Experiment Sync Manager - 實驗狀態多裝置同步
 * 將實驗的開始、暫停、停止狀態及所有操作同步到同一工作階段的其他裝置
 */

class ExperimentSyncManager {
  constructor() {
    this.isConnected = false;
    this.deviceId = this.generateDeviceId();
    this.experimentState = {
      running: false,
      paused: false,
      startTime: null,
      actions: [],
    };
    this.initialize();
  }

  /**
   * 產生唯一的裝置 ID
   */
  generateDeviceId() {
    let deviceId = localStorage.getItem("exp_device_id");
    if (!deviceId) {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8);
      deviceId = `EXP-${timestamp}-${random}`.toUpperCase();
      localStorage.setItem("exp_device_id", deviceId);
    }
    return deviceId;
  }

  /**
   * 初始化同步管理器
   */
  initialize() {
    // 監聽同步連線狀態
    window.addEventListener("sync_session_joined", () => {
      this.isConnected = true;
    });

    // 監聽來自其他裝置的實驗狀態變化
    window.addEventListener("sync_state_update", (event) => {
      const state = event.detail;
      if (state?.type === "request_experiment_state") {
        this.handleExperimentStateRequest(state);
      } else if (state?.type === "experiment_started") {
        this.handleRemoteExperimentStarted(state);
      } else if (state?.type === "experiment_state_change") {
        this.handleRemoteStateChange(state);
      } else if (state?.type === "experiment_action") {
        this.handleRemoteAction(state);
      } else if (state?.type === "subjectNameUpdate") {
        this.handleRemoteSubjectNameChange(state);
      } else if (state?.type === "experimentIdUpdate") {
        this.handleRemoteExperimentIdChange(state);
      } else if (state?.type === "action_completed") {
        this.handleRemoteActionCompleted(state);
      } else if (state?.type === "action_cancelled") {
        this.handleRemoteActionCancelled(state);
      } else if (state?.type === "gesture_step_completed") {
        this.handleRemoteStepCompleted(state);
      }
    });

    // 監聽 experiment page manager 的事件
    this.setupExperimentEventListeners();
  }

  /**
   * 設定實驗事件監聽器
   */
  setupExperimentEventListeners() {
    // 實驗開始
    document.addEventListener("experiment_started", (event) => {
      this.broadcastExperimentStart(event.detail);
    });

    // 實驗暫停/還原
    document.addEventListener("experiment_paused", (event) => {
      this.broadcastExperimentPause(event.detail);
    });

    document.addEventListener("experiment_resumed", (event) => {
      this.broadcastExperimentResume(event.detail);
    });

    // 實驗停止
    document.addEventListener("experiment_stopped", (event) => {
      this.broadcastExperimentStop(event.detail);
    });

    // 實驗操作（按鈕、手勢等）
    document.addEventListener("experiment_action_recorded", (event) => {
      this.broadcastExperimentAction(event.detail);
    });

    // 實驗狀態與資訊更新
    document.addEventListener("experimentStateChange", (event) => {
      if (event.detail?.type === "subjectNameUpdate") {
        this.broadcastSubjectNameChange(event.detail);
      }
      if (event.detail?.type === "experimentIdUpdate") {
        this.broadcastExperimentIdUpdate(event.detail);
      }
      // 處理按鈕動作廣播
      if (event.detail?.type === "buttonAction") {
        this.broadcastButtonAction(event.detail);
      }
    });
  }

  /**
   * 廣播：實驗開始
   */
  async broadcastExperimentStart(details) {
    try {
      this.experimentState.running = true;
      this.experimentState.paused = false;
      this.experimentState.startTime = Date.now();

      const syncData = {
        type: "experiment_started",
        source: "experiment_panel",
        device_id: this.deviceId,
        experiment_id: details?.experimentId,
        subject_name: details?.subjectName,
        combination_id: details?.combinationId,
        combination_name: details?.combinationName,
        gesture_sequence: details?.gestureSequence,
        unit_count: details?.unitCount,
        gesture_count:
          details?.gestureCount || details?.gestureSequence?.length || 0,
        timestamp: new Date().toISOString(),
        state: { running: true, paused: false },
      };

      await this.syncState(syncData);
    } catch (error) {
      Logger.warn(
        `[ExperimentSyncManager] 廣播實驗開始失敗: ${error.message}，但本地實驗繼續進行`
      );
    }
  }

  /**
   * 廣播：實驗暫停
   */
  async broadcastExperimentPause(details) {
    try {
      this.experimentState.running = true;
      this.experimentState.paused = true;

      const syncData = {
        type: "experiment_state_change",
        event: "experiment_paused",
        device_id: this.deviceId,
        timestamp: new Date().toISOString(),
        state: { running: true, paused: true },
      };

      await this.syncState(syncData);
    } catch (error) {
      Logger.warn(
        `[ExperimentSyncManager] 廣播實驗暫停失敗: ${error.message}，但本地實驗繼續進行`
      );
    }
  }

  /**
   * 廣播：實驗還原
   */
  async broadcastExperimentResume(details) {
    try {
      this.experimentState.running = true;
      this.experimentState.paused = false;

      const syncData = {
        type: "experiment_state_change",
        event: "experiment_resumed",
        device_id: this.deviceId,
        timestamp: new Date().toISOString(),
        state: { running: true, paused: false },
      };

      await this.syncState(syncData);
    } catch (error) {
      Logger.warn(
        `[ExperimentSyncManager] 廣播實驗還原失敗: ${error.message}，但本地實驗繼續進行`
      );
    }
  }

  /**
   * 廣播：實驗停止
   */
  async broadcastExperimentStop(details) {
    this.experimentState.running = false;
    this.experimentState.paused = false;

    const syncData = {
      type: "experiment_state_change",
      event: "experiment_stopped",
      device_id: this.deviceId,
      timestamp: new Date().toISOString(),
      state: { running: false, paused: false },
    };

    await this.syncState(syncData);
  }

  /**
   * 廣播：實驗操作（按鈕按下、手勢、步驟完成等）
   */
  async broadcastExperimentAction(actionData) {
    const syncData = {
      type: "experiment_action",
      device_id: this.deviceId,
      action_type: actionData?.action_type,
      step_id: actionData?.step_id,
      unit_id: actionData?.unit_id,
      button_pressed: actionData?.button_pressed,
      timestamp: new Date().toISOString(),
      details: actionData,
    };

    await this.syncState(syncData);
  }

  /**
   * 廣播：受試者名稱更新
   */
  async broadcastSubjectNameChange(updateData) {
    const syncData = {
      type: "subjectNameUpdate",
      device_id: this.deviceId,
      experiment_id: updateData?.experimentId,
      subject_name: updateData?.subjectName,
      timestamp: new Date().toISOString(),
    };

    await this.syncState(syncData);
  }

  /**
   * 廣播：實驗 ID 更新
   */
  async broadcastExperimentIdUpdate(updateData) {
    try {
      Logger.debug(
        `[ExperimentSyncManager] 📢 廣播實驗ID更新開始: ${updateData?.experimentId}`
      );

      const syncData = {
        type: "experimentIdUpdate",
        device_id: this.deviceId,
        experiment_id: updateData?.experimentId,
        timestamp: new Date().toISOString(),
      };

      await this.syncState(syncData);
      Logger.info(
        `[ExperimentSyncManager] 實驗ID更新已廣播: ${updateData?.experimentId}`
      );
    } catch (error) {
      Logger.error(
        `[ExperimentSyncManager] 廣播實驗ID更新失敗: ${error.message}`,
        error
      );
    }
  }

  /**
   * 廣播：按鈕動作
   * @param {Object} buttonData - 包含 button 和 function 的資料
   */
  async broadcastButtonAction(buttonData) {
    const syncData = {
      type: "buttonAction",
      device_id: this.deviceId,
      experimentId: buttonData?.experimentId,
      experiment_id: buttonData?.experimentId,
      action_id: buttonData?.action_id, // 傳遞 action_id
      button: buttonData?.buttonData?.button,
      button_id: buttonData?.buttonData?.button,
      function: buttonData?.buttonData?.function,
      button_function: buttonData?.buttonData?.function,
      timestamp: buttonData?.timestamp || new Date().toISOString(),
    };

    await this.syncState(syncData);
  }

  /**
   * 執行狀態同步
   */
  async syncState(syncData) {
    if (!this.isConnected) return;

    try {
      await window.syncManager?.core?.syncState?.(syncData);
    } catch (error) {
      // 同步失敗時保持流程繼續
    }
  }

  /**
   * 處理實驗狀態請求（當 Viewer 加入時請求目前狀態）
   */
  async handleExperimentStateRequest(syncData) {
    let experimentId = "";
    let subjectName = "";
    let combinationName = "";
    let gestures = [];
    let hasExperiment = false;

    // 嘗試從 experiment.html（window.app）取得資料
    if (window.app?.experimentRunning && window.app?.currentCombination) {
      hasExperiment = true;
      experimentId = document.getElementById("experimentIdInput")?.value || "";
      subjectName = document.getElementById("subjectNameInput")?.value || "";
      combinationName = window.app.currentCombination.combination_name || "";
      gestures = window.app.currentCombination.gestures || [];
    }
    // 嘗試從 index.html（panel-experiment-manager）取得資料
    else if (
      window.experimentManager?.isExperimentRunning &&
      window.experimentManager?.currentCombination
    ) {
      hasExperiment = true;
      experimentId = window.experimentManager.getCurrentExperimentId();
      subjectName = document.getElementById("subjectNameInput")?.value || "";
      combinationName =
        window.experimentManager.currentCombination.combination_name || "";
      gestures = window.experimentManager.currentCombination.gestures || [];
    }

    if (hasExperiment && window.syncManager?.core?.syncState) {
      await window.syncManager.core.syncState({
        type: "experiment_started",
        experimentId: experimentId,
        experiment_id: experimentId,
        subjectName: subjectName,
        subject_name: subjectName,
        combinationName: combinationName,
        combination_name: combinationName,
        gestureSequence: gestures,
        gesture_sequence: gestures,
        gestures: gestures,
        unitCount:
          window.experimentManager?.loadedUnits?.length ||
          window.app?.currentCombination?.units?.length ||
          0,
        unit_count:
          window.experimentManager?.loadedUnits?.length ||
          window.app?.currentCombination?.units?.length ||
          0,
        gestureCount: gestures.length,
        gesture_count: gestures.length,
        device_id: this.deviceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 處理來自其他裝置的實驗開始事件
   */
  handleRemoteExperimentStarted(syncData) {
    if (syncData.device_id === this.deviceId) return;

    // 廣播到本機視窗，供 Viewer 監聽
    window.dispatchEvent(
      new CustomEvent("remote_experiment_started", {
        detail: {
          remote_device_id: syncData.device_id,
          experiment_id: syncData.experiment_id,
          subject_name: syncData.subject_name,
          combination_id: syncData.combination_id,
          combination_name: syncData.combination_name,
          gesture_sequence: syncData.gesture_sequence || syncData.gestures,
          gestures: syncData.gesture_sequence || syncData.gestures,
          unit_count: syncData.unit_count,
          gesture_count: syncData.gesture_count,
          timestamp: syncData.timestamp,
        },
      })
    );
  }

  /**
   * 處理來自其他裝置的狀態變化
   */
  handleRemoteStateChange(syncData) {
    if (syncData.device_id === this.deviceId) return;

    if (syncData.type === "buttonAction") {
      this.handleRemoteButtonAction(syncData);
      return;
    }

    const eventMap = {
      experiment_started: "remote_experiment_started",
      experiment_paused: "remote_experiment_paused",
      experiment_resumed: "remote_experiment_resumed",
      experiment_stopped: "remote_experiment_stopped",
    };

    const eventName = eventMap[syncData.event];
    if (eventName) {
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: {
            remote_device_id: syncData.device_id,
            experimentId: syncData.experiment_id,
            experiment_id: syncData.experiment_id,
            subjectName: syncData.subject_name,
            subject_name: syncData.subject_name,
            combinationId: syncData.combination_id,
            combination_id: syncData.combination_id,
            combinationName: syncData.combination_name,
            combination_name: syncData.combination_name,
            gestureSequence: syncData.gesture_sequence,
            gesture_sequence: syncData.gesture_sequence,
            unitCount: syncData.unit_count,
            unit_count: syncData.unit_count,
            gestureCount: syncData.gesture_count,
            gesture_count: syncData.gesture_count,
            state: syncData.state,
            timestamp: syncData.timestamp,
          },
        })
      );
    }
  }

  /**
   * 處理遠端受試者名稱更新
   */
  handleRemoteSubjectNameChange(syncData) {
    if (syncData.device_id === this.deviceId) return;

    // 直接調用對應管理器的處理函數，避免重複事件
    const data = {
      subjectName: syncData.subject_name,
      subject_name: syncData.subject_name,
      experimentId: syncData.experiment_id,
      experiment_id: syncData.experiment_id,
      remote_device_id: syncData.device_id,
      timestamp: syncData.timestamp,
    };

    // 調用面板管理器的處理函數
    if (
      window.panelExperiment &&
      typeof window.panelExperiment.handleRemoteSubjectNameUpdate === "function"
    ) {
      window.panelExperiment.handleRemoteSubjectNameUpdate(data);
    }

    // 調用實驗頁面管理器的處理函數
    if (
      window.app &&
      typeof window.app.handleRemoteSubjectNameUpdate === "function"
    ) {
      window.app.handleRemoteSubjectNameUpdate(data);
    }
  }

  /**
   * 處理遠端實驗 ID 更新
   */
  /**
   * 處理遠端實驗ID更改
   */
  handleRemoteExperimentIdChange(syncData) {
    if (syncData.device_id === this.deviceId) {
      Logger.debug(
        `[ExperimentSyncManager] 略過自己的實驗ID更新: ${syncData.device_id}`
      );
      return;
    }

    Logger.debug(`[ExperimentSyncManager] 收到遠端實驗ID更新:`, syncData);

    // 直接調用對應管理器的處理函數，避免重複事件
    const data = {
      experimentId: syncData.experiment_id,
      experiment_id: syncData.experiment_id,
      remote_device_id: syncData.device_id,
      timestamp: syncData.timestamp,
    };

    // 調用面板管理器的處理函數
    if (
      window.panelExperiment &&
      typeof window.panelExperiment.handleRemoteExperimentIdUpdate ===
        "function"
    ) {
      Logger.debug(
        `[ExperimentSyncManager] 路由到 panelExperiment.handleRemoteExperimentIdUpdate`
      );
      window.panelExperiment.handleRemoteExperimentIdUpdate(data);
    }

    // 調用實驗頁面管理器的處理函數
    if (
      window.app &&
      typeof window.app.handleRemoteExperimentIdUpdate === "function"
    ) {
      Logger.debug(
        `[ExperimentSyncManager] 路由到 app.handleRemoteExperimentIdUpdate`
      );
      window.app.handleRemoteExperimentIdUpdate(data);
    }
  }

  /**
   * 處理遠端按鈕動作
   */
  handleRemoteButtonAction(syncData) {
    if (syncData.device_id === this.deviceId) return;

    window.dispatchEvent(
      new CustomEvent("remote_button_action", {
        detail: {
          remote_device_id: syncData.device_id,
          experiment_id: syncData.experiment_id,
          action_id: syncData.action_id, // 傳遞 action_id
          button: syncData.button,
          button_id: syncData.button,
          function: syncData.function,
          button_function: syncData.function,
          timestamp: syncData.timestamp,
        },
      })
    );
  }

  /**
   * 處理遠端一般操作
   */
  handleRemoteAction(syncData) {
    if (syncData.device_id === this.deviceId) return;

    window.dispatchEvent(
      new CustomEvent("remote_experiment_action", {
        detail: {
          remote_device_id: syncData.device_id,
          action_type: syncData.action_type,
          step_id: syncData.step_id,
          unit_id: syncData.unit_id,
          button_pressed: syncData.button_pressed,
          timestamp: syncData.timestamp,
          details: syncData.details,
        },
      })
    );
  }

  /**
   * 處理遠端 Action 完成訊息
   */
  handleRemoteActionCompleted(syncData) {
    if (syncData.device_id === this.deviceId) return;

    const buttons = document.querySelectorAll(
      `.action-button[data-action-id="${syncData.action_id}"][data-gesture-index="${syncData.gesture_index}"]`
    );

    buttons.forEach((button) => {
      if (window.markActionCompleted) {
        window.markActionCompleted(
          button,
          syncData.action_id,
          syncData.gesture_index,
          true
        );
      }
    });
  }

  /**
   * 處理遠端 Action 取消訊息
   */
  handleRemoteActionCancelled(syncData) {
    if (syncData.device_id === this.deviceId) return;

    const buttons = document.querySelectorAll(
      `.action-button[data-action-id="${syncData.action_id}"][data-gesture-index="${syncData.gesture_index}"]`
    );

    buttons.forEach((button) => {
      button.setAttribute("data-completed", "false");
      button.style.background = "#e8eeff";
      button.style.borderColor = "#667eea";
      button.style.boxShadow = "";
    });
  }

  /**
   * 處理遠端步驟完成訊息
   */
  handleRemoteStepCompleted(syncData) {
    if (syncData.device_id === this.deviceId) return;

    window.dispatchEvent(
      new CustomEvent("remote_step_completed", {
        detail: {
          remote_device_id: syncData.device_id,
          step_index: syncData.step_index,
          gesture_name: syncData.gesture_name,
          timer_value: syncData.timer_value,
          timestamp: syncData.timestamp,
        },
      })
    );
  }

  /**
   * 取得目前的連線與實驗狀態
   */
  getStatus() {
    return {
      connected: this.isConnected,
      deviceId: this.deviceId,
      experimentState: this.experimentState,
    };
  }
}

// 初始化全域實例
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.experimentSyncManager = new ExperimentSyncManager();
  });
} else {
  window.experimentSyncManager = new ExperimentSyncManager();
}
