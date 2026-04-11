/**
 * ButtonManager - 按鈕管理器
 *
 * 負責處理所有按鈕互動、實驗邏輯和同步功能
 * 專門用於主面板的按鈕操作管理
 */
import {
  ACTION_IDS,
  ACTION_BUTTONS,
  SYNC_DATA_TYPES,
  SYNC_EVENTS,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";

class ButtonManager {
  constructor({
    logger = Logger,
    experimentActionHandler = null,
    experimentFlowManager = null,
    experimentSyncCore = null,
    syncClient = null,
    powerControl = null,
    panelMediaManager = null,
  } = {}) {
    this.logger = logger;
    this.experimentActionHandler = experimentActionHandler;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSyncCore = experimentSyncCore;
    this.syncClient = syncClient;
    this.powerControl = powerControl;
    this.panelMediaManager = panelMediaManager;
    // 按鈕功能對照表
    this.buttonFunctionsMap = {};

    // 鍵盤按鈕映射
    this.keyboardButtonMap = {
      // Shift 鍵
      Shift: "B1",

      // 數字鍵
      1: "B11", // 1
      2: "B12", // 2
      3: "B13", // 3
      4: "B8", // 4
      5: "B9", // 5
      6: "B10", // 6
      7: "B5", // 7
      8: "B6", // 8
      9: "B7", // 9
      0: "B15", // 0

      // ZXC 鍵
      z: "B2", // f1
      x: "B3", // f2
      c: "B4", // f3

      // 其他功能鍵
      Escape: "B14", // esc
      Enter: "B16", // enter
    };

    // Shift 狀態管理
    this.isShiftPressed = false;
    this.isTouchShiftActive = false;
    this.touchShiftTimeout = null;

    // 觸控追蹤
    this.activeTouches = new Set();

    // 動作冷卻機制
    this.lastActionTime = 0;
    this.actionCooldown = 200; // 200ms 冷卻時間

    // 實驗動作管理
    this.experimentActions = new Map(); // 儲存實驗動作數據
    this.actionListeners = new Map(); // 事件監聽器儲存

    // 初始化 - 只載入按鈕功能，事件監聽器在數據載入後設置
    this.loadButtonFunctions();
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  _getLogger() {
    return this.logger;
  }

  _getActionHandler() {
    return this.experimentActionHandler;
  }

  _getFlowManager() {
    return this.experimentFlowManager;
  }

  _getSyncCore() {
    return this.experimentSyncCore;
  }

  _getSyncClient() {
    return this.syncClient;
  }

  _getPowerControl() {
    return this.powerControl;
  }

  _getMediaManager() {
    return this.panelMediaManager;
  }

  // ==========================================
  // 初始化和配置
  // ==========================================

  /**
   * 載入按鈕功能配置
   */
  async loadButtonFunctions() {
    try {
      const response = await fetch("data/buttons.json");
      const data = await response.json();

      // 將 buttons 陣列轉換為 Map 格式
      if (data.buttons && Array.isArray(data.buttons)) {
        this.buttonFunctionsMap = {};
        data.buttons.forEach((button) => {
          this.buttonFunctionsMap[button.button_id] = button;
        });
      } else {
        this.buttonFunctionsMap = data;
      }

      // 數據載入完成後設置事件監聽器
      this.setupEventListeners();

      Logger.debug("按鈕功能配置載入完成，事件監聽器已設置");
    } catch (error) {
      Logger.error("載入按鈕功能配置失敗:", error);
    }
  }

  /**
   * 清空按鈕功能對照表
   */
  clearButtonFunctions() {
    this.buttonFunctionsMap = {};
  }

  /**
   * 清除所有按鈕的高亮效果
   * 移除所有高亮相關的樣式類別
   */
  clearAllButtonHighlights() {
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
      btn.classList.remove("next-step-highlight-secondary");
      btn.classList.remove("next-step-highlight-shift");
    });
    if (typeof Logger !== "undefined") {
      Logger.debug("已清除所有按鈕高亮效果");
    }
  }

  resetActionButtonState() {
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("temporarily-disabled");
      btn.classList.remove("power-off-disabled");
      btn.style.pointerEvents = "";
    });
  }

  // ==========================================
  // 按鈕模擬和處理
  // ==========================================

  /**
   * 模擬按鈕點擊（鍵盤/觸控用）
   */
  simulateButtonClick(buttonId, isKeyboardTriggered = false) {
    const logger = this._getLogger();
    const flowManager = this._getFlowManager();
    const actionHandler = this._getActionHandler();
    const button = document.querySelector(
      `.button-overlay[data-label="${buttonId}"]`,
    );
    const shiftButtonOverlay = document.querySelector(
      ".button-overlay[data-label=\"B1\"]",
    );
    if (!button) {
      if (typeof Logger !== "undefined") {
        Logger.warn(`找不到按鈕元素: ${buttonId}`);
      }
      return;
    }

    const buttonData = this.buttonFunctionsMap[buttonId];
    let functionName = "未知功能";
    let actionMessage = `按鈕 "${buttonId}" 被按下`;

    if (typeof Logger !== "undefined") {
      Logger.debug(`模擬按鈕點擊: ${buttonId}, 數據載入: ${!!buttonData}`);
    }

    if (buttonData?.button_functions) {
      if (buttonId === "B1") {
        // Shift 按鈕特殊處理
        this.isShiftPressed = !this.isShiftPressed;
        button.classList.toggle("shift-active", this.isShiftPressed);

        // 同步更新按鈕覆蓋層的狀態
        const shiftOverlay = document.querySelector("[data-button=\"B1\"]");
        if (shiftOverlay) {
          shiftOverlay.classList.toggle("shift-active", this.isShiftPressed);
        }

        actionMessage = this.isShiftPressed
          ? "模擬按鈕 \"B1\" (Shift) 按下"
          : "模擬按鈕 \"B1\" (Shift) 放開";
        functionName = "shift";

        Logger.debug(`Shift 狀態: ${this.isShiftPressed ? "按下" : "放開"}`);
      } else {
        // 其他按鈕處理
        const isShiftActive = this.isShiftPressed || this.isTouchShiftActive;
        functionName =
          isShiftActive && buttonData.button_functions[1]
            ? buttonData.button_functions[1]
            : buttonData.button_functions[0];

        // 記錄組合按鈕操作
        if (isShiftActive && buttonData.button_functions[1]) {
          const comboDetails = {
            baseButton: buttonId,
            modifierButton: "B1",
            modifierType: "shift",
            baseFunction: buttonData.button_functions[0],
            comboFunction: buttonData.button_functions[1],
            modifierSource: this.isShiftPressed ? "keyboard" : "touch",
          };
          logger?.logAction(
            `${actionMessage}，功能為 "${functionName}" [組合: Shift + ${buttonId}]`,
            buttonId,
            functionName,
            isKeyboardTriggered,
            false,
            true,
            comboDetails,
          );
        } else {
          logger?.logAction(
            `${actionMessage}，功能為 "${functionName}"`,
            buttonId,
            functionName,
            isKeyboardTriggered,
          );
        }

        if (this.isShiftPressed) {
          this.isShiftPressed = false;
          shiftButtonOverlay?.classList.remove("shift-active");
        }
      }
    }

    // 記錄非組合按鈕操作（Shift 按鈕或非組合操作）
    if (
      buttonId === "B1" ||
      (!this.isShiftPressed && !this.isTouchShiftActive)
    ) {
      logger?.logAction(
        `${actionMessage}，功能為 "${functionName}"`,
        buttonId,
        functionName,
        isKeyboardTriggered,
      );
    }

    // 實驗模式下檢查是否有對應的動作
    if (flowManager?.isRunning) {
      if (this.checkAndExecuteExperimentAction(buttonId, functionName)) {
        if (actionHandler && actionHandler.currentActionSequence?.length > 0) {
          const currentActionIndex = actionHandler.currentActionIndex;
          const totalActions = actionHandler.currentActionSequence.length;
          const prevAction = actionHandler.currentActionSequence[
            Math.max(0, currentActionIndex - 1)
          ];
          const logMessage = `按鈕 "${buttonId}" → 功能 "${functionName}" | 動作: ${
            prevAction?.actionId || "未知"
          } [${currentActionIndex}/${totalActions}]`;
          logger?.logAction(logMessage);
        }
      }
    }

    this.playBeep();

    // 廣播按鈕按下事件到其他同步裝置
    this.broadcastButtonPress(buttonId, functionName);
  }

  /**
   * 廣播按鈕按下事件
   * Schema: {type, clientId, timestamp, button, function, beepEnabled}
   */
  broadcastButtonPress(buttonId, functionName) {
    // 取得提示音狀態
    const toggleBeepSound = document.getElementById("toggleBeepSound");
    const beepEnabled = toggleBeepSound?.checked || false;

    // 檢查同步連線狀態
    const syncCore = this._getSyncCore();
    const syncClient = this._getSyncClient();
    syncCore?.safeBroadcast?.({
      type: SYNC_DATA_TYPES.BUTTON_PRESSED,
      clientId: syncClient?.clientId || "button_manager",
      timestamp: Date.now(),
      button: buttonId,
      function: functionName,
      beepEnabled: beepEnabled,
    }).catch((error) => {
      Logger.warn("同步按鈕按下事件失敗:", error);
    });
  }

  // ==========================================
  // 實驗邏輯處理
  // ==========================================

  /**
   * 檢查並執行實驗模式下的對應動作
   */
  checkAndExecuteExperimentAction(buttonId, functionName, isRemote = false) {
    const flowManager = this._getFlowManager();
    const actionHandler = this._getActionHandler();
    // 檢查是否為新的實驗動作按鈕（事件驅動）
    if (this.isExperimentActionButton(buttonId)) {
      Logger.debug(`檢測到新實驗動作按鈕: ${buttonId}`);
      this.emitButtonActionClick(buttonId);
      return true;
    }

    // 檢查實驗是否在執行中
    if (!flowManager?.isRunning) {
      Logger.debug(`實驗未執行，跳過按鈕動作: ${buttonId}`);
      return false;
    }

    // 確保動作管理員已初始化（當實驗開始時自動初始化）
    if (!actionHandler) {
      Logger.warn("experimentActionHandler 不存在，無法處理動作");
      return false;
    }

    // 如果動作序列為空，記錄警告但繼續處理
    if (actionHandler.currentActionSequence.length === 0) {
      Logger.warn("動作序列為空，無法處理動作");
      return false;
    }

    // 處理動作序列邏輯
    Logger.debug(
      `處理按鈕動作: ${buttonId} -> ${functionName}, 序列長度: ${actionHandler.currentActionSequence.length}`,
    );
    return this.handleActionBasedExperiment(buttonId, functionName, isRemote);

    return false;
  }

  /**
   * 處理動作序列實驗邏輯
   */
  handleActionBasedExperiment(buttonId, functionName, isRemote = false) {
    const actionHandler = this._getActionHandler();
    // 防重複觸發檢查
    const now = Date.now();
    if (now - this.lastActionTime < this.actionCooldown) {
      Logger.debug(
        `忽略重複按鈕動作: ${buttonId} (${now - this.lastActionTime}ms)`,
      );
      return false;
    }
    this.lastActionTime = now;

    if (!actionHandler) {
      return false;
    }

    let currentAction = actionHandler.getCurrentAction();
    if (!currentAction) {
      return false;
    }

    // 自動跳過沒有 action_buttons 的動作（同時檢查是否需要觸發冷卻）
    while (currentAction && !currentAction.action_buttons) {
      // 儲存目前 action，檢查是否為 step 最後一個
      const skippedAction = currentAction;

      actionHandler.completeCurrentAction();
      currentAction = actionHandler.getCurrentAction();

      // 如果被跳過的 action 是 step 的最後一個，觸發冷卻效果
      if (skippedAction.isLastActionInStep) {
        this.triggerStepCompleteEffect();
        return true;
      }

      if (!currentAction) {
        this.updateMediaForCurrentAction();
        return false;
      }
    }

    // 檢查按鈕是否符合目前 action 的要求
    const isValidButton = this.isButtonValidForAction(
      buttonId,
      functionName,
      currentAction,
    );

    if (isValidButton) {
      const actionData = isRemote
        ? {}
        : {
            buttonId,
            functionName,
          };
      Logger.debug(
        `按鈕驗證通過: ${buttonId}/${functionName}, 動作: ${currentAction.actionId}`,
      );

      // 檢查 action 是否有下一步的互動定義
      if (
        currentAction.interactions &&
        currentAction.interactions[functionName]
      ) {
        const interaction = currentAction.interactions[functionName];
        const nextActionId = interaction.next_action_id;
        Logger.debug(
          `找到互動定義: ${functionName} -> ${nextActionId || "無下一個動作"}`,
        );

        if (nextActionId) {
          // 儲存目前 action 用於檢查
          const completedAction = currentAction;

          // 完成目前 action
          actionHandler.completeCurrentAction(actionData);

          // 查找下一個 action
          const nextActionIndex =
            actionHandler.currentActionSequence.findIndex(
              (action) => action.actionId === nextActionId,
            );

          // 取得下一個 action 物件
          const nextAction =
            nextActionIndex !== -1
              ? actionHandler.currentActionSequence[
                  nextActionIndex
                ]
              : null;

          if (nextActionIndex !== -1) {
            actionHandler.currentActionIndex = nextActionIndex;
          }

          // 使用統一的冷卻邏輯計算方法
          const cooldownState = this._calculateCooldownState(completedAction, nextAction);

          if (cooldownState.shouldCooldown) {
            Logger.debug(
              `觸發冷卻效果: ${cooldownState.reason} | ` +
                `完成Action: ${completedAction.actionId} (${completedAction.action_name}) | ` +
                `Step: ${cooldownState.stepInfo?.step_id || "unknown"} | ` +
                `Step Actions: ${cooldownState.stepActions.length} | ` +
                `下一個Action: ${nextAction?.actionId || "無"}`,
            );
            this.triggerStepCompleteEffect();
          } else {
            Logger.debug(
              `跳過冷卻效果: ${cooldownState.reason} | ` +
                `完成Action: ${completedAction.actionId} (${completedAction.action_name}) | ` +
                `Step: ${cooldownState.stepInfo?.step_id || "unknown"} | ` +
                `Step Actions: ${cooldownState.stepActions.length} | ` +
                `下一個Action: ${nextAction?.actionId || "無"}`,
            );
            // 更新媒體顯示
            this.updateMediaForCurrentAction();
          }

          return true;
        }
      } else {
        // 沒有定義互動，直接完成並移到下一個
        const completedAction = currentAction;
        actionHandler.completeCurrentAction(actionData);

        const nextAction = actionHandler.getCurrentAction();

        // 使用統一的冷卻邏輯計算方法
        const cooldownState = this._calculateCooldownState(completedAction, nextAction);

        if (cooldownState.shouldCooldown) {
          Logger.debug(
            `觸發冷卻效果: ${cooldownState.reason} | ` +
              `完成Action: ${completedAction.actionId} (${completedAction.action_name}) | ` +
              `Step: ${cooldownState.stepInfo?.step_id || "unknown"} | ` +
              `Step Actions: ${cooldownState.stepActions.length} | ` +
              `下一個Action: ${nextAction?.actionId || "無"}`,
          );
          this.triggerStepCompleteEffect();
        } else {
          Logger.debug(
            `跳過冷卻效果: ${cooldownState.reason} | ` +
              `完成Action: ${completedAction.actionId} (${completedAction.action_name}) | ` +
              `Step: ${cooldownState.stepInfo?.step_id || "unknown"} | ` +
              `Step Actions: ${cooldownState.stepActions.length} | ` +
              `下一個Action: ${nextAction?.actionId || "無"}`,
          );
          // 更新媒體顯示
          this.updateMediaForCurrentAction();
        }
        return true;
      }
    }

    return false;
  }

  /**
   * 觸發 step 完成的視覺效果
   */
  triggerStepCompleteEffect() {
    const actionHandler = this._getActionHandler();
    const flowManager = this._getFlowManager();
    // 檢查視覺提示是否開啟
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const visualsEnabled = toggleTouchVisuals
      ? toggleTouchVisuals.checked
      : true;

    // 檢查是否還有下一個動作（實驗是否已完成）
    const nextAction = actionHandler?.getCurrentAction();
    if (!nextAction) {
      // 實驗已完成，檢查是否為最後單元完成
      if (
        flowManager &&
        flowManager.currentUnitIndex === flowManager.loadedUnits.length - 1
      ) {
        Logger.debug("最後單元完成，即將顯示電源開關高亮");
        // 最後單元完成時的電源高亮由 nextUnit() 處理
      }
      return;
    }

    if (!visualsEnabled) {
      // 視覺提示關閉，不執行冷卻效果
      return;
    }

    const mediaArea = document.getElementById("mediaArea");

    // 新增冷卻指示效果（亮橘色外框）
    if (mediaArea && mediaArea.classList.contains("step-complete-indicator")) {
      mediaArea.classList.add("cooldown-indicator");
    }

    // 停用所有按鈕
    const allButtons = document.querySelectorAll(".button-overlay");
    allButtons.forEach((btn) => {
      btn.classList.add("temporarily-disabled");
      btn.style.pointerEvents = "none";
    });

    // 【冷卻期間】先清除所有高亮，只更新媒體而不高亮按鈕
    this.clearAllButtonHighlights();
    this.updateMediaForCurrentActionWithoutHighlight();

    // 3 秒後移除冷卻效果並進入下一步
    setTimeout(() => {
      if (mediaArea) {
        mediaArea.classList.remove("cooldown-indicator");
      }

      allButtons.forEach((btn) => {
        btn.classList.remove("temporarily-disabled");
        btn.style.pointerEvents = "";
      });

      const actionHandler = this._getActionHandler();
      const currentAction = actionHandler?.getCurrentAction?.();

      if (currentAction) {
        // 【冷卻結束】現在才高亮下一個按鈕
        this.updateMediaForCurrentAction();
      } else {
        Logger.debug("冷卻結束：動作序列已結束，進入單元完成處理");
      }

      // 冷卻結束後，進入下一步（僅在 FlowManager 有有效單元時）
      if (flowManager?.getCurrentUnit?.()) {
        flowManager.nextStep();
      }
    }, 3000);
  }

  /**
   * 計算是否應該觸發冷卻效果
   * 提取冷卻邏輯，避免重複代碼
   *
   * @param {Object} completedAction - 已完成的 action 物件
   * @param {Object|null} nextAction - 下一個 action 物件（可能為 null）
   * @returns {Object} {shouldCooldown, reason, stepInfo, stepActions}
   */
  _calculateCooldownState(completedAction, nextAction) {
    const actionHandler = this._getActionHandler();
    const flowManager = this._getFlowManager();
    // 取得已完成 action 的 step 資訊
    const stepInfo = actionHandler?.actionToStepMap?.get(
      completedAction.actionId,
    );

    // 找出同一個 step 中的所有 action
    const stepActions = stepInfo
      ? actionHandler.currentActionSequence.filter(
          (a) =>
        actionHandler.actionToStepMap?.get(a.actionId)
              ?.step_id === stepInfo.step_id,
        )
      : [];

    // 取得目前 unit 的所有 step
    const currentUnitId =
      flowManager?.loadedUnits?.[flowManager?.currentUnitIndex];
    const allStepsInUnit = new Set();

    if (currentUnitId && actionHandler?.actionToStepMap) {
      for (const [_actionId, stepData] of actionHandler.actionToStepMap) {
        if (stepData.unit_id === currentUnitId) {
          allStepsInUnit.add(stepData.step_id);
        }
      }
    }

    // 計算 step 在 unit 中的位置
    const allStepsArray = Array.from(allStepsInUnit);
    const isFirstStep = allStepsArray.indexOf(stepInfo?.step_id) === 0;
    const isLastStep =
      allStepsArray.indexOf(stepInfo?.step_id) === allStepsArray.length - 1;

    // 根據 step 中 action 的數量決定冷卻策略
    let shouldCooldown = false;
    let reason = "";

    if (stepActions.length === 1) {
      // 單個 action 的 step：只有在首尾 step 時才冷卻
      shouldCooldown = isFirstStep || isLastStep;
      reason = shouldCooldown
        ? `單個 action 的 ${isFirstStep ? "首" : "尾"} step 完成`
        : "單個 action 的中間 step，跳過冷卻";
    } else if (stepActions.length > 1) {
      // 多個 action 的 step：進入最後一個 action 時冷卻
      shouldCooldown = nextAction && nextAction.isLastActionInStep;
      reason = "進入 step 的最後一個 action";
    }

    return { shouldCooldown, reason, stepInfo, stepActions };
  }

  /**
   * 檢查按鈕是否符合目前 action 的要求
   */
  isButtonValidForAction(buttonId, functionName, action) {
    if (!action || !action.action_buttons) {
      Logger.debug("動作無效或無 action_buttons");
      return false;
    }

    // action_buttons 可能是字串或陣列
    const actionButtons = Array.isArray(action.action_buttons)
      ? action.action_buttons
      : String(action.action_buttons)
          .split(",")
          .map((s) => s.trim());

    const isValid =
      actionButtons.includes(functionName) || actionButtons.includes(buttonId);

    Logger.debug(
      `檢查按鈕有效性: ${buttonId}/${functionName}, 期望: [${actionButtons.join(", ")}], 結果: ${isValid}`,
    );
    return isValid;
  }

  /**
   * 取得按鈕功能列表
   */
  getButtonFunctions(buttonId) {
    const buttonConfig = this.buttonFunctionsMap[buttonId];
    return buttonConfig?.button_functions || [];
  }

  /**
   * 準備 UI 狀態（電源檢查、按鈕停用）
   * @param {boolean} shouldClearHighlight - 是否清除高亮
   * @returns {Object} {isPowerOn, isPowerVideoPlaying}
   */
  _prepareUIForMedia(shouldClearHighlight = true) {
    const flowManager = this._getFlowManager();
    const powerControl = this._getPowerControl();
    // 啟用視覺提示
    const showTouchVisuals =
      localStorage.getItem("showTouchVisuals") !== "false";
    if (
      showTouchVisuals &&
      flowManager?.isRunning &&
      !document.body.classList.contains("visual-hints-enabled")
    ) {
      document.body.classList.add("visual-hints-enabled");
    }

    // 檢查電源狀態
    const isPowerOn = this.isPowerOn();
    const isPowerVideoPlaying = powerControl?.isPowerVideoPlaying || false;

    // 清除或保留高亮
    if (shouldClearHighlight) {
      this.clearAllButtonHighlights();
    }

    // 管理按鈕停用狀態
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      if (!isPowerOn) {
        btn.classList.add("power-off-disabled");
      } else {
        btn.classList.remove("power-off-disabled");
      }
    });

    return { isPowerOn, isPowerVideoPlaying };
  }

  /**
   * 載入並顯示目前 action 的媒體
   * 自動跳過沒有 action_buttons 的動作
   * @returns {Object|null} 跳過後的目前 action
   */
  _loadAndDisplayMedia() {
    const isPowerOn = this.isPowerOn();
    const actionHandler = this._getActionHandler();
    const mediaManager = this._getMediaManager();

    if (!actionHandler) {
      return null;
    }

    // 自動跳過沒有 action_buttons 的動作
    let currentAction = actionHandler.getCurrentAction();
    while (currentAction && !currentAction.action_buttons) {
      if (currentAction.media_file && mediaManager) {
        mediaManager.displayMedia(currentAction.media_file);
      } else if (mediaManager) {
        mediaManager.playHomePageLoop(true);
      }
      actionHandler.completeCurrentAction();
      currentAction = actionHandler.getCurrentAction();
    }

    if (currentAction) {
      // 檢查電源狀態
      if (isPowerOn) {
        if (currentAction.media_file && mediaManager) {
          mediaManager.displayMedia(currentAction.media_file);
        } else if (mediaManager) {
          mediaManager.playHomePageLoop(true);
        }
      } else {
        Logger.debug(`電源未開啟，不載入媒體: ${currentAction.actionId}`);
        if (mediaManager) {
          mediaManager.mediaArea.innerHTML = "";
        }
      }
    }

    return currentAction;
  }

  /**
   * 高亮目前 action 的對應按鈕
   */
  _highlightButtonsForAction(currentAction, isPowerOn, isPowerVideoPlaying) {
    if (!currentAction) return;

    const flowManager = this._getFlowManager();

    if (this._isPowerAction(currentAction)) {
      this._highlightPowerAction(currentAction);
      return;
    }

    const isExperimentRunning = flowManager?.isRunning || false;
    if (
      !isPowerOn ||
      isPowerVideoPlaying ||
      !isExperimentRunning ||
      !currentAction.action_buttons
    ) {
      Logger.debug("不符合高亮條件，跳過按鈕高亮");
      return;
    }

    const actionButtons = Array.isArray(currentAction.action_buttons)
      ? currentAction.action_buttons
      : currentAction.action_buttons.split(",").map((s) => s.trim());

    const matchedButtons = [];
    const requiresShiftFunctions = [];
    const interactionsOrder = currentAction.interactions
      ? Object.keys(currentAction.interactions)
      : [];

    // 掃描符合的按鈕
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      const buttonId = btn.dataset.label;
      const buttonFunctions = this.getButtonFunctions(buttonId);

      const hasMatchingFunction = buttonFunctions.some((func) =>
        actionButtons.includes(func),
      );

      if (hasMatchingFunction) {
        const matchedFunction = buttonFunctions.find((func) =>
          actionButtons.includes(func),
        );
        const functionIndex = buttonFunctions.indexOf(matchedFunction);

        if (functionIndex === 1) {
          requiresShiftFunctions.push(matchedFunction);
        }

        matchedButtons.push({
          btn,
          buttonId,
          buttonFunctions,
          matchedFunction,
        });
      }
    });

    Logger.debug(
      `找到 ${matchedButtons.length} 個符合按鈕，需要 Shift: ${requiresShiftFunctions.length}`,
    );

    // 按 interactions 順序排序
    matchedButtons.sort((a, b) => {
      const aIndex = interactionsOrder.indexOf(a.matchedFunction);
      const bIndex = interactionsOrder.indexOf(b.matchedFunction);
      return aIndex - bIndex;
    });

    // 應用高亮
    matchedButtons.forEach((item, index) => {
      if (item.btn.classList.contains("experiment-disabled")) {
        Logger.debug(`按鈕 ${item.buttonId} 已被鎖定，不顯示高亮`);
        return;
      }

      if (index === 0) {
        item.btn.classList.add("next-step-highlight");
        item.btn.classList.remove("next-step-highlight-secondary");
        Logger.debug(`主按鈕高亮: ${item.buttonId} (${item.matchedFunction})`);
      } else {
        item.btn.classList.remove("next-step-highlight");
        item.btn.classList.add("next-step-highlight-secondary");
        Logger.debug(`次按鈕高亮: ${item.buttonId} (${item.matchedFunction})`);
      }
    });

    // 處理 Shift 按鈕
    const shiftButton = document.querySelector(
      ".button-overlay[data-label=\"B1\"]",
    );

    if (requiresShiftFunctions.length > 0 && shiftButton) {
      if (!shiftButton.classList.contains("experiment-disabled")) {
        shiftButton.classList.add("next-step-highlight");
        Logger.debug(
          `Shift 按鈕高亮: 需要的功能 [${requiresShiftFunctions.join(", ")}]`,
        );
      } else {
        Logger.debug("Shift 按鈕已被鎖定，不顯示高亮");
      }
    } else if (shiftButton) {
      const hadHighlight =
        shiftButton.classList.contains("next-step-highlight") ||
        shiftButton.classList.contains("next-step-highlight-shift");
      shiftButton.classList.remove("next-step-highlight");
      shiftButton.classList.remove("next-step-highlight-shift");
      if (hadHighlight) {
        Logger.debug("Shift 按鈕高亮已移除");
      }
    }
  }

  _isPowerAction(action) {
    const actionId = action?.actionId || action?.action_id;
    if (actionId === ACTION_IDS.POWER_ON || actionId === ACTION_IDS.POWER_OFF) {
      return true;
    }
    const actionButtons = Array.isArray(action?.action_buttons)
      ? action.action_buttons
      : String(action?.action_buttons || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    return (
      actionButtons.includes(ACTION_BUTTONS.POWER_ON) ||
      actionButtons.includes(ACTION_BUTTONS.POWER_OFF)
    );
  }

  _highlightPowerAction(action) {
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.add("next-step-highlight");
    }
    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.add("next-step-highlight");
    });
    Logger.debug("電源動作高亮", {
      actionId: action?.actionId || action?.action_id,
    });
  }

  /**
   * 更新目前 action 的媒體顯示
   */
  updateMediaForCurrentAction() {
    // 準備 UI 並清除高亮
    const { isPowerOn, isPowerVideoPlaying } = this._prepareUIForMedia(true);

    // 載入並顯示媒體
    const currentAction = this._loadAndDisplayMedia();

    if (!currentAction) {
      Logger.debug("沒有目前動作，不進行按鈕高亮");
      return;
    }

    Logger.debug(
      `目前動作: ${currentAction.actionId}, 按鈕: ${currentAction.action_buttons}`,
    );

    // 高亮按鈕
    this._highlightButtonsForAction(
      currentAction,
      isPowerOn,
      isPowerVideoPlaying,
    );
  }

  /**
   * 更新目前 action 的媒體顯示（不高亮按鈕）
   * 用於冷卻階段：只更新媒體，等待冷卻結束後才高亮按鈕
   */
  updateMediaForCurrentActionWithoutHighlight() {
    // 準備 UI 但不清除高亮（保持冷卻期間的高亮清除效果）
    this._prepareUIForMedia(false);

    // 載入並顯示媒體
    const currentAction = this._loadAndDisplayMedia();

    if (currentAction) {
      Logger.debug(
        `冷卻階段媒體更新: ${currentAction.actionId}, 按鈕: ${currentAction.action_buttons}`,
      );
    }

    // 【注意】冷卻階段不進行按鈕高亮，等待冷卻結束後由 updateMediaForCurrentAction() 進行
    Logger.debug("冷卻階段：跳過按鈕高亮，等待冷卻結束");
  }

  /**
   * 更新實驗模式下的按鈕樣式
   */
  updateExperimentButtonStyles() {
    // 按鈕高亮由 updateMediaForCurrentAction 處理
    // 這裡只清除舊的 experiment-functional 樣式
    document.querySelectorAll(".button-overlay").forEach((button) => {
      button.classList.remove("experiment-functional");
    });
  }

  /**
   * 檢查機器是否已開機
   */
  isPowerOn() {
    const powerControl = this._getPowerControl();
    if (powerControl) return powerControl.isPowerOn;
    const powerLightOn = document.querySelector(".power-light-on-img");
    if (powerLightOn) {
      return !powerLightOn.classList.contains("is-hidden");
    }
    return true;
  }

  // ==========================================
  // 事件監聽器設置
  // ==========================================

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    this.setupMouseEvents();
    this.setupTouchEvents();
    this.setupKeyboardEvents();
    this.setupSyncEventListeners();
  }

  /**
   * 設定同步事件監聽器
   */
  setupSyncEventListeners() {
    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (e) => {
      const state = e.detail;
      if (!state) return;
      const myId = this._getSyncClient()?.clientId;
      if (myId && state.clientId === myId) return;
      if (state.type === SYNC_DATA_TYPES.BUTTON_PRESSED) {
        this.handleRemoteButtonPress(state);
      }
    });

    // 監聽裝置模式變更
    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });

    // 監聽實驗動作載入事件
    window.addEventListener("experiment:actions-loaded", (e) => {
      this.handleExperimentActionsLoaded(e.detail);
    });
  }

  /**
   * 設定滑鼠事件
   */
  setupMouseEvents() {
    document.querySelectorAll(".button-overlay").forEach((button) => {
      // 建立新的事件處理器
      const newHandler = (event) => {
        if (event.pointerType === "touch" || event.detail === 0) return;
        Logger.debug(`滑鼠點擊按鈕: ${button.dataset.label}`);
        this.simulateButtonClick(button.dataset.label, false);
      };

      button.addEventListener("click", newHandler);
    });
  }

  /**
   * 設定觸控事件
   */
  setupTouchEvents() {
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    document.querySelectorAll(".button-overlay").forEach((button) => {
      button.addEventListener(
        "touchstart",
        (event) => {
          event.preventDefault();
          const logger = this._getLogger();
          const flowManager = this._getFlowManager();
          const buttonId = button.dataset.label;
          const touchId = event.changedTouches[0].identifier;

          // 新增觸控 ID 到活動中觸控集合
          this.activeTouches.add(`${buttonId}_${touchId}`);

          if (toggleTouchVisuals?.checked) button.classList.add("touch-active");

          // 觸控模式下 shift 按鈕的特殊處理
          if (buttonId === "B1") {
            this.isTouchShiftActive = true;
            button.classList.add("shift-active");

            // 清除之前的逾時
            if (this.touchShiftTimeout) {
              clearTimeout(this.touchShiftTimeout);
              this.touchShiftTimeout = null;
            }

            if (flowManager?.isRunning) {
              this.executeTouchShift();
              return;
            }
          }


          // 其他按鈕：檢查是否為組合操作
          const buttonData = this.buttonFunctionsMap[buttonId];
          if (this.isTouchShiftActive && buttonData?.button_functions?.[1]) {
            // 組合按鈕操作
            const comboDetails = {
              baseButton: buttonId,
              modifierButton: "B1",
              modifierType: "shift",
              baseFunction: buttonData.button_functions[0],
              comboFunction: buttonData.button_functions[1],
              modifierSource: "touch",
            };
            const functionName = buttonData.button_functions[1];
            logger?.logAction(
              `觸控模擬按鈕 "${buttonId}"，功能為 "${functionName}" [組合: Shift + ${buttonId}]`,
              buttonId,
              functionName,
              false,
              true,
              true,
              comboDetails,
            );
          }
          this.simulateButtonClick(buttonId, false); // 第二個參數表示非鍵盤觸發
        },
        { passive: false },
      );

      button.addEventListener("touchend", (event) => {
        const buttonId = button.dataset.label;
        const touchId = event.changedTouches[0].identifier;
        const touchKey = `${buttonId}_${touchId}`;

        // 從活動中觸控集合中移除
        this.activeTouches.delete(touchKey);

        button.classList.remove("touch-active");

        if (buttonId === "B1") {
          // 檢查是否還有其他觸控點在 Shift 按鈕上
          const hasOtherShiftTouches = Array.from(this.activeTouches).some(
            (key) => key.startsWith("B1_"),
          );

          if (!hasOtherShiftTouches) {
            // 設定延遲關閉 Shift 狀態，讓多點觸控有時間執行
            this.touchShiftTimeout = setTimeout(() => {
              this.isTouchShiftActive = false;
              button.classList.remove("shift-active");
            }, 300); // 300ms 延遲
          }
        }
      });

      button.addEventListener("touchcancel", (event) => {
        const buttonId = button.dataset.label;
        const touchId = event.changedTouches[0].identifier;
        const touchKey = `${buttonId}_${touchId}`;

        // 從活動中觸控集合中移除
        this.activeTouches.delete(touchKey);

        button.classList.remove("touch-active");

        if (buttonId === "B1") {
          const hasOtherShiftTouches = Array.from(this.activeTouches).some(
            (key) => key.startsWith("B1_"),
          );

          if (!hasOtherShiftTouches) {
            this.touchShiftTimeout = setTimeout(() => {
              this.isTouchShiftActive = false;
              button.classList.remove("shift-active");
            }, 300);
          }
        }
      });
    });
  }

  /**
   * 設定鍵盤事件
   */
  setupKeyboardEvents() {
    document.addEventListener("keydown", (event) => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.classList?.contains("editable"))
      ) {
        return;
      }

      // 鍵盤按鈕處理
      if (event.key === "Shift") {
        if (!this.isShiftPressed) this.simulateButtonClick("B1", true);
        event.preventDefault();
      } else {
        const targetButtonId = this.keyboardButtonMap[event.key];
        if (targetButtonId) {
          this.simulateButtonClick(targetButtonId, true);
          event.preventDefault();
        }
      }
    });

    document.addEventListener("keyup", (event) => {
      if (event.key === "Shift" && this.isShiftPressed) {
        this.isShiftPressed = false;
        document
          .querySelector(".button-overlay[data-label=\"B1\"]")
          ?.classList.remove("shift-active");
        this._getLogger()?.logAction("鍵盤 Shift 放開");
      }
    });
  }

  // ==========================================
  // 同步處理
  // ==========================================

  /**
   * 顯示按鈕按下視覺回饋
   */
  showButtonPressFeedback(buttonId) {
    const button = document.querySelector(
      `.button-overlay[data-label="${buttonId}"]`,
    );
    if (button) {
      button.classList.add("sync-pressed");
      setTimeout(() => {
        button.classList.remove("sync-pressed");
      }, 200);
    }
  }

  /**
   * 處理遠端按鈕按下事件（來自 sync_state_update 事件）
   */
  handleRemoteButtonPress(data) {
    const buttonId = data.button;
    const functionName = data.function;
    const flowManager = this._getFlowManager();
    const logger = this._getLogger();

    // 顯示按鈕按下的視覺回饋
    this.showButtonPressFeedback(buttonId);

    if (data.beepEnabled) {
      this.playBeep();
    }

    // 在實驗模式下，執行對應的實驗動作
    if (flowManager?.isRunning) {
      this.checkAndExecuteExperimentAction(
        buttonId,
        functionName,
        true,
      );
    }

    // 記錄按鈕動作
    logger?.logAction(
      `按鈕 "${buttonId}" 被按下，功能為 "${functionName}"`,
      "button_press",
      functionName,
      false,
      false,
      false,
      null,
      { buttonId, functionName, beepEnabled: data.beepEnabled },
    );
  }

  /**
   * 處理裝置模式變更
   */
  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    // 根據模式顯示/隱藏按鈕或修改樣式
    const buttons = document.querySelectorAll(".button-overlay");
    buttons.forEach((button) => {
      if (isInteractive) {
        button.classList.remove("view-only-mode");
      } else {
        button.classList.add("view-only-mode");
      }
    });
  }

  // ==========================================
  // 觸控處理
  // ==========================================

  /**
   * 觸控 shift 的特殊處理
   */
  executeTouchShift() {
    const button = document.querySelector(".button-overlay[data-label=\"B1\"]");
    if (!button) return;

    // 基本 Shift 按鈕記錄
    this._getLogger()?.logAction(
      "觸控模擬按鈕 \"B1\" (Shift)，功能為 \"shift\"",
      "B1",
      "shift",
      false,
      true,
    );

    // 實驗模式下檢查是否有對應的動作
    if (this._getFlowManager()?.isRunning) {
      this.checkAndExecuteExperimentAction("B1", "shift");
    }

    this.playBeep();
  }

  // ==========================================
  // 音效處理
  // ==========================================

  /**
   * 播放按鈕提示音
   */
  playBeep() {
    const toggleBeepSound = document.getElementById("toggleBeepSound");
    if (toggleBeepSound?.checked) {
      const beepAudio = document.getElementById("beepSound");
      if (beepAudio) {
        beepAudio.currentTime = 0;

        // 嘗試播放，如果失敗則初始化音訊上下文
        const playPromise = beepAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            // 如果是因為沒有使用者交互導致的錯誤，嘗試初始化音訊上下文
            if (error.name === "NotAllowedError") {
              Logger.warn("音訊播放被阻止，需要使用者交互後才能播放");
              // 不顯示錯誤訊息給使用者，因為這是正常的瀏覽器行為
            } else {
              Logger.warn("播放提示音失敗:", error);
            }
          });
        }
      }
    }
  }

  // ==========================================
  // 實驗動作處理
  // ==========================================

  /**
   * 處理實驗動作載入事件
   * @param {Object} data - 動作數據
   */
  handleExperimentActionsLoaded(data) {
    const { actions } = data;

    if (!actions || !Array.isArray(actions)) {
      Logger.warn("無效的實驗動作數據");
      return;
    }

    // 清空舊的動作數據
    this.experimentActions.clear();

    // 儲存新的動作數據
    actions.forEach((actionData) => {
      this.experimentActions.set(actionData.buttonId, actionData);
    });

    Logger.debug(`已載入 ${actions.length} 個實驗動作`);

    // 立即高亮第一個動作對應的按鈕
    this.updateMediaForCurrentAction();
  }

  /**
   * 檢查按鈕是否為實驗動作按鈕
   * @param {string} buttonId - 按鈕ID
   * @returns {boolean} 是否為實驗動作按鈕
   */
  isExperimentActionButton(buttonId) {
    return this.experimentActions.has(buttonId);
  }

  /**
   * 取得按鈕的實驗動作數據
   * @param {string} buttonId - 按鈕ID
   * @returns {Object|null} 動作數據
   */
  getExperimentActionData(buttonId) {
    return this.experimentActions.get(buttonId) || null;
  }

  /**
   * 傳遞按鈕動作點擊事件
   * @param {string} buttonId - 按鈕ID
   */
  emitButtonActionClick(buttonId) {
    const actionData = this.getExperimentActionData(buttonId);
    if (!actionData) {
      Logger.warn(`按鈕 ${buttonId} 不是實驗動作按鈕`);
      return;
    }

    // 傳遞事件給 Page Manager
    const event = new CustomEvent("button:action-clicked", {
      detail: {
        buttonId: buttonId,
        actionId: actionData.actionId,
        action: actionData.action,
      },
      bubbles: true,
    });
    window.dispatchEvent(event);

    Logger.debug(`已傳遞按鈕動作點擊事件: ${buttonId}`);
  }

  /**
   * 顯示動作回饋
   * @param {string} buttonId - 按鈕ID
   * @param {string} type - 回饋類型 ('correct' | 'incorrect')
   */
  showActionFeedback(buttonId, type) {
    const buttonElement = document.querySelector(`[data-label="${buttonId}"]`);
    if (!buttonElement) {
      Logger.warn(`找不到按鈕元素: ${buttonId}`);
      return;
    }

    // 新增回饋CSS類別
    const feedbackClass =
      type === "correct" ? "action-correct" : "action-incorrect";
    buttonElement.classList.add(feedbackClass);

    // 1秒後移除回饋類別
    setTimeout(() => {
      buttonElement.classList.remove(feedbackClass);
    }, 1000);

    Logger.debug(`顯示動作回饋: ${buttonId} (${type})`);
  }

  /**
   * 監聽按鈕動作驗證結果事件
   * @param {Function} callback - 回調函數
   */
  onActionValidationResult(callback) {
    const listener = (event) => {
      callback(event.detail);
    };

    window.addEventListener("experiment:action-validation", listener);
    this.actionListeners.set("action-validation", listener);
  }

  /**
   * 移除事件監聽器
   */
  removeActionListeners() {
    this.actionListeners.forEach((listener, eventName) => {
      window.removeEventListener(eventName, listener);
    });
    this.actionListeners.clear();
  }

  /**
   * Minimal event-emitter API to support PageManager expectations
   * on(eventName, handler) - register
   * off(eventName, handler) - unregister
   * emit(eventName, data) - invoke handlers and also dispatch DOM event
   */
  on(eventName, handler) {
    if (!this._events) this._events = new Map();
    const list = this._events.get(eventName) || [];
    list.push(handler);
    this._events.set(eventName, list);
  }

  off(eventName, handler) {
    if (!this._events) return;
    const list = this._events.get(eventName) || [];
    this._events.set(
      eventName,
      list.filter((h) => h !== handler),
    );
  }

  emit(eventName, data) {
    if (this._events && this._events.get(eventName)) {
      this._events.get(eventName).forEach((h) => {
        try {
          h(data);
        } catch (e) {
          Logger?.error("buttonManager event handler error", e);
        }
      });
    }

    // Also dispatch a global DOM event for other modules that rely on it
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    } catch (e) {
      // ignore
    }
  }
}

// ES6 模組匯出
export default ButtonManager;
export { ButtonManager };
