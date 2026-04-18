/**
 * ExperimentActionHandler - 實驗動作處理器
 *
 * 職責：
 * 1. 動作判定邏輯
 * 2. 手勢處理
 * 3. 步驟轉換邏輯
 * 4. 自動推進機制
 * 5. 遠端同步處理
 * 6. 錯誤處理
 *
 * 角色說明：
 * - Panel（panel.html）：受試者（participant）配戴 MR 裝置操作，
 *   本機按鈕僅供記錄互動，完成後通知 board 端（實驗者）顯示對應標記。
 * - Board（board.html）：實驗者（experimenter）控制流程並手動標記動作完成，
 *   gesture step 的推進由實驗者點擊手勢按鈕觸發，不由 panel 端遠端驅動。
 *
 * 備註：
 * - 對外以事件與公開方法協調動作序列、驗證與同步。
 */

import {
  SYNC_DATA_TYPES,
  SYNC_EVENTS,
  ACTION_HANDLER_EVENTS,
  ACTION_HANDLER_DEFAULTS,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { EventEmitter } from "../core/event-emitter.js";

class ExperimentActionHandler extends EventEmitter {
  /**
   * 事件類型常數
   */
  static EVENT = ACTION_HANDLER_EVENTS;

  static COMPLETION_COOLDOWN_MS = ACTION_HANDLER_DEFAULTS.COMPLETION_COOLDOWN_MS;

  constructor(config = {}) {
    super();
    // 設定
    this.config = {
      enableRemoteSync: config.enableRemoteSync !== false,
      enableAutoProgress: config.enableAutoProgress !== false,
      autoProgressDelay:
        config.autoProgressDelay || ACTION_HANDLER_DEFAULTS.AUTO_PROGRESS_DELAY_MS,
      ...config,
    };

    // 動作序列狀態
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionHistory = [];

    // 自動推進計時器
    this.autoProgressTimer = null;

    // dependencies
    this.dependencies = {
      flowManager: null,
      syncClient: null,
      experimentSystemManager: null,
    };
    Logger.debug("ExperimentActionHandler 初始化完成");
  }

  // ==================== inject dependencies ====================

  /**
   * inject FlowManager
   */
  injectFlowManager(flowManager) {
    this.dependencies.flowManager = flowManager;
    Logger.debug("FlowManager 已 inject 到 ActionHandler");
    return this;
  }

  updateDependencies(deps = {}) {
    Object.assign(this.dependencies, deps);
    return this;
  }

  _getResolvedSyncClient() {
    return (
      this.dependencies.syncClient ||
      this.dependencies.experimentSystemManager?.pageManager?.syncManager?.core
        ?.syncClient ||
      this.dependencies.experimentSystemManager?.pageManager?.syncManager
        ?.syncClient ||
      null
    );
  }

  _isSyncModeActive() {
    return this.dependencies.experimentSystemManager?.pageManager?.syncManager
      ?.isSyncMode === true;
  }

  _shouldWarnMissingSyncClient() {
    return this.config.enableRemoteSync && this._isSyncModeActive();
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
   * 取得 action 的統一識別
   * @private
   */
  _getActionId(action) {
    if (!action || typeof action !== "object") return null;
    return action.actionId || action.action_id || null;
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
    const currentActionId = this._getActionId(currentAction);
    if (currentActionId !== actionId && currentAction.expected_button !== actionId) {
      return {
        valid: false,
        error: "動作不符合預期",
        expected: currentAction.expected_button || currentActionId,
        actual: actionId,
      };
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
   * 處理正確動作（受試者按下正確按鈕時呼叫）
   *
   * 時序邏輯：
   * 1. 發出 ACTION_COMPLETED（目前步驟完成）
   * 2. 推進索引到下一步
   * 3. 發出 ACTION_ENTERED（進入新步驟）
   *
   * 各端的職責：
   * - Panel（受試者）：本機偵測到正確按鈕 → 推進本機 action 序列 →
   *   廣播 ACTION_COMPLETED 通知 board（實驗者）；
   *   透過 ACTION_ENTERED 事件即時更新 MR 顯示（播放下一步媒體）。
   * - Board（實驗者）：接收 ACTION_COMPLETED → 手勢按鈕顯示綠色（視覺回饋）；
   *   gesture step 的推進仍由實驗者自行點擊手勢按鈕決定，不由此訊號驅動。
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
    const normalizedActionId = this._getActionId(action) || actionId;
    this.completedActions.add(normalizedActionId);

    Logger.info("動作完成", {
      actionId: normalizedActionId,
      progress: `${this.currentActionIndex}/${this.currentActionSequence.length}`,
    });

    // [1] 發出已完成事件（在索引推進前）
    this.emit(ExperimentActionHandler.EVENT.ACTION_COMPLETED, {
      actionId: normalizedActionId,
      action,
      progress: this.getProgress(),
    });

    this._broadcastButtonAction(action, actionData);
    this._scheduleCompletionBroadcast(action, actionData);

    // [2] 推進到下一步
    this.currentActionIndex++;

    // [3] 檢查序列是否完成
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      this.handleSequenceCompleted();
    } else {
      // [4] 發出進入新步驟的事件
      const nextAction = this.getCurrentAction();
      const nextActionId = this._getActionId(nextAction);

      this.emit(ExperimentActionHandler.EVENT.ACTION_ENTERED, {
        actionId: nextActionId,
        action: nextAction,
        progress: this.getProgress(),
      });
    }

    this._advanceAfterActionCompletion(normalizedActionId);
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
      expected: currentAction
        ? currentAction.actionId || currentAction.expected_button
        : null,
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
   * 同樣使用改進的時序邏輯
   */
  completeCurrentAction(actionData = {}) {
    const currentAction = this.getCurrentAction();
    if (!currentAction) {
      Logger.warn("沒有目前動作可完成");
      return false;
    }

    // 記錄到歷史
    const normalizedActionId = this._getActionId(currentAction);
    this.actionHistory.push({
      actionId: normalizedActionId,
      timestamp: Date.now(),
      correct: true, // 直接完成視為正確
      skipped: true, // 標記為跳過
    });

    // 標記為完成
    this.completedActions.add(normalizedActionId);

    Logger.info("動作已完成（跳過）", {
      actionId: normalizedActionId,
      progress: `${this.currentActionIndex}/${this.currentActionSequence.length}`,
    });

    // [1] 發出已完成事件（在索引推進前）
    this.emit(ExperimentActionHandler.EVENT.ACTION_COMPLETED, {
      actionId: normalizedActionId,
      action: currentAction,
      progress: this.getProgress(),
      skipped: true,
    });

    this._broadcastButtonAction(currentAction, actionData);
    const nextAction = this.getNextAction();
    this._broadcastActionCompleted(normalizedActionId, {
      enteredActionId: this._getActionId(nextAction),
    });
    this._advanceAfterActionCompletion(normalizedActionId);

    return true;
  }

  _advanceAfterActionCompletion(_actionId) {
    this.currentActionIndex++;

    if (this.currentActionIndex >= this.currentActionSequence.length) {
      this.handleSequenceCompleted();
      return;
    }

    const nextAction = this.getCurrentAction();
    const nextActionId = this._getActionId(nextAction);

    this.emit(ExperimentActionHandler.EVENT.ACTION_ENTERED, {
      actionId: nextActionId,
      action: nextAction,
      progress: this.getProgress(),
    });
  }

  /**
   * 廣播按鈕動作完成
   * Schema: {type, clientId, timestamp, actionId, button, function, experimentId}
   * 僅在本機按鈕觸發動作時廣播（actionData.buttonId 存在）
   */
  _broadcastButtonAction(action, actionData) {
    if (!actionData.buttonId) {
      return;
    }

    const experimentId =
      this.dependencies.experimentSystemManager?.getExperimentId?.();
    if (!experimentId) {
      Logger.warn("ExperimentActionHandler: experimentId 不可用，跳過廣播");
      return;
    }

    const syncClient = this._getResolvedSyncClient();
    if (!syncClient?.clientId) {
      const log = this._shouldWarnMissingSyncClient() ? Logger.warn : Logger.debug;
      log("ExperimentActionHandler: syncClient 不可用，跳過廣播");
      return;
    }

    const payload = {
      type: SYNC_DATA_TYPES.BUTTON_ACTION,
      clientId: syncClient.clientId,
      timestamp: Date.now(),
      actionId: this._getActionId(action),
      button: actionData.buttonId,
      function: actionData.functionName || actionData.function,
      experimentId,
    };

    document.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: payload,
      }),
    );
  }

  _getCompletionBroadcastTarget(action, actionData) {
    if (!action) return null;

    const currentActionId = this._getActionId(action);
    const interactionKey =
      actionData.functionName || actionData.function || actionData.buttonId;
    const nextActionIdFromInteraction = interactionKey
      ? action?.interactions?.[interactionKey]?.next_action_id
      : null;
    const nextAction = this.getNextAction?.();
    const nextActionId =
      nextActionIdFromInteraction || this._getActionId(nextAction);

    // 始終以「剛完成的 action」作為廣播對象，讓 board 標記正確的 gesture button；
    // nextActionId 僅用於計算延遲，不作為廣播 target。
    const targetActionId = currentActionId;
    if (!targetActionId) return null;

    const isFirstAction = this.currentActionIndex === 0;
    const currentStepId = this.actionToStepMap?.get(currentActionId)?.step_id;
    const nextStepId = nextActionId
      ? this.actionToStepMap?.get(nextActionId)?.step_id
      : null;
    const isSameStep =
      currentStepId && nextStepId && currentStepId === nextStepId;
    const shouldDelay = !isFirstAction && currentStepId && nextStepId && !isSameStep;
    const delayMs = shouldDelay ? this._resolveCompletionCooldownMs() : 0;

    return {
      actionId: targetActionId,
      enteredActionId: nextActionId || null,
      delayMs,
    };
  }

  _resolveCompletionCooldownMs() {
    const raw = localStorage.getItem("stepCooldownMs");
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return ExperimentActionHandler.COMPLETION_COOLDOWN_MS;
  }

  _scheduleCompletionBroadcast(action, actionData) {
    if (!actionData?.buttonId) return;

    const target = this._getCompletionBroadcastTarget(action, actionData);
    if (!target) return;

    if (target.delayMs > 0) {
      setTimeout(() => {
        this._broadcastActionCompleted(target.actionId, {
          enteredActionId: target.enteredActionId,
        });
      }, target.delayMs);
      return;
    }

    this._broadcastActionCompleted(target.actionId, {
      enteredActionId: target.enteredActionId,
    });
  }

  /**
   * 廣播 action 完成至 board 端（實驗者）
   * 用途：受試者完成某個 action 後，通知 board 在對應手勢按鈕上顯示綠色標記。
   * board 端收到後僅更新視覺標記，不自動推進 gesture step。
   * Schema: {type, clientId, timestamp, actionId, experimentId}
   */
  _broadcastActionCompleted(actionId, options = {}) {
    if (!actionId) return;

    const { enteredActionId = null } = options;

    const experimentId =
      this.dependencies.experimentSystemManager?.getExperimentId?.() || "";
    const syncClient = this._getResolvedSyncClient();
    const clientId = syncClient?.clientId;
    if (!clientId) {
      const log = this._shouldWarnMissingSyncClient() ? Logger.warn : Logger.debug;
      log("ExperimentActionHandler: syncClient 不可用，跳過 action 完成廣播");
      return;
    }

    const payload = {
      type: SYNC_DATA_TYPES.ACTION_COMPLETED,
      clientId,
      timestamp: Date.now(),
      actionId,
    };

    if (enteredActionId) {
      payload.enteredActionId = enteredActionId;
    }

    if (experimentId) {
      payload.experimentId = experimentId;
    }

    document.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: payload,
      }),
    );
  }

  /**
   * 記錄動作歷史
   */
  getActionHistory() {
    return [...this.actionHistory];
  }

  // ==================== 手勢處理 ====================

  // ==================== 步驟轉換 ====================

  /**
   * 執行步驟轉換
   */
  executeStepTransition(toStep) {
    const flowManager = this.dependencies.flowManager;

    if (!flowManager) {
      Logger.warn("FlowManager 未 inject，無法執行步驟轉換");
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
   * 處理序列完成
   */
  handleSequenceCompleted() {
    Logger.info("動作序列已完成");

    this.emit(ExperimentActionHandler.EVENT.SEQUENCE_COMPLETED, {
      totalActions: this.currentActionSequence.length,
      completedActions: this.completedActions.size,
      history: this.getActionHistory(),
    });

    // 檢查是否還有下一個單元，避免"沒有目前單元"警告
    const flowManager = this.dependencies.flowManager;
    if (flowManager) {
      const currentUnitIndex = flowManager.currentUnitIndex;
      const totalUnits = flowManager.loadedUnits.length;

      // 只有當還有下一個單元時，才嘗試轉換
      if (currentUnitIndex < totalUnits - 1) {
        this.executeStepTransition();
      } else {
        Logger.debug("所有單元已完成，不執行步驟轉換");
        // 實驗會由 nextUnit() 中的 completeExperiment() 處理停止
      }
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
          actionId: this._getActionId(nextAction),
        });

        // 自動執行下一個動作
        this.handleCorrectAction(this._getActionId(nextAction), {
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

  // ==================== 工具方法 ====================

  /**
   * 取得處理器狀態
   */
  getState() {
    return {
      currentActionIndex: this.currentActionIndex,
      totalActions: this.currentActionSequence.length,
      completedActions: this.completedActions.size,
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
    this.clearAutoProgress();
    Logger.debug("ActionHandler 已重置");
  }

  /**
   * 銷毀處理器
   */
  destroy() {
    this.reset();
    this.clearListeners();
    Logger.debug("ActionHandler 已銷毀");
  }
}

// ES6 模組匯出
export default ExperimentActionHandler;
export { ExperimentActionHandler };
