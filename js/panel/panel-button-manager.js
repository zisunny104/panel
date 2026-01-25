/**
 * 按鈕管理器 - 負責處理所有按鈕互動、實驗邏輯和同步功能
 */
class ButtonManager {
  constructor() {
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
      Enter: "B16" // enter
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

    // 初始化
    this.loadButtonFunctions();
    this.setupEventListeners();
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
      this.buttonFunctionsMap = data;
    } catch (error) {
      console.error("載入按鈕功能配置失敗:", error);
    }
  }

  /**
   * 清空按鈕功能對照表
   */
  clearButtonFunctions() {
    this.buttonFunctionsMap = {};
  }

  // ==========================================
  // 按鈕模擬和處理
  // ==========================================

  /**
   * 模擬按鈕點擊（鍵盤/觸控用）
   */
  simulateButtonClick(buttonId, isKeyboardTriggered = false) {
    const button = document.querySelector(
      `.button-overlay[data-label="${buttonId}"]`
    );
    const shiftButtonOverlay = document.querySelector(
      ".button-overlay[data-label=\"B1\"]"
    );
    if (!button) return;

    const buttonData = this.buttonFunctionsMap[buttonId];
    let functionName = "未知功能";
    let actionMessage = `按鈕 "${buttonId}" 被按下`;

    if (buttonData?.button_functions) {
      if (buttonId === "B1") {
        this.isShiftPressed = !this.isShiftPressed;
        button.classList.toggle("shift-active", this.isShiftPressed);
        actionMessage = this.isShiftPressed
          ? "模擬按鈕 \"B1\" (Shift) 按下"
          : "模擬按鈕 \"B1\" (Shift) 放開";
        functionName = "shift";
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
            modifierSource: this.isShiftPressed ? "keyboard" : "touch"
          };
          window.logger?.logAction(
            `${actionMessage}，功能為 "${functionName}" [組合: Shift + ${buttonId}]`,
            buttonId,
            functionName,
            isKeyboardTriggered,
            false,
            true,
            comboDetails
          );
        } else {
          window.logger?.logAction(
            `${actionMessage}，功能為 "${functionName}"`,
            buttonId,
            functionName,
            isKeyboardTriggered
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
      window.logger?.logAction(
        `${actionMessage}，功能為 "${functionName}"`,
        buttonId,
        functionName,
        isKeyboardTriggered
      );
    }

    // 實驗模式下檢查是否有對應的動作
    if (window.panelExperiment?.isExperimentRunning) {
      if (this.checkAndExecuteExperimentAction(buttonId, functionName)) {
        // 注意：按鈕動作廣播已移至 completeCurrentAction() 中進行
        // 確保包含 action_id，避免重複廣播

        // 記錄動作進度
        if (
          window.actionManager &&
          window.actionManager.currentActionSequence?.length > 0
        ) {
          const currentActionIndex = window.actionManager.currentActionIndex;
          const totalActions =
            window.actionManager.currentActionSequence.length;
          const prevAction =
            window.actionManager.currentActionSequence[
              Math.max(0, currentActionIndex - 1)
            ];
          const logMessage = `按鈕 "${buttonId}" → 功能 "${functionName}" | 動作: ${
            prevAction?.action_id || "未知"
          } [${currentActionIndex}/${totalActions}]`;
          window.logger?.logAction(logMessage);
        }
      }
    }

    this.playBeep();

    // 廣播按鈕按下事件到其他同步裝置
    this.broadcastButtonPress(buttonId, functionName);
  }

  /**
   * 廣播按鈕按下事件
   */
  broadcastButtonPress(buttonId, functionName) {
    // 取得提示音狀態
    const toggleBeepSound = document.getElementById("toggleBeepSound");
    const beepEnabled = toggleBeepSound?.checked || false;

    const buttonData = {
      button: buttonId,
      function: functionName,
      beepEnabled: beepEnabled,
      timestamp: Date.now()
    };

    // 本機廣播事件
    document.dispatchEvent(
      new CustomEvent("buttonPressed", {
        detail: buttonData
      })
    );

    // 向後端同步按鈕狀態（只有 operator 角色可以發送）
    if (
      window.syncClient &&
      window.syncClient.connected &&
      window.syncClient.role === window.SyncManager?.ROLE?.OPERATOR
    ) {
      const syncResult = window.syncClient.syncState({
        type: "buttonPress",
        device_id: window.syncClient?.clientId || "button_manager",
        button: buttonId,
        function: functionName,
        beepEnabled: beepEnabled,
        timestamp: new Date().toISOString()
      });

      if (!syncResult) {
        Logger.debug("作為本機模式，按鈕事件僅儲存本機");
      }
    }
  }

  // ==========================================
  // 實驗邏輯處理
  // ==========================================

  /**
   * 檢查並執行實驗模式下的對應動作
   */
  checkAndExecuteExperimentAction(buttonId, functionName) {
    // 檢查實驗是否在執行中
    if (!window.panelExperiment?.isExperimentRunning) return false;
    // 確保動作管理員已初始化（當實驗開始時自動初始化）
    if (window.actionManager && !window.actionManager.isInitialized) {
      // 使用 async 函式但不等待，讓實驗繼續執行
      window.actionManager
        .initializeFromExperiment()
        .then((initialized) => {
          // Action sequence initialized
        })
        .catch((error) => {
          Logger.error("動作序列初始化失敗:", error);
        });
    }

    // 處理動作序列邏輯
    if (
      window.actionManager &&
      window.actionManager.currentActionSequence.length > 0
    ) {
      return this.handleActionBasedExperiment(buttonId, functionName);
    }

    return false;
  }

  /**
   * 處理動作序列實驗邏輯
   */
  handleActionBasedExperiment(buttonId, functionName) {
    // 防重複觸發檢查
    const now = Date.now();
    if (now - this.lastActionTime < this.actionCooldown) {
      Logger.debug(
        `忽略重複按鈕動作: ${buttonId} (${now - this.lastActionTime}ms)`
      );
      return false;
    }
    this.lastActionTime = now;

    if (!window.actionManager) {
      return false;
    }

    let currentAction = window.actionManager.getCurrentAction();
    if (!currentAction) {
      return false;
    }

    // 自動跳過沒有 action_buttons 的動作（同時檢查是否需要觸發冷卻）
    while (currentAction && !currentAction.action_buttons) {
      // 儲存目前 action，檢查是否為 step 最後一個
      const skippedAction = currentAction;

      window.actionManager.completeCurrentAction();
      currentAction = window.actionManager.getCurrentAction();

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
      currentAction
    );

    // 記錄按鈕點擊到 JSONL 實驗紀錄
    if (window.panelExperimentLog) {
      const expectedButtons = Array.isArray(currentAction.action_buttons)
        ? currentAction.action_buttons.join(",")
        : currentAction.action_buttons;
      window.panelExperimentLog.logButtonClick(
        buttonId,
        functionName,
        isValidButton,
        isValidButton ? null : expectedButtons
      );
    }

    if (isValidButton) {
      // 檢查 action 是否有下一步的互動定義
      if (
        currentAction.interactions &&
        currentAction.interactions[functionName]
      ) {
        const interaction = currentAction.interactions[functionName];
        const nextActionId = interaction.next_action_id;

        if (nextActionId) {
          // 儲存目前 action 用於檢查
          const completedAction = currentAction;

          // 完成目前 action
          window.actionManager.completeCurrentAction();

          // 查找下一個 action
          const nextActionIndex =
            window.actionManager.currentActionSequence.findIndex(
              (action) => action.action_id === nextActionId
            );

          // 取得下一個 action 物件
          const nextAction =
            nextActionIndex !== -1
              ? window.actionManager.currentActionSequence[nextActionIndex]
              : null;

          if (nextActionIndex !== -1) {
            window.actionManager.currentActionIndex = nextActionIndex;
          }

          // 冷卻邏輯分兩種情況：
          // 情況1：如果 step 只有 1 個 action -> 完成時冷卻
          // 情況2：如果 step 有多個 action -> 進入最後一個 action 時冷卻

          const stepInfo = window.actionManager.actionToStepMap?.get(
            completedAction.action_id
          );
          const stepActions = stepInfo
            ? window.actionManager.currentActionSequence.filter(
                (a) =>
                  window.actionManager.actionToStepMap?.get(a.action_id)
                    ?.step_id === stepInfo.step_id
              )
            : [];

          let shouldCooldown = false;
          let cooldownReason = "";

          // 取得目前 unit 的所有 step
          const currentUnitId =
            window.panelExperiment?.loadedUnits?.[
              window.panelExperiment?.currentUnitIndex
            ];
          const allStepsInUnit = new Set();
          if (currentUnitId && window.actionManager.actionToStepMap) {
            for (const [_actionId, stepData] of window.actionManager
              .actionToStepMap) {
              if (stepData.unit_id === currentUnitId) {
                allStepsInUnit.add(stepData.step_id);
              }
            }
          }

          const allStepsArray = Array.from(allStepsInUnit);
          const isFirstStep = allStepsArray.indexOf(stepInfo?.step_id) === 0;
          const isLastStep =
            allStepsArray.indexOf(stepInfo?.step_id) ===
            allStepsArray.length - 1;

          if (stepActions.length === 1) {
            // 單個 action 的 step，只有在首尾時才冷卻
            shouldCooldown = isFirstStep || isLastStep;
            cooldownReason = shouldCooldown
              ? `單個 action 的 ${isFirstStep ? "首" : "尾"} step 完成`
              : "單個 action 的中間 step，跳過冷卻";
          } else if (stepActions.length > 1) {
            shouldCooldown = nextAction && nextAction.isLastActionInStep;
            cooldownReason = "進入 step 的最後一個 action";
          }

          if (shouldCooldown) {
            Logger.debug(
              `觸發冷卻效果: ${cooldownReason} | ` +
                `完成Action: ${completedAction.action_id} (${completedAction.action_name}) | ` +
                `Step: ${stepInfo?.step_id || "unknown"} | ` +
                `Step Actions: ${stepActions.length} | ` +
                `下一個Action: ${nextAction?.action_id || "無"}`
            );
            this.triggerStepCompleteEffect();
          } else {
            Logger.debug(
              `跳過冷卻效果: ${cooldownReason} | ` +
                `完成Action: ${completedAction.action_id} (${completedAction.action_name}) | ` +
                `Step: ${stepInfo?.step_id || "unknown"} | ` +
                `Step Actions: ${stepActions.length} | ` +
                `下一個Action: ${nextAction?.action_id || "無"}`
            );
            // 更新媒體顯示
            this.updateMediaForCurrentAction();
          }

          return true;
        }
      } else {
        // 沒有定義互動，直接完成並移到下一個
        const completedAction = currentAction;
        window.actionManager.completeCurrentAction();

        // 冷卻邏輯：
        // 情況1：step 只有 1 個 action -> 只有在首尾 step 時才冷卻
        // 情況2：step 有多個 action -> 進入最後一個 action 時冷卻
        const stepInfo = window.actionManager.actionToStepMap?.get(
          completedAction.action_id
        );
        const stepActions = stepInfo
          ? window.actionManager.currentActionSequence.filter(
              (a) =>
                window.actionManager.actionToStepMap?.get(a.action_id)
                  ?.step_id === stepInfo.step_id
            )
          : [];
        const nextAction = window.actionManager.getCurrentAction();

        let shouldCooldown = false;
        let cooldownReason = "";

        // 取得目前 unit 的所有 step
        const currentUnitId =
          window.panelExperiment?.loadedUnits?.[
            window.panelExperiment?.currentUnitIndex
          ];
        const allStepsInUnit = new Set();
        if (currentUnitId && window.actionManager.actionToStepMap) {
          for (const [_actionId, stepData] of window.actionManager
            .actionToStepMap) {
            if (stepData.unit_id === currentUnitId) {
              allStepsInUnit.add(stepData.step_id);
            }
          }
        }
        const allStepsArray = Array.from(allStepsInUnit);
        const isFirstStep = allStepsArray.indexOf(stepInfo?.step_id) === 0;
        const isLastStep =
          allStepsArray.indexOf(stepInfo?.step_id) === allStepsArray.length - 1;

        if (stepActions.length === 1) {
          // 單個 action 的 step，只有在首尾時才冷卻
          shouldCooldown = isFirstStep || isLastStep;
          cooldownReason = shouldCooldown
            ? `單個 action 的 ${isFirstStep ? "首" : "尾"} step 完成`
            : "單個 action 的中間 step，跳過冷卻";
        } else if (stepActions.length > 1) {
          shouldCooldown = nextAction && nextAction.isLastActionInStep;
          cooldownReason = "進入 step 的最後一個 action";
        }

        if (shouldCooldown) {
          Logger.debug(
            `觸發冷卻效果: ${cooldownReason} | ` +
              `完成Action: ${completedAction.action_id} (${completedAction.action_name}) | ` +
              `Step: ${stepInfo?.step_id || "unknown"} | ` +
              `Step Actions: ${stepActions.length} | ` +
              `下一個Action: ${nextAction?.action_id || "無"}`
          );
          this.triggerStepCompleteEffect();
        } else {
          Logger.debug(
            `跳過冷卻效果: ${cooldownReason} | ` +
              `完成Action: ${completedAction.action_id} (${completedAction.action_name}) | ` +
              `Step: ${stepInfo?.step_id || "unknown"} | ` +
              `Step Actions: ${stepActions.length} | ` +
              `下一個Action: ${nextAction?.action_id || "無"}`
          );
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
    // 檢查視覺提示是否開啟
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const visualsEnabled = toggleTouchVisuals
      ? toggleTouchVisuals.checked
      : true;

    // 先切換到下一步的媒體
    this.updateMediaForCurrentAction();

    // 檢查是否還有下一個動作（實驗是否已完成）
    const nextAction = window.actionManager?.getCurrentAction();
    if (!nextAction) {
      // 實驗已完成，不執行冷卻效果
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

    // 3 秒後移除冷卻效果
    setTimeout(() => {
      if (mediaArea) {
        mediaArea.classList.remove("cooldown-indicator");
      }

      allButtons.forEach((btn) => {
        btn.classList.remove("temporarily-disabled");
        btn.style.pointerEvents = "";
      });
    }, 3000);
  }

  /**
   * 檢查按鈕是否符合目前 action 的要求
   */
  isButtonValidForAction(buttonId, functionName, action) {
    if (!action || !action.action_buttons) {
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
    return isValid;
  }

  /**
   * 更新目前 action 的媒體顯示
   */
  updateMediaForCurrentAction() {
    // 自動跳過沒有 action_buttons 的動作，但先顯示其媒體
    let currentAction = window.actionManager.getCurrentAction();
    while (currentAction && !currentAction.action_buttons) {
      if (currentAction.media_file && window.mediaManager) {
        window.mediaManager.displayMedia(currentAction.media_file);
      } else if (window.mediaManager) {
        // 如果沒有設定媒體，強制播放首頁循環影片
        window.mediaManager.playHomePageLoop(true);
      }
      window.actionManager.completeCurrentAction();
      currentAction = window.actionManager.getCurrentAction();
    }

    // 清除所有按鈕的高亮（包括主次、Shift）
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
      btn.classList.remove("next-step-highlight-secondary");
      btn.classList.remove("next-step-highlight-shift");
    });

    if (currentAction) {
      // 顯示媒體
      if (currentAction.media_file && window.mediaManager) {
        window.mediaManager.displayMedia(currentAction.media_file);
      } else if (window.mediaManager) {
        // 如果沒有設定媒體，強制播放首頁循環影片（即使在實驗模式）
        window.mediaManager.playHomePageLoop(true);
      }

      // 高亮下一個有效的按鈕
      if (currentAction.action_buttons) {
        const actionButtons = Array.isArray(currentAction.action_buttons)
          ? currentAction.action_buttons
          : currentAction.action_buttons.split(",").map((s) => s.trim());

        const matchedButtons = []; // 儲存符合的按鈕
        const requiresShiftFunctions = []; // 儲存需要 Shift 的功能
        let _highlightedCount = 0;

        // 取得 interactions 的順序
        const interactionsOrder = currentAction.interactions
          ? Object.keys(currentAction.interactions)
          : [];

        // 第一次操作：掃描所有按鈕，找出符合的按鈕
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          const buttonId = btn.dataset.label;
          const buttonFunctions = this.getButtonFunctions(buttonId);

          const hasMatchingFunction = buttonFunctions.some((func) =>
            actionButtons.includes(func)
          );

          if (hasMatchingFunction) {
            // 檢查該功能是否在第二位置（需要 Shift）
            buttonFunctions.forEach((func, index) => {
              if (actionButtons.includes(func) && index === 1) {
                requiresShiftFunctions.push(func);
              }
            });
            matchedButtons.push({ btn, buttonId, buttonFunctions });
          }
        });

        // 按照 interactions 中的順序排序 matchedButtons
        matchedButtons.sort((a, b) => {
          const aIndex = interactionsOrder.indexOf(a.buttonFunctions[0]);
          const bIndex = interactionsOrder.indexOf(b.buttonFunctions[0]);
          return aIndex - bIndex;
        });

        // 第一個按鈕用綠色高亮，其餘用橘色高亮
        matchedButtons.forEach((item, index) => {
          if (index === 0) {
            // 綠色（主按鈕）
            item.btn.classList.add("next-step-highlight");
            item.btn.classList.remove("next-step-highlight-secondary");
          } else {
            // 橘色（次按鈕）
            item.btn.classList.remove("next-step-highlight");
            item.btn.classList.add("next-step-highlight-secondary");
          }
          _highlightedCount++;
        });

        // 檢查是否需要 B1 (Shift) - 根據 buttons.json 判斷
        const shiftButton = document.querySelector(
          ".button-overlay[data-label=\"B1\"]"
        );

        if (requiresShiftFunctions.length > 0 && shiftButton) {
          // Shift 也用綠色高亮（和主按鈕同色）
          shiftButton.classList.add("next-step-highlight");
        } else if (shiftButton) {
          shiftButton.classList.remove("next-step-highlight");
          shiftButton.classList.remove("next-step-highlight-shift");
        }
      }
    } else {
      const powerSwitchArea = document.getElementById("powerSwitchArea");
      if (powerSwitchArea) {
        powerSwitchArea.classList.add("next-step-highlight");
      }
    }
  }

  /**
   * 取得按鈕的所有功能名稱
   */
  getButtonFunctions(buttonId) {
    const buttonConfig = this.buttonFunctionsMap[buttonId];
    return buttonConfig?.button_functions || [];
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
    if (window.powerControl) return window.powerControl.isPowerOn;
    const powerLightOn = document.querySelector(".power-light-on-img");
    if (powerLightOn) return powerLightOn.style.display !== "none";
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
    // 監聽來自其他裝置的按鈕同步（廣播事件）
    document.addEventListener("syncButtonPress", (e) => {
      this.handleSyncButtonPress(e.detail);
    });

    // 監聽來自輪詢機制的全域狀態更新（從 sync-client.js 的 triggerStateUpdate 觸發）
    window.addEventListener("sync_state_update", (e) => {
      if (e.detail && e.detail.type === "buttonPress") {
        this.handleRemoteButtonPress(e.detail);
      }
    });

    // 監聽裝置模式變更
    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });
  }

  /**
   * 設定滑鼠事件
   */
  setupMouseEvents() {
    document.querySelectorAll(".button-overlay").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (event.pointerType === "touch" || event.detail === 0) return;
        this.simulateButtonClick(button.dataset.label, false);
      });
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

            if (window.experiment?.isExperimentRunning) {
              // 移除舊的實驗邏輯調用
              this.playBeep();
              return;
            }
            this.executeTouchShift();
            return;
          }

          if (window.experiment?.isExperimentRunning) {
            // 移除舊的實驗邏輯調用
            this.playBeep();
            return;
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
              modifierSource: "touch"
            };
            const functionName = buttonData.button_functions[1];
            window.logger?.logAction(
              `觸控模擬按鈕 "${buttonId}"，功能為 "${functionName}" [組合: Shift + ${buttonId}]`,
              buttonId,
              functionName,
              false,
              true,
              true,
              comboDetails
            );
          }
          this.simulateButtonClick(buttonId, false); // 第二個參數表示非鍵盤觸發
        },
        { passive: false }
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
            (key) => key.startsWith("B1_")
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
            (key) => key.startsWith("B1_")
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
        window.logger?.logAction("鍵盤 Shift 放開");
      }
    });
  }

  // ==========================================
  // 同步處理
  // ==========================================

  /**
   * 處理按鈕同步
   */
  handleSyncButtonPress(data) {
    // 同步視覺效果和狀態
    const button = document.querySelector(
      `.button-overlay[data-label="${data.button}"]`
    );
    if (button) {
      // 顯示按鈕被按下的視覺效果
      button.classList.add("sync-pressed");
      setTimeout(() => {
        button.classList.remove("sync-pressed");
      }, 200);

      // 如果是 Shift 按鈕，同步 Shift 狀態
      if (data.button === "B1") {
        // 目前不改變本機 Shift 狀態，只顯示視覺回饋
      }
    }

    // 在實驗模式下，如果是觀看模式，也要觸發實驗邏輯
    if (
      window.experiment?.isExperimentRunning &&
      window.syncManager &&
      !window.syncManager.isInteractiveMode
    ) {
      this.checkAndExecuteExperimentAction(data.button, data.function);
    }
  }

  /**
   * 處理遠端按鈕按下事件（來自 sync_state_update 事件）
   */
  handleRemoteButtonPress(data) {
    // 只有在檢視模式下時才套用遠端按鈕狀態
    if (window.syncManager && window.syncManager.isInteractiveMode) {
      return;
    }

    const buttonId = data.button;
    const functionName = data.function;

    // 顯示按鈕按下的視覺回饋
    const button = document.querySelector(
      `.button-overlay[data-label="${buttonId}"]`
    );
    if (button) {
      // 視覺回饋：按鈕被按下
      button.classList.add("sync-pressed");
      setTimeout(() => {
        button.classList.remove("sync-pressed");
      }, 200);
    }

    // 播放提示音（如果遠端裝置也播放了，我們本機也應該播放）
    if (data.beepEnabled) {
      this.playBeep();
    }

    // 在實驗模式下，執行對應的實驗動作
    if (window.experiment?.isExperimentRunning) {
      const result = this.checkAndExecuteExperimentAction(
        buttonId,
        functionName
      );
      if (result) {
        const unitId =
          window.experiment.loadedUnits[window.experiment.currentUnitIndex];
        const unit = window._allUnits?.find((u) => u.unit_id === unitId);
        const step = unit?.steps?.[window.experiment.currentStepIndex];
        const stepName = step?.step_name || step?.step_id || "未知步驟";

        if (window.logger) {
          window.logger.logAction(
            `[遠端同步] 按鈕 "${buttonId}" → 功能 "${functionName}" | 步驟: ${stepName}`
          );
        }
      }
    }

    // 記錄遠端按鈕事件到紀錄檔
    if (window.logger) {
      window.logger.logAction(
        `[遠端同步] 按鈕 "${buttonId}" 被按下，功能為 "${functionName}"`,
        "remote_button_press",
        functionName,
        false,
        false,
        false,
        null,
        { buttonId, functionName, beepEnabled: data.beepEnabled }
      );
    }

    // 觸發 remoteButtonPressed 事件供實驗頁面的 experiment-action-manager 接收
    // 這樣實驗頁面可以同步完成對應的動作卡片
    if (window.experiment?.isExperimentRunning) {
      const remoteButtonEvent = new CustomEvent("remoteButtonPressed", {
        detail: {
          button: buttonId,
          experimentId: window.experiment.currentExperimentId,
          timestamp: data.timestamp
        }
      });
      window.dispatchEvent(remoteButtonEvent);
    }
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
    window.logger?.logAction(
      "觸控模擬按鈕 \"B1\" (Shift)，功能為 \"shift\"",
      "B1",
      "shift",
      false,
      true
    );

    // 實驗模式下檢查是否有對應的動作
    if (window.experiment?.isExperimentRunning) {
      if (this.checkAndExecuteExperimentAction("B1", "shift")) {
        // 取得目前步驟資訊以合併紀錄
        const unitId =
          window.experiment.loadedUnits[window.experiment.currentUnitIndex];
        const unit = window._allUnits?.find((u) => u.unit_id === unitId);
        const step = unit?.steps?.[window.experiment.currentStepIndex];
        const stepName = step?.step_name || step?.step_id || "未知步驟";

        window.logger?.logAction(
          `按鈕 "B1" → 功能 "shift" | 步驟: ${stepName}`
        );
      }
    }

    this.playBeep();
  }

  /**
   * 檢查多點觸控狀態
   */
  checkMultiTouchStatus() {
    const activeTouchCount = this.activeTouches.size;
    const hasShiftTouch = Array.from(this.activeTouches).some((key) =>
      key.startsWith("B1_")
    );

    return {
      activeTouchCount,
      hasShiftTouch,
      isShiftActive: this.isTouchShiftActive
    };
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
      const beepAudio = document.getElementById("beepAudio");
      if (beepAudio) {
        beepAudio.currentTime = 0;
        beepAudio.play().catch((error) => {
          console.warn("播放提示音失敗:", error);
        });
      }
    }
  }
}

// 匯出單例
window.buttonManager = new ButtonManager();





