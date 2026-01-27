/**
 * ActionManager - 統一動作管理器
 *
 * 整合面板和實驗頁面的動作序列管理
 * 通過配置參數適應不同頁面的需求
 */
class ActionManager {
  constructor(options = {}) {
    this.options = {
      pageType: options.pageType || this.detectPageType(), // 'panel' 或 'experiment'
      enableRemoteSync: options.enableRemoteSync !== false,
      ...options,
    };

    // 核心狀態
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionsMap = new Map();
    this.actionToStepMap = new Map();
    this.isInitialized = false;

    Logger.debug(`ActionManager 已建立 (${this.options.pageType}模式)`);

    // 設置全域引用
    this.setupGlobalReference();

    // 設置事件監聽器
    if (this.options.enableRemoteSync) {
      this.setupEventListeners();
    }
  }

  /**
   * 偵測頁面類型
   */
  detectPageType() {
    if (window.location.pathname.includes("experiment.html")) {
      return "experiment";
    }
    return "panel";
  }

  /**
   * 設置全域引用
   */
  setupGlobalReference() {
    window.actionManager = this;
  }

  /**
   * 設置事件監聽器
   */
  setupEventListeners() {
    if (this.options.pageType === "panel") {
      // 面板模式：監聽來自實驗管理的動作完成事件
      window.addEventListener("sync_state_update", (event) => {
        const state = event.detail;
        if (
          state?.type === "action_completed" &&
          state.source === "experiment"
        ) {
          this.handleRemoteActionCompleted(state);
        } else if (state?.type === "step_cancelled") {
          this.handleRemoteStepCancelled(state);
        }
      });
    } else if (this.options.pageType === "experiment") {
      // 實驗模式：監聽來自面板的按鈕按下事件
      this.setupRemoteButtonListener();
    }
  }

  /**
   * 設置遠端按鈕監聽器（實驗模式）
   */
  setupRemoteButtonListener() {
    // 清理舊的監聽器
    if (this.handleRemoteButtonBound) {
      window.removeEventListener(
        "sync_state_update",
        this.handleRemoteButtonBound,
      );
    }

    this.handleRemoteButtonBound = (event) => {
      const state = event.detail;
      if (state?.type === "button_pressed") {
        const { experiment_id, actionId } = state;
        if (window.experiment?.currentExperimentId !== experiment_id) {
          Logger.warn("實驗ID不相符，忽略遠端按鈕");
          return;
        }
        // 找到對應的動作並完成
        this.completeActionById(actionId);
      }
    };

    window.addEventListener("sync_state_update", this.handleRemoteButtonBound);
  }

  /**
   * 處理遠端動作完成（面板模式）
   */
  handleRemoteActionCompleted(state) {
    const { actionId } = state;
    this.completeActionById(actionId);
  }

  /**
   * 處理遠端步驟取消
   */
  handleRemoteStepCancelled(state) {
    const { step_id } = state;
    this.cancelStep(step_id);
  }

  /**
   * 根據動作ID完成動作
   */
  completeActionById(actionId) {
    const action = this.currentActionSequence.find(
      (a) => a.actionId === actionId,
    );
    if (action && !this.completedActions.has(actionId)) {
      this.completedActions.add(actionId);
      this.currentActionIndex = Math.max(
        this.currentActionIndex,
        this.currentActionSequence.indexOf(action) + 1,
      );
      Logger.info(`動作完成: ${actionId}`);
    }
  }

  /**
   * 取消步驟（重置該步驟的所有動作狀態）
   */
  cancelStep(stepId) {
    const stepActions = this.getStepActions(stepId);
    stepActions.forEach((action) => {
      this.completedActions.delete(action.actionId);
    });

    // 重新計算目前進度
    this.updateCurrentIndex();
    Logger.info(`步驟取消: ${stepId}`);
  }

  /**
   * 更新目前動作索引
   */
  updateCurrentIndex() {
    for (let i = 0; i < this.currentActionSequence.length; i++) {
      if (!this.completedActions.has(this.currentActionSequence[i].actionId)) {
        this.currentActionIndex = i;
        return;
      }
    }
    this.currentActionIndex = this.currentActionSequence.length;
  }

  /**
   * 從實驗管理器初始化動作序列
   */
  async initializeFromExperiment() {
    const experimentManager =
      this.options.pageType === "panel"
        ? window.panelExperiment
        : window.experiment;

    if (!experimentManager?.isExperimentRunning || !window._allUnits) {
      return false;
    }

    try {
      const unitIds = experimentManager.loadedUnits;
      if (!unitIds || unitIds.length === 0) return false;

      const actionSequence = buildActionSequenceFromUnits(
        unitIds,
        window._allUnitsActionsMap || new Map(),
        window._allUnits,
      );

      if (actionSequence && actionSequence.length > 0) {
        this.currentActionSequence = actionSequence;
        this.actionsMap = window._allUnitsActionsMap || new Map();
        this.actionToStepMap = window._allUnitsActionToStepMap || new Map();
        this.currentActionIndex = 0;
        this.completedActions.clear();
        this.isInitialized = true;

        Logger.info(
          `動作序列已初始化，長度: ${this.currentActionSequence.length}`,
        );
        return true;
      }
    } catch (error) {
      Logger.error("動作管理器初始化失敗:", error);
    }
    return false;
  }

  /**
   * 處理遠端動作完成（面板模式）
   */
  handleRemoteActionCompleted(state) {
    const { actionId, clientId, source } = state;

    if (!actionId || source !== "experiment") return;

    if (this.completedActions.has(actionId)) {
      Logger.debug(`動作 ${actionId} 已經完成，忽略遠端請求`);
      return;
    }

    const actionIndex = this.currentActionSequence.findIndex(
      (action) => action.actionId === actionId,
    );

    if (actionIndex === -1) {
      Logger.warn(`找不到對應的動作: ${actionId}`);
      return;
    }

    Logger.info(`接收到遠端強制完成請求: ${actionId} (來自 ${clientId})`);

    this.completedActions.add(actionId);
    this.currentActionIndex = Math.max(
      this.currentActionIndex,
      actionIndex + 1,
    );

    // 更新UI
    if (window.buttonManager) {
      window.buttonManager.updateMediaForCurrentAction();
    }
  }

  /**
   * 取得目前動作
   */
  getCurrentAction() {
    if (
      !this.isInitialized ||
      this.currentActionIndex >= this.currentActionSequence.length
    ) {
      return null;
    }
    return this.currentActionSequence[this.currentActionIndex];
  }

  /**
   * 檢查按鈕是否適用於目前動作
   */
  isButtonValidForCurrentAction(buttonFunction) {
    const currentAction = this.getCurrentAction();
    return currentAction && currentAction.expected_button === buttonFunction;
  }

  /**
   * 完成目前動作
   */
  completeCurrentAction() {
    const currentAction = this.getCurrentAction();
    if (!currentAction) return false;

    this.completedActions.add(currentAction.actionId);
    this.currentActionIndex++;

    Logger.info(
      `動作已完成: ${currentAction.actionId} (${this.currentActionIndex}/${this.currentActionSequence.length})`,
    );

    // 廣播動作完成事件
    this.broadcastActionCompleted(currentAction);

    // 更新UI
    if (window.buttonManager) {
      window.buttonManager.updateMediaForCurrentAction();
    }

    // 檢查是否所有動作都已完成
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      Logger.debug("所有動作已完成，觸發實驗結束邏輯");
      this.onAllActionsCompleted();
    }

    return true;
  }

  /**
   * 當所有動作完成時的回調
   */
  onAllActionsCompleted() {
    // Panel 模式：觸發實驗流程控制器的實驗結束邏輯
    if (this.options.pageType === "panel" && window.panelExperiment?.flow) {
      Logger.debug("Panel 模式：觸發 handleExperimentEnd");
      window.panelExperiment.flow.handleExperimentEnd();
    }
    // Experiment 模式：觸發相應的事件或回調
    else if (this.options.pageType === "experiment") {
      Logger.debug("Experiment 模式：所有動作已完成");
      // 可以在這裡新增 experiment.html 的相應處理
      document.dispatchEvent(new CustomEvent("allActionsCompleted"));
    }
  }

  /**
   * 廣播動作完成事件
   */
  broadcastActionCompleted(action) {
    if (!window.syncManager?.core) return;

    const state = {
      type: window.SyncDataTypes.ACTION_COMPLETED,
      source: this.options.pageType,
      clientId: window.syncClient?.clientId || "action_manager",
      actionId: action.actionId,
      step_id: action.step_id,
      action_sequence_progress: {
        current: this.currentActionIndex,
        total: this.currentActionSequence.length,
        completed: Array.from(this.completedActions),
      },
      timestamp: window.timeSyncManager?.isSynchronized()
        ? window.timeSyncManager.getServerTime()
        : Date.now(),
    };

    window.syncManager.core.syncState(state).catch((error) => {
      Logger.warn("廣播 action 完成失敗:", error);
    });

    // 檢查對應步驟是否完成
    this.checkStepCompletion(action.step_id);
  }

  /**
   * 檢查步驟完成狀態
   */
  checkStepCompletion(stepId) {
    if (!stepId) return;

    // 取得該步驟的所有動作
    const stepActions = this.getStepActions(stepId);
    if (stepActions.length === 0) return;

    // 檢查是否所有動作都已完成
    const completedActions = stepActions.filter((action) =>
      this.completedActions.has(action.actionId),
    );

    if (completedActions.length === stepActions.length) {
      // 步驟完成
      this.broadcastStepCompleted(stepId);
    }
  }

  /**
   * 取得步驟的所有動作
   */
  getStepActions(stepId) {
    return this.currentActionSequence.filter(
      (action) => action.step_id === stepId,
    );
  }

  /**
   * 廣播步驟完成事件
   */
  broadcastStepCompleted(stepId) {
    if (!window.syncManager?.core) return;

    const state = {
      type: window.SyncDataTypes.STEP_COMPLETED,
      step_id: stepId,
      source: this.options.pageType,
      clientId: window.syncClient?.clientId || "action_manager",
      timestamp: window.timeSyncManager?.isSynchronized()
        ? window.timeSyncManager.getServerTime()
        : Date.now(),
    };

    window.syncManager.core.syncState(state).catch((error) => {
      Logger.warn("廣播 step 完成失敗:", error);
    });
  }

  /**
   * 廣播步驟取消事件
   */
  broadcastStepCancelled(stepId) {
    if (!window.syncManager?.core) return;

    const state = {
      type: window.SyncDataTypes.STEP_CANCELLED,
      step_id: stepId,
      source: this.options.pageType,
      clientId: window.syncClient?.clientId || "action_manager",
      timestamp: window.timeSyncManager?.isSynchronized()
        ? window.timeSyncManager.getServerTime()
        : Date.now(),
    };

    window.syncManager.core.syncState(state).catch((error) => {
      Logger.warn("廣播 step 取消失敗:", error);
    });
  }

  /**
   * 取得進度資訊
   */
  getProgress() {
    return {
      current: this.currentActionIndex,
      total: this.currentActionSequence.length,
      completed: Array.from(this.completedActions),
      isComplete: this.currentActionIndex >= this.currentActionSequence.length,
    };
  }

  /**
   * 重設動作序列
   */
  reset() {
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.isInitialized = false;
  }

  /**
   * 清理資源
   */
  cleanup() {
    if (this.handleRemoteButtonBound) {
      window.removeEventListener(
        "button_pressed",
        this.handleRemoteButtonBound,
      );
    }
    window.actionManager = null;
  }
}

// 匯出給全域使用
window.ActionManager = ActionManager;

// 自動建立全域實例
if (!window.actionManager) {
  window.actionManager = new ActionManager();
  Logger.debug("ActionManager 全域實例已自動建立");
}
