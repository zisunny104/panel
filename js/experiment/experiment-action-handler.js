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
  EXPERIMENT_ACTION_HANDLER_EVENTS,
  EXPERIMENT_ACTION_HANDLER_DEFAULTS,
  ACTION_IDS,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { EventEmitter } from "../core/event-emitter.js";

class ExperimentActionHandler extends EventEmitter {
  /**
   * 事件類型常數
   */
  static EVENT = EXPERIMENT_ACTION_HANDLER_EVENTS;

  static COMPLETION_COOLDOWN_MS = EXPERIMENT_ACTION_HANDLER_DEFAULTS.COMPLETION_COOLDOWN_MS;

  constructor(config = {}) {
    super();
    // 設定
    this.config = {
      enableRemoteSync: config.enableRemoteSync !== false,
      ...config,
    };

    // 動作序列狀態
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionHistory = [];

    this.dependencies = {
      flowManager: null,
      syncClient: null,
      experimentSystemManager: null,
    };
    Logger.debug("ExperimentActionHandler 初始化完成");
  }

  // ==================== 注入依賴 ====================

  /**
   * 注入 FlowManager 依賴。
   * @param {object} flowManager
   * @returns {ExperimentActionHandler}
   */
  injectFlowManager(flowManager) {
    this.dependencies.flowManager = flowManager;
    Logger.debug("FlowManager 已注入到 ActionHandler");
    return this;
  }

  /**
   * 更新已注入的依賴。
   * @param {object} deps
   * @returns {ExperimentActionHandler}
   */
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
   * 初始化動作序列。
   * @param {Array<object>} actions
   * @returns {boolean}
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

    Logger.debug("action 序列", {
      actionIds: actions.map((action) => this._getActionId(action)),
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

  _isFirstActionInNewUnit(action) {
    const actionId = this._getActionId(action);
    if (!actionId) return false;

    const currentStepInfo = this.actionToStepMap?.get(actionId) || null;
    if (!currentStepInfo) {
      return false;
    }

    const previousAction = this.currentActionSequence[this.currentActionIndex - 1];
    if (!previousAction) {
      return true;
    }

    const previousStepInfo =
      this.actionToStepMap?.get(this._getActionId(previousAction)) || null;
    return (
      !previousStepInfo ||
      previousStepInfo.unit_id !== currentStepInfo.unit_id
    );
  }

  _isFirstActionInStep(action) {
    const actionId = this._getActionId(action);
    if (!actionId) return false;

    const currentStepInfo = this.actionToStepMap?.get(actionId) || null;
    if (!currentStepInfo) {
      return false;
    }

    const previousAction = this.currentActionSequence[this.currentActionIndex - 1];
    if (!previousAction) {
      return true;
    }

    const previousStepInfo =
      this.actionToStepMap?.get(this._getActionId(previousAction)) || null;
    return (
      !previousStepInfo ||
      previousStepInfo.step_id !== currentStepInfo.step_id
    );
  }

  /**
   * 取得目前動作，若序列已完成則回傳 null。
   * @returns {object|null}
   */
  getCurrentAction() {
    if (this.currentActionIndex >= this.currentActionSequence.length) {
      return null;
    }
    return this.currentActionSequence[this.currentActionIndex];
  }

  /**
   * 取得下一個動作，若已無下一個動作則回傳 null。
   * @returns {object|null}
   */
  getNextAction() {
    const nextIndex = this.currentActionIndex + 1;
    if (nextIndex >= this.currentActionSequence.length) {
      return null;
    }
    return this.currentActionSequence[nextIndex];
  }

  /**
   * 取得目前動作序列的進度。
   * @returns {{current:number,total:number,completed:number,percentage:number}}
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
   * 驗證提供的 actionId 是否對應目前動作。
   * @param {string} actionId
   * @param {object} [actionData]
   * @returns {{valid:boolean,error?:string,expected?:string,actual?:string,action?:object}}
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
   * 處理受試者正確完成的動作。
   *
   * 會驗證目前動作、標記完成、廣播狀態、推進索引，並觸發下一步的 ACTION_ENTERED。
   * @param {string} actionId
   * @param {object} [actionData]
   * @returns {boolean}
   */
  handleCorrectAction(actionId, actionData = {}) {
    const currentAction = this.getCurrentAction?.();
    Logger.debug("ExperimentActionHandler.handleCorrectAction", {
      actionId,
      source: actionData?.source || null,
      currentActionId: currentAction?.actionId || currentAction?.action_id || null,
      currentActionButtons: currentAction?.action_buttons || null,
      currentActionIndex: this.currentActionIndex,
    });

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

    return true;
  }

  /**
   * 處理動作驗證失敗的情況。
   * @param {string} actionId
   * @param {string} error
   * @returns {boolean}
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
   * 直接完成目前動作，不進行動作 ID 驗證。
   *
   * 若目前動作沒有 action_buttons，會視為自動跳過；否則視為正常完成。
   * 若要經過驗證的完成，請改用 handleCorrectAction().
   * @param {object} [actionData]
   * @returns {boolean}
   */
  completeCurrentAction(actionData = {}) {
    const currentAction = this.getCurrentAction();
    if (!currentAction) {
      Logger.warn("沒有目前動作可完成");
      return false;
    }

    const isFirstActionInNewUnit = this._isFirstActionInNewUnit(currentAction);
    Logger.debug("ExperimentActionHandler.completeCurrentAction", {
      currentActionId: currentAction?.actionId || currentAction?.action_id || null,
      currentActionIndex: this.currentActionIndex,
      isFirstActionInNewUnit,
    });

    // 第一個 action 在完成前先補發 ACTION_ENTERED，讓 panel 端正確進入動作狀態。
    // 這個補發應該發生在每個單元的第一個 step 的第一個 action，
    // 以避免 unit 開始時動作直接完成後無法進入新 step 的畫面狀態。
    if (isFirstActionInNewUnit) {
      this.emit(ExperimentActionHandler.EVENT.ACTION_ENTERED, {
        actionId: this._getActionId(currentAction),
        action: currentAction,
        progress: this.getProgress(),
      });
    }

    const normalizedActionId = this._getActionId(currentAction);
    const skipped = !currentAction.action_buttons;

    // 記錄到歷史
    this.actionHistory.push({
      actionId: normalizedActionId,
      timestamp: Date.now(),
      correct: true, // 直接完成視為正確
      skipped,
    });

    // 標記為完成
    this.completedActions.add(normalizedActionId);

    Logger.info(`動作已完成${skipped ? "（跳過）" : ""}`, {
      actionId: normalizedActionId,
      progress: `${this.currentActionIndex}/${this.currentActionSequence.length}`,
    });

    // [1] 發出已完成事件（在索引推進前）
    this.emit(ExperimentActionHandler.EVENT.ACTION_COMPLETED, {
      actionId: normalizedActionId,
      action: currentAction,
      progress: this.getProgress(),
      skipped,
    });

    this._broadcastButtonAction(currentAction, actionData);
    this._scheduleCompletionBroadcast(currentAction, actionData);
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

    const currentStepInfo = this.actionToStepMap?.get(currentActionId) || null;
    const nextStepInfo = nextActionId
      ? this.actionToStepMap?.get(nextActionId) || null
      : null;
    const currentUnitId = currentStepInfo?.unit_id || null;
    const nextUnitId = nextStepInfo?.unit_id || null;
    const shouldDelay =
      currentUnitId && nextUnitId && currentUnitId !== nextUnitId;
    const delayMs = shouldDelay ? this._resolveCompletionCooldownMs() : 0;
    const isPowerActionTransition =
      nextActionId === ACTION_IDS.POWER_ON ||
      nextActionId === ACTION_IDS.POWER_OFF;

    const shouldSuppressEnteredActionId =
      this._isFirstActionInStep(action) &&
      currentStepInfo &&
      nextStepInfo &&
      currentStepInfo.step_id !== nextStepInfo.step_id &&
      currentActionId?.endsWith("_1");

    return {
      actionId: targetActionId,
      enteredActionId:
        isPowerActionTransition || shouldSuppressEnteredActionId
          ? null
          : nextActionId || null,
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
   * 取得動作歷史紀錄。
   * @returns {Array<object>}
   */
  getActionHistory() {
    return [...this.actionHistory];
  }

  // ==================== 手勢處理 ====================

  // ==================== 步驟轉換 ====================

  /**
   * 透過已注入的 FlowManager 執行步驟轉換。
   * @param {string} [toStep]
   * @returns {boolean}
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
   * 處理整個 action 序列完成的流程。
   * @returns {void}
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


  // ==================== 錯誤處理 ====================

  /**
   * 處理無效動作，並發出錯誤事件。
   * @param {string} actionId
   * @param {string} reason
   * @returns {boolean}
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
   * 處理同步失敗，並發出錯誤事件。
   * @param {Error|object|string} error
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
   * 取得 ActionHandler 的當前狀態。
   * @returns {{currentActionIndex:number,totalActions:number,completedActions:number,config:object}}
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
   * 重置處理器為初始狀態。
   */
  reset() {
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.actionHistory = [];
    Logger.debug("ActionHandler 已重置");
  }

  /**
   * 銷毀處理器並移除所有事件監聽器。
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
