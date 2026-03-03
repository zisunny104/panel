/**
 * ExperimentActionHandler - 實驗動作處理器
 * Phase 3 - P1 輔助模組
 *
 * 職責：
 * 1. 動作判定邏輯
 * 2. 手勢處理
 * 3. 步驟轉換邏輯
 * 4. 自動推進機制
 * 5. 遠端同步處理
 * 6. 錯誤處理
 *
 * 提取來源：
 * - action-manager.js (動作序列管理)
 * - panel-experiment-flow.js (步驟執行邏輯)
 */

class ExperimentActionHandler {
  /**
   * 事件類型常數
   */
  static EVENT = {
    ACTION_VALIDATED: "action:validated",
    ACTION_COMPLETED: "action:completed",
    ACTION_FAILED: "action:failed",
    GESTURE_DETECTED: "action:gesture_detected",
    SEQUENCE_COMPLETED: "action:sequence_completed",
    AUTO_PROGRESS: "action:auto_progress",
    REMOTE_ACTION: "action:remote_action",
    ERROR: "action:error",
  };

  constructor(config = {}) {
    // 配置
    this.config = {
      enableRemoteSync: config.enableRemoteSync !== false,
      enableAutoProgress: config.enableAutoProgress !== false,
      autoProgressDelay: config.autoProgressDelay || 3000,
      enableGestureValidation: config.enableGestureValidation !== false,
      ...config,
    };

    // 動作序列狀態
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionHistory = [];

    // 手勢狀態
    this.gestureSequence = [];
    this.currentGestureIndex = 0;

    // 自動推進計時器
    this.autoProgressTimer = null;

    // 事件監聽器
    this.eventListeners = new Map();

    // 依賴注入
    this.dependencies = {
      flowManager: null,
      hubManager: null,
    };
    Logger.debug("ExperimentActionHandler 初始化完成");
  }

  // ==================== 依賴注入 ====================

  /**
   * 注入 FlowManager
   */
  injectFlowManager(flowManager) {
    this.dependencies.flowManager = flowManager;
    Logger.debug("FlowManager 已注入到 ActionHandler");
    return this;
  }

  /**
   * 注入 HubManager
   */
  injectHubManager(hubManager) {
    this.dependencies.hubManager = hubManager;
    Logger.debug("HubManager 已注入到 ActionHandler");
    return this;
  }

  // ==================== 動作序列管理 ====================

  /**
   * 初始化動作序列
   */
  initializeSequence(actions) {
    if (!Array.isArray(actions)) {
      Logger.error("動作序列必須是陣列");
      return false;
    }

    this.currentActionSequence = actions;
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.actionHistory = [];

    Logger.debug("動作序列已初始化", {
      actionCount: actions.length,
    });

    return true;
  }

  /**
   * 取得目前動作
   */
  getCurrentAction() {
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      return null;
    }
    return this.currentActionSequence[this.currentActionIndex];
  }

  /**
   * 取得下一個動作
   */
  getNextAction() {
    const nextIndex = this.currentActionIndex + 1;
    if (nextIndex >= this.currentActionSequence.length) {
      return null;
    }
    return this.currentActionSequence[nextIndex];
  }

  /**
   * 取得動作序列進度
   */
  getProgress() {
    return {
      current: this.currentActionIndex,
      total: this.currentActionSequence.length,
      completed: this.completedActions.size,
      percentage:
        this.currentActionSequence.length > 0
          ? Math.round(
              (this.completedActions.size / this.currentActionSequence.length) *
                100,
            )
          : 0,
    };
  }

  // ==================== 動作判定 ====================

  /**
   * 驗證動作是否正確
   */
  validateAction(actionId, actionData = {}) {
    const currentAction = this.getCurrentAction();

    if (!currentAction) {
      return {
        valid: false,
        error: "沒有目前動作",
      };
    }

    // 檢查動作 ID 是否符合
    if (
      currentAction.actionId !== actionId &&
      currentAction.expected_button !== actionId
    ) {
      return {
        valid: false,
        error: "動作不符合預期",
        expected: currentAction.expected_button || currentAction.actionId,
        actual: actionId,
      };
    }

    // 如果啟用手勢驗證，檢查手勢序列
    if (
      this.config.enableGestureValidation &&
      this.gestureSequence.length > 0
    ) {
      const gestureValid = this.validateGesture(actionId);
      if (!gestureValid.valid) {
        return gestureValid;
      }
    }

    this.emit(ExperimentActionHandler.EVENT.ACTION_VALIDATED, {
      actionId,
      actionData,
      currentAction,
    });

    return {
      valid: true,
      action: currentAction,
    };
  }

  /**
   * 處理正確動作
   */
  handleCorrectAction(actionId, actionData = {}) {
    const validation = this.validateAction(actionId, actionData);

    if (!validation.valid) {
      return this.handleIncorrectAction(actionId, validation.error);
    }

    const action = validation.action;

    // 記錄到歷史
    this.actionHistory.push({
      actionId,
      timestamp: Date.now(),
      correct: true,
      ...actionData,
    });

    // 標記為完成
    this.completedActions.add(action.actionId);
    this.currentActionIndex++;

    Logger.info("動作完成", {
      actionId,
      progress: `${this.currentActionIndex}/${this.currentActionSequence.length}`,
    });

    this.emit(ExperimentActionHandler.EVENT.ACTION_COMPLETED, {
      actionId,
      action,
      progress: this.getProgress(),
    });

    // 檢查序列是否完成
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      this.handleSequenceCompleted();
    } else {
      // 啟用自動推進（如果配置）
      if (this.config.enableAutoProgress) {
        this.scheduleAutoProgress();
      }
    }

    // 遠端同步
    if (this.config.enableRemoteSync) {
      this.syncActionToRemote(actionId, "completed");
    }

    return true;
  }

  /**
   * 處理錯誤動作
   */
  handleIncorrectAction(actionId, error) {
    const currentAction = this.getCurrentAction();

    // 記錄到歷史
    this.actionHistory.push({
      actionId,
      timestamp: Date.now(),
      correct: false,
      error,
    });

    Logger.warn("錯誤動作", {
      actionId,
      expected: currentAction?.actionId || currentAction?.expected_button,
      error,
    });

    this.emit(ExperimentActionHandler.EVENT.ACTION_FAILED, {
      actionId,
      error,
      expected: currentAction,
    });

    return false;
  }

  /**
   * 完成目前動作（不進行驗證）
   */
  completeCurrentAction() {
    const currentAction = this.getCurrentAction();
    if (!currentAction) {
      Logger.warn("沒有目前動作可完成");
      return false;
    }

    // 記錄到歷史
    this.actionHistory.push({
      actionId: currentAction.actionId,
      timestamp: Date.now(),
      correct: true, // 直接完成視為正確
      skipped: true, // 標記為跳過
    });

    // 標記為完成
    this.completedActions.add(currentAction.actionId);
    this.currentActionIndex++;

    Logger.info("動作已完成（跳過）", {
      actionId: currentAction.actionId,
      progress: `${this.currentActionIndex}/${this.currentActionSequence.length}`,
    });

    this.emit(ExperimentActionHandler.EVENT.ACTION_COMPLETED, {
      actionId: currentAction.actionId,
      action: currentAction,
      progress: this.getProgress(),
      skipped: true,
    });

    // 檢查序列是否完成
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      this.handleSequenceCompleted();
    } else {
      // 啟用自動推進（如果配置）
      if (this.config.enableAutoProgress) {
        this.scheduleAutoProgress();
      }
    }

    // 遠端同步
    if (this.config.enableRemoteSync) {
      this.syncActionToRemote(currentAction.actionId, "completed");
    }

    return true;
  }

  /**
   * 記錄動作歷史
   */
  getActionHistory() {
    return [...this.actionHistory];
  }

  /**
   * 清除動作歷史
   */
  clearActionHistory() {
    this.actionHistory = [];
  }

  // ==================== 手勢處理 ====================

  /**
   * 設定手勢序列
   */
  setGestureSequence(gestures) {
    if (!Array.isArray(gestures)) {
      Logger.error("手勢序列必須是陣列");
      return false;
    }

    this.gestureSequence = gestures;
    this.currentGestureIndex = 0;

    Logger.debug("手勢序列已設定", {
      gestureCount: gestures.length,
    });

    return true;
  }

  /**
   * 處理按鈕點擊手勢
   */
  handleButtonClick(buttonId) {
    Logger.debug("處理按鈕點擊", buttonId);

    this.emit(ExperimentActionHandler.EVENT.GESTURE_DETECTED, {
      type: "button_click",
      buttonId,
      timestamp: Date.now(),
    });

    return this.handleCorrectAction(buttonId, {
      gestureType: "button_click",
    });
  }

  /**
   * 處理手勢組合
   */
  handleGestureCombination(gestures) {
    if (!Array.isArray(gestures)) {
      return false;
    }

    Logger.debug("處理手勢組合", gestures);

    // 驗證手勢序列
    for (let i = 0; i < gestures.length; i++) {
      const valid = this.validateGesture(gestures[i]);
      if (!valid.valid) {
        return false;
      }
    }

    this.emit(ExperimentActionHandler.EVENT.GESTURE_DETECTED, {
      type: "gesture_combination",
      gestures,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 驗證手勢順序
   */
  validateGesture(gestureId) {
    if (this.gestureSequence.length === 0) {
      return { valid: true };
    }

    if (this.currentGestureIndex >= this.gestureSequence.length) {
      return {
        valid: false,
        error: "手勢序列已完成",
      };
    }

    const expectedGesture = this.gestureSequence[this.currentGestureIndex];

    if (expectedGesture !== gestureId) {
      return {
        valid: false,
        error: "手勢順序不正確",
        expected: expectedGesture,
        actual: gestureId,
      };
    }

    this.currentGestureIndex++;

    return { valid: true };
  }

  /**
   * 重置手勢序列
   */
  resetGestureSequence() {
    this.currentGestureIndex = 0;
  }

  // ==================== 步驟轉換 ====================

  /**
   * 執行步驟轉換
   */
  executeStepTransition(toStep) {
    const flowManager = this.dependencies.flowManager;

    if (!flowManager) {
      Logger.warn("FlowManager 未注入，無法執行步驟轉換");
      return false;
    }

    Logger.debug("執行步驟轉換", toStep);

    // 觸發 FlowManager 的步驟轉換
    const success = flowManager.nextStep();

    if (success) {
      // 清除目前動作序列，準備載入新步驟的動作
      this.currentActionIndex = 0;
    }

    return success;
  }

  /**
   * 設定轉換條件
   */
  setTransitionCondition(condition) {
    this.transitionCondition = condition;
    Logger.debug("步驟轉換條件已設定");
  }

  /**
   * 檢查轉換條件
   */
  checkTransitionCondition() {
    if (!this.transitionCondition) {
      return true;
    }

    if (typeof this.transitionCondition === "function") {
      return this.transitionCondition();
    }

    return true;
  }

  /**
   * 處理序列完成
   */
  handleSequenceCompleted() {
    Logger.info("動作序列已完成");

    this.emit(ExperimentActionHandler.EVENT.SEQUENCE_COMPLETED, {
      totalActions: this.currentActionSequence.length,
      completedActions: this.completedActions.size,
      history: this.getActionHistory(),
    });

    // 檢查是否需要自動轉換到下一步
    if (this.checkTransitionCondition()) {
      this.executeStepTransition();
    }
  }

  // ==================== 自動推進 ====================

  /**
   * 啟用自動推進
   */
  enableAutoProgress(delay = null) {
    this.config.enableAutoProgress = true;
    if (delay !== null) {
      this.config.autoProgressDelay = delay;
    }
    Logger.debug("自動推進已啟用", {
      delay: this.config.autoProgressDelay,
    });
  }

  /**
   * 停用自動推進
   */
  disableAutoProgress() {
    this.config.enableAutoProgress = false;
    this.clearAutoProgress();
    Logger.debug("自動推進已停用");
  }

  /**
   * 排程自動推進
   */
  scheduleAutoProgress() {
    this.clearAutoProgress();

    this.autoProgressTimer = setTimeout(() => {
      Logger.debug("自動推進觸發");

      const nextAction = this.getCurrentAction();
      if (nextAction) {
        this.emit(ExperimentActionHandler.EVENT.AUTO_PROGRESS, {
          actionId: nextAction.actionId,
        });

        // 自動執行下一個動作
        this.handleCorrectAction(nextAction.actionId, {
          auto: true,
        });
      }
    }, this.config.autoProgressDelay);
  }

  /**
   * 清除自動推進計時器
   */
  clearAutoProgress() {
    if (this.autoProgressTimer) {
      clearTimeout(this.autoProgressTimer);
      this.autoProgressTimer = null;
    }
  }

  // ==================== 遠端同步 ====================

  /**
   * 同步動作到遠端
   */
  syncActionToRemote(actionId, status) {
    const hubManager = this.dependencies.hubManager;

    if (!hubManager || !hubManager.isHubMode()) {
      return false;
    }

    const data = {
      type: "action_update",
      actionId,
      status,
      timestamp: Date.now(),
      experimentId: hubManager.getExperimentId(),
    };

    const success = hubManager.sendMessage("action_sync", data);

    if (success) {
      Logger.debug("動作已同步到遠端", { actionId, status });
    }

    return success;
  }

  /**
   * 處理來自遠端的動作
   */
  handleRemoteAction(data) {
    const { actionId, status, source } = data;

    Logger.debug("收到遠端動作", { actionId, status, source });

    this.emit(ExperimentActionHandler.EVENT.REMOTE_ACTION, {
      actionId,
      status,
      source,
    });

    if (status === "completed") {
      // 標記為完成但不觸發本機邏輯
      this.completedActions.add(actionId);

      // 更新索引
      const actionIndex = this.currentActionSequence.findIndex(
        (a) => a.actionId === actionId,
      );

      if (actionIndex !== -1) {
        this.currentActionIndex = Math.max(
          this.currentActionIndex,
          actionIndex + 1,
        );
      }
    }
  }

  // ==================== 錯誤處理 ====================

  /**
   * 處理無效動作
   */
  handleInvalidAction(actionId, reason) {
    Logger.error("無效動作", { actionId, reason });

    this.emit(ExperimentActionHandler.EVENT.ERROR, {
      type: "invalid_action",
      actionId,
      reason,
    });

    return false;
  }

  /**
   * 處理同步失敗
   */
  handleSyncFailure(error) {
    Logger.error("同步失敗", error);

    this.emit(ExperimentActionHandler.EVENT.ERROR, {
      type: "sync_failure",
      error,
    });
  }

  // ==================== 事件通知 ====================

  /**
   * 註冊事件監聽器
   */
  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  /**
   * 移除事件監聽器
   */
  off(eventType, callback) {
    if (!this.eventListeners.has(eventType)) return;

    const listeners = this.eventListeners.get(eventType);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 觸發事件
   */
  emit(eventType, data) {
    if (!this.eventListeners.has(eventType)) return;

    const listeners = this.eventListeners.get(eventType);
    listeners.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        Logger.error(`事件處理器錯誤 (${eventType})`, error);
      }
    });
  }

  /**
   * 清除所有事件監聽器
   */
  clearListeners(eventType = null) {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 取得處理器狀態
   */
  getState() {
    return {
      currentActionIndex: this.currentActionIndex,
      totalActions: this.currentActionSequence.length,
      completedActions: this.completedActions.size,
      gestureSequence: [...this.gestureSequence],
      currentGestureIndex: this.currentGestureIndex,
      config: { ...this.config },
    };
  }

  /**
   * 重置處理器
   */
  reset() {
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.actionHistory = [];
    this.gestureSequence = [];
    this.currentGestureIndex = 0;
    this.clearAutoProgress();
    Logger.debug("ActionHandler 已重置");
  }

  /**
   * 銷毀處理器
   */
  destroy() {
    this.reset();
    this.clearListeners();
    this.transitionCondition = null;
    Logger.debug("ActionHandler 已銷毀");
  }
}

// 導出到全域（用於向後相容）
if (typeof window !== "undefined") {
  window.ExperimentActionHandler = ExperimentActionHandler;
}

// 支援模組導出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentActionHandler;
}
