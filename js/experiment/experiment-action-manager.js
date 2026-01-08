// experiment-action-manager.js - 實驗頁面動作管理器
// 提供 action-based 實驗的核心動作管理功能
// 專門用於 experiment.html

class ExperimentActionManager {
  constructor() {
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionsMap = new Map();
    this.actionToStepMap = new Map();
    this.isInitialized = false;

    // 擴展功能 - 可由具體實現覆寫
    this.actionTimings = new Map(); // action 執行時間
    this.processedRemoteActions = new Map(); // 已處理的遠端動作
    this.remotActionDedupeWindow = 500; // 重複排除機制時間視窗（毫秒）
  }

  // 從實驗管理器同步動作序列
  async initializeFromExperiment() {
    if (!window.experiment?.isExperimentRunning || !window._allUnits) {
      return false;
    }

    try {
      // 取得目前實驗的單元列表
      const unitIds = window.experiment.loadedUnits;
      if (!unitIds || unitIds.length === 0) return false;

      // 構建動作序列
      const allActionsMap = window._allUnitsActionsMap || new Map();
      const actionSequence = buildActionSequenceFromUnits(
        unitIds,
        allActionsMap,
        window._allUnits
      );

      if (actionSequence && actionSequence.length > 0) {
        this.currentActionSequence = actionSequence;
        this.actionsMap = allActionsMap;
        this.actionToStepMap = window._allUnitsActionToStepMap || new Map();
        this.currentActionIndex = 0;
        this.completedActions.clear();
        this.isInitialized = true;

        this.setupRemoteButtonListener();

        return true;
      }
    } catch (error) {
      Logger.error("動作管理器初始化失敗:", error);
    }
    return false;
  }

  // 📡 監聽來自其他裝置的遠端按鈕動作
  setupRemoteButtonListener() {
    // 移除舊的監聽器以防重複
    window.removeEventListener(
      "remoteButtonPressed",
      this.handleRemoteButtonBound
    );

    // 綁定 this 上下文
    this.handleRemoteButtonBound = (e) => {
      const { button, experimentId } = e.detail;
      // 驗證實驗ID是否相同
      if (window.experiment?.currentExperimentId !== experimentId) {
        Logger.warn(
          `實驗ID不相符，忽略遠端按鈕: 期望=${window.experiment?.currentExperimentId}, 收到=${experimentId}`
        );
        return;
      }

      // 推進目前動作
      this.completeCurrentAction();
    };

    // 設定事件監聽器
    window.addEventListener(
      "remoteButtonPressed",
      this.handleRemoteButtonBound
    );
  }

  // 取得目前動作
  getCurrentAction() {
    if (
      !this.isInitialized ||
      this.currentActionIndex >= this.currentActionSequence.length
    ) {
      return null;
    }
    const currentAction = this.currentActionSequence[this.currentActionIndex];
    return currentAction;
  }

  // 檢查按鈕是否適用於目前動作
  isButtonValidForCurrentAction(buttonFunction) {
    const currentAction = this.getCurrentAction();
    return currentAction && currentAction.expected_button === buttonFunction;
  }

  // 完成目前動作
  completeCurrentAction() {
    const currentAction = this.getCurrentAction();
    if (currentAction) {
      this.completedActions.add(currentAction.action_id);
      this.currentActionIndex++;

      Logger.info(
        "動作已完成:",
        currentAction.action_id,
        `(${this.currentActionIndex}/${this.currentActionSequence.length})`
      );

      // 記錄動作完成時間（如果需要）
      if (this.actionTimings) {
        this.actionTimings.set(currentAction.action_id, Date.now());
      }

      //記錄到 JSONL 實驗日誌
      if (window.panelExperimentLog) {
        window.panelExperimentLog.logActionComplete(
          currentAction.action_id,
          currentAction.action_name || currentAction.description || "",
          currentAction.button_id || "",
          currentAction.action_buttons || "",
          this.currentActionIndex,
          this.currentActionSequence.length
        );
      }

      // 廣播動作完成事件給多螢幕同步系統
      if (window.syncClient) {
        window.syncClient.broadcastState({
          type: "action_completed",
          action_id: currentAction.action_id,
          action_sequence_progress: {
            current: this.currentActionIndex,
            total: this.currentActionSequence.length,
            completed: Array.from(this.completedActions),
          },
        });
      }

      // 廣播按鈕動作到實驗頁面（用於遠端回饋）
      // 注意：window.panelExperiment 是 PanelExperimentManager 實例
      if (window.panelExperiment) {
        window.panelExperiment.broadcastButtonAction({
          action_id: currentAction.action_id,
          button_id: currentAction.button_id || "",
          action_name: currentAction.action_name || "",
        });
      }

      return true;
    }
    return false;
  }

  // 重設動作序列
  reset() {
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.isInitialized = false;
    if (this.actionTimings) {
      this.actionTimings.clear();
    }
    if (this.processedRemoteActions) {
      this.processedRemoteActions.clear();
    }
  }

  // 取得進度資訊
  getProgress() {
    return {
      current: this.currentActionIndex,
      total: this.currentActionSequence.length,
      completed: Array.from(this.completedActions),
      isComplete: this.currentActionIndex >= this.currentActionSequence.length,
    };
  }

  // 擴展方法 - 處理遠端事件重複排除
  shouldProcessRemoteAction(actionId, timestamp) {
    if (!this.processedRemoteActions || !this.remotActionDedupeWindow) {
      return true; // 如果沒有重複排除機制，允許處理
    }

    const lastProcessed = this.processedRemoteActions.get(actionId);
    if (!lastProcessed) {
      this.processedRemoteActions.set(actionId, timestamp);
      return true;
    }

    if (timestamp - lastProcessed > this.remotActionDedupeWindow) {
      this.processedRemoteActions.set(actionId, timestamp);
      return true;
    }

    return false; // 重複事件，忽略
  }
}

// 匯出 ExperimentActionManager 類別
window.ExperimentActionManager = ExperimentActionManager;
