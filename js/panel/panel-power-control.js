/**
 * PowerControl - 電源控制管理器
 *
 * 負責電源狀態管理、UI更新和多裝置同步
 */
import {
  ACTION_IDS,
  POWER_BUTTON_STATES,
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";

class PowerControl {
  constructor({
    panelLogger = null,
    experimentActionHandler = null,
    experimentFlowManager = null,
    experimentSystemManager = null,
    experimentCombinationManager = null,
    experimentSyncCore = null,
    syncClient = null,
    buttonManager = null,
    panelMediaManager = null,
  } = {}) {
    this.panelLogger = panelLogger;
    this.experimentActionHandler = experimentActionHandler;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSystemManager = experimentSystemManager;
    this.experimentCombinationManager = experimentCombinationManager;
    this.experimentSyncCore = experimentSyncCore;
    this.syncClient = syncClient;
    this.buttonManager = buttonManager;
    this.panelMediaManager = panelMediaManager;
    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    this._suppressPowerActionCompletionUntil = 0;
    this._syncRestoreMediaTimer = null;
    this.powerOnBtn = document.getElementById("powerOnBtn");
    this.powerOffBtn = document.getElementById("powerOffBtn");
    this.emergencyStopBtn = document.getElementById("emergencyStopBtn");
    this.quickPowerOnBtn = document.getElementById("quickPowerOnBtn");
    this.powerKnob = document.getElementById("powerKnob");
    this.powerLightOn = document.getElementById("powerLightOn");
    this.powerLightArea = document.getElementById("powerLightArea");
    this.mediaArea = document.getElementById("mediaArea");
    this.powerSwitchArea = document.getElementById("powerSwitchArea");
    this.buttonOverlays = document.querySelectorAll(".button-overlay");
    this._debounceTimers = {};
    this.setupEventListeners();
    // 監聽電源狀態變化，用於電源動作完成回報
    document.addEventListener("power_state_changed", (event) => {
      this._handlePowerActionCompletion(event.detail);
    });
    this.updatePowerUIWithoutSync();
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 防抖機制：在指定時間內防止重複觸發
   * @param {string} key - 防抖鍵值（如 'greenLight', 'quickPowerOn'）
   * @param {number} delay - 防抖延遲時間（毫秒）
   * @returns {boolean} 是否允許觸發（true = 允許，false = 在防抖期間）
   */
  _debounce(key, delay) {
    const now = Date.now();
    if (this._debounceTimers[key] && now - this._debounceTimers[key] < delay) {
      return false;
    }
    this._debounceTimers[key] = now;
    return true;
  }

  /**
   * 清空媒體區域並復原樣式
   * @private
   */
  _clearMediaArea() {
    if (!this.panelMediaManager) return;
    const mediaManager = this.panelMediaManager;
    if (mediaManager.mediaArea) {
      mediaManager.mediaArea.innerHTML = "";
      mediaManager.mediaArea.classList.remove("loading");
    }
  }

  _mediaAreaHasRenderableContent() {
    const mediaArea = this.panelMediaManager?.mediaArea;
    if (!mediaArea) return false;
    return mediaArea.childElementCount > 0;
  }

  _ensureMediaFallbackIfNeeded() {
    if (!this.isPowerOn) return;
    const mediaManager = this.panelMediaManager;
    if (!mediaManager) return;
    if (this._mediaAreaHasRenderableContent()) return;

    Logger.debug("偵測到電源已開啟但媒體區為空，套用首頁媒體 fallback");
    mediaManager.playHomePageLoop(true);
  }

  _refreshMediaAfterSyncRestore() {
    const flowManager = this.experimentFlowManager;
    if (!flowManager?.isRunning) return;

    const buttonManager = this.buttonManager;
    if (buttonManager) {
      buttonManager.updateMediaForCurrentAction();
      this._ensureMediaFallbackIfNeeded();
      return;
    }

    if (this._syncRestoreMediaTimer) return;
    this._syncRestoreMediaTimer = setTimeout(() => {
      this._syncRestoreMediaTimer = null;
      const manager = this.buttonManager;
      if (manager && this.experimentFlowManager?.isRunning) {
        manager.updateMediaForCurrentAction();
        this._ensureMediaFallbackIfNeeded();
      }
    }, 150);
  }

  /**
   * 更新電源旋鈕 UI 和指示燈
   * @private
   * @param {boolean} shouldDispatch - 是否派送電源狀態變化事件（預設 false）
   */
  _updatePowerKnobUI(shouldDispatch = false) {
    const buttonManager = this.buttonManager;
    // 確保在元素尚未建立時能重新查詢，避免初始化時因 DOM 延遲造成顯示不同步
    if (!this.powerKnob) this.powerKnob = document.getElementById("powerKnob");
    if (!this.powerLightOn) this.powerLightOn = document.getElementById("powerLightOn");

    if (this.powerKnob) {
      this.powerKnob.style.transform = this.isPowerOn
        ? "translate(-50%,-50%) scale(0.95) rotate(90deg)"
        : "translate(-50%,-50%) scale(0.95) rotate(0deg)";
    }

    if (this.powerLightOn) {
      this.powerLightOn.classList.toggle("is-hidden", !this.isPowerOn);
      Logger.debug(`電源燈號已${this.isPowerOn ? "亮起" : "熄滅"} (isPowerOn: ${this.isPowerOn})`);
    } else {
      Logger.warn("powerLightOn 元素未找到");
    }

    this.updateMediaControlButtons();

    if (buttonManager) {
      buttonManager.updateExperimentButtonStyles();
      buttonManager.updateMediaForCurrentAction();
    }

    if (shouldDispatch) {
      this.dispatchPowerStateChanged();
    }
  }

  /**
   * 設定電源開關高亮效果
   * @param {boolean} enable - 是否開啟高亮
   */
  setPowerSwitchHighlight(enable) {
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.toggle("next-step-highlight", enable);
    }
    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.toggle("next-step-highlight", enable);
    });
  }

  /**
   * 確保實驗開始時切斷電源
   * @returns {boolean} 是否執行了重置
   */
  ensurePowerOffForExperimentStart() {
    const mediaManager = this.panelMediaManager;
    const buttonManager = this.buttonManager;
    // 實驗開始時的本機重置：不廣播、不停止流程。
    if (!this.isPowerOn && !this.isPowerVideoPlaying) {
      this.setPowerSwitchHighlight(false);
      return false;
    }
    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      if (mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
        mediaManager.mediaArea.classList.remove("loading");
      }
    }
    this.setPowerSwitchHighlight(false);
    if (buttonManager) {
      this.buttonOverlays.forEach((btn) => {
        btn.classList.remove("next-step-highlight", "next-step-highlight-secondary", "next-step-highlight-shift");
      });
    }
    this.updatePowerUIWithoutSync();
    Logger.debug("Power: 實驗初始化已重置為關機狀態");
    return true;
  }

  /**
   * 若應執行關機，高亮電源開關
   * @param {object} opts - 選項 { includeShutdown }
   * @returns {boolean} 是否執行了高亮
   */
  highlightShutdownIfNeeded({ includeShutdown } = {}) {
    const shouldShutdown =
      typeof includeShutdown === "boolean"
        ? includeShutdown
        : document.getElementById("includeShutdown")?.checked === true;

    if (!shouldShutdown || !this.isPowerOn) {
      return false;
    }
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.add("next-step-highlight");
    }
    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.add("next-step-highlight");
    });

    Logger.debug("Power: 已高亮電源開關，提示關機");
    return true;
  }

  /**
   * 監聽電源狀態變化事件，待動畫完成後將電源 action 標記為完成
   *
   * 說明：
   * - 開機 action：完成時機為 `isPowerVideoPlaying === false` 且 `powerState === true`
   * - 關機 action：完成時機為 `powerState === false`
   * - 遠端同步事件會透過 `_suppressPowerActionCompletionUntil` 暫時抑制（800 ms 時間視窗）
   * - 在抑制時間內不會重複回報 action 完成
   *
   * @private
   * @param {object} detail - `power_state_changed` 事件之資料 { powerState, isPowerVideoPlaying, timestamp }
   */
  async _handlePowerActionCompletion(detail) {
    const actionHandler = this.experimentActionHandler;
    const flowManager = this.experimentFlowManager;
    if (!actionHandler) return;
    if (!flowManager?.isRunning) return;

    if (Date.now() < this._suppressPowerActionCompletionUntil) {
      return;
    }

    const currentAction = actionHandler.getCurrentAction?.();
    const actionId =
      currentAction?.actionId || currentAction?.action_id || null;
    if (!actionId) return;

    const powerState = detail?.powerState;
    // 開機 `action` 需等動畫結束（isPowerVideoPlaying=false）才算完成。
    const isPowerVideoPlaying =
      typeof detail?.isPowerVideoPlaying === "boolean"
        ? detail.isPowerVideoPlaying
        : this.isPowerVideoPlaying;
    const shouldCompletePowerOn =
      actionId === ACTION_IDS.POWER_ON && powerState === true && !isPowerVideoPlaying;
    const shouldCompletePowerOff =
      actionId === ACTION_IDS.POWER_OFF && powerState === false;

    // 僅在電源動作完成時回報同步
    if (shouldCompletePowerOn || shouldCompletePowerOff) {
      if (actionHandler.completedActions?.has(actionId)) {
        return;
      }

      this._dispatchCorrectAction(actionId, {
        source: "power_state",
        powerState: detail?.powerState,
      });

      const syncCore = this.experimentSyncCore;
      const syncClient = this.syncClient;
      const combinationManager = this.experimentCombinationManager;
      const experimentId = systemManager?.getExperimentId?.() || "";
      const currentCombo =
        combinationManager?.getCurrentCombination?.() || null;
      const participantName =
        document.getElementById("participantNameInput")?.value?.trim() || "";
      syncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.ACTION_COMPLETED,
        clientId: syncClient?.clientId || "power_control",
        timestamp: Date.now(),
        actionId,
        powerState: detail?.powerState,
        experimentId,
        combinationId: currentCombo?.combinationId || "",
        participantName,
      }).catch((error) => {
        Logger.warn("同步電源 action 完成失敗:", error);
      });

      if (shouldCompletePowerOn && this.buttonManager?.triggerStepCompleteEffect) {
        Logger.debug("PowerControl: 電源開啟完成，啟動冷卻效果");
        await this.buttonManager.triggerStepCompleteEffect({
          advanceStep: false,
          preserveHighlight: true,
        });
      }

      if (shouldCompletePowerOff) {
        this._stopExperimentForShutdown();
      }
    }
  }

  /**
   * 若目前 action 為電源動作且狀態已符合，直接完成該 action
   * @private
   */
  syncPowerActionWithState() {
    const actionHandler = this.experimentActionHandler;
    if (!actionHandler) return;

    const currentAction = actionHandler.getCurrentAction?.();
    const actionId = currentAction?.actionId || currentAction?.action_id || null;
    Logger.debug("PowerControl: syncPowerActionWithState", {
      currentActionId: actionId,
      isPowerOn: this.isPowerOn,
      isPowerVideoPlaying: this.isPowerVideoPlaying,
    });
    if (!actionId) return;

    if (actionId === ACTION_IDS.POWER_ON && this.isPowerOn) {
      this._dispatchCorrectAction(actionId, { source: "power_state", powerState: true });
    }

    if (actionId === ACTION_IDS.POWER_OFF && !this.isPowerOn) {
      this._dispatchCorrectAction(actionId, { source: "power_state", powerState: false });
      this._stopExperimentForShutdown();
    }
  }

  /**
   * 路由 handleCorrectAction：優先委派給 ExperimentSystemManager，否則直接呼叫 ActionHandler
   * @private
   */
  _dispatchCorrectAction(actionId, ctx) {
    const handler = this.experimentSystemManager?.handleCorrectAction
      ? this.experimentSystemManager
      : this.experimentActionHandler;
    handler?.handleCorrectAction(actionId, ctx);
  }

  /**
   * 停止實驗並重置為關機狀態
   * @private
   */
  _stopExperimentForShutdown() {
    const flowManager = this.experimentFlowManager;
    if (flowManager?.isRunning) {
      flowManager.stopExperiment("power_off", { broadcast: false });
    }
  }

  /**
   * 設定電源狀態（開機/關機）
   * @param {boolean} nextState - 下一個狀態（true=開機，false=關機）
   * @param {string} trigger - 觸發來源（'sync'、'knob'、'panel'）
   */
  setPowerState(nextState, trigger) {
    const logger = this.panelLogger;
    const mediaManager = this.panelMediaManager;
    const buttonManager = this.buttonManager;
    if (trigger === "sync") {
      // 避免同步觸發時重複回報 action 完成
      this._suppressPowerActionCompletionUntil = Date.now() + 800;
      if (nextState === true) {
        this.quickPowerOn();
        return;
      }
    }
    this.setPowerSwitchHighlight(false);

    if (nextState === false) {
      // 關機流程：停止媒體並重置狀態
      this.isPowerOn = false;
      this.isPowerVideoPlaying = false;

      if (mediaManager) {
        mediaManager.stopHomePageLoop();
        this._clearMediaArea();
      }

      this._updatePowerKnobUI(true);
      this.enableAllButtons();

      if (buttonManager) {
        this.buttonOverlays.forEach((btn) => {
          btn.classList.remove("next-step-highlight", "next-step-highlight-secondary", "next-step-highlight-shift");
        });
      }

      if (logger?.logAction) {
        const action = trigger === "knob" ? "旋轉開關關機" : "按鈕關機";
        logger.logAction(
          `${action}，所有影片已停止，媒體區已清空，按鈕狀態已重置`,
        );
      }

      this._stopExperimentForShutdown();
      return;
    }

    if (this.isPowerVideoPlaying || this.isPowerOn === nextState) return;

    if (mediaManager) {
      mediaManager.stopHomePageLoop();
    }

    this.isPowerOn = nextState;
    this.isPowerVideoPlaying = true;
    this._updatePowerKnobUI(false);

    const videoSrc = "assets/units/SYSTEM/power_on.mp4";
    const toggleBeepSound = document.getElementById("toggleBeepSound");
    const beepOn = toggleBeepSound && toggleBeepSound.checked;

    this.disableAllButtons();

    if (logger?.logAction) {
      logger.logAction(
        trigger === "knob"
          ? "旋轉開關開機，開始播放開機影片"
          : "按下開機，開始播放開機影片",
      );
    }

    if (mediaManager) {
      mediaManager.playMediaInArea(videoSrc, {
        controls: false,
        muted: !beepOn,
        onEnded: () => {
          this.enableAllButtons();
          this._clearMediaArea();
          if (logger?.logAction) {
            logger.logAction("開機完成");
          }
          if (mediaManager) {
            mediaManager.playHomePageLoop();
          }

          this.isPowerVideoPlaying = false;

          if (buttonManager) {
            buttonManager.updateExperimentButtonStyles();
            buttonManager.updateMediaForCurrentAction();
          }
          // 開機動畫結束後再次派送狀態，讓 POWER_ON `action` 完成。
          this.dispatchPowerStateChanged();
        },
        onError: () => {
          this.isPowerVideoPlaying = false;
          this.enableAllButtons();
          if (logger?.logAction) {
            logger.logAction("開機影片載入失敗，請檢查路徑與檔案");
          }
        },
      });
    }
  }

  /**
   * 啟用所有控制按鈕
   * @private
   */
  enableAllButtons() {
    const buttonManager = this.buttonManager;
    const flowManager = this.experimentFlowManager;
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    buttonOverlays.forEach((btn) => btn.classList.remove("disabled"));

    this.updateMediaControlButtons();

    if (buttonManager && flowManager?.isRunning) {
      setTimeout(() => {
        buttonManager.updateExperimentButtonStyles();
      }, 10);
    }
  }

  /**
   * 停用所有控制按鈕（開機動畫播放期間）
   * @private
   */
  disableAllButtons() {
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    buttonOverlays.forEach((btn) => btn.classList.add("disabled"));

    if (this.powerOnBtn) this.powerOnBtn.disabled = true;
    if (this.powerOffBtn) this.powerOffBtn.disabled = true;
    if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = false;
    if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = false;
  }

  updateMediaControlButtons() {
    const stateKey = this.isPowerVideoPlaying
      ? "powering"
      : this.isPowerOn
        ? "on"
        : "off";

    const config = POWER_BUTTON_STATES[stateKey];
    if (this.powerOnBtn) this.powerOnBtn.disabled = config.powerOn;
    if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = config.quickPowerOn;
    if (this.powerOffBtn) this.powerOffBtn.disabled = config.powerOff;
    if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = config.emergencyStop;
  }

  /**
   * 設定事件監聽器
   * @private
   */
  setupEventListeners() {
    const logger = this.panelLogger;
    const bindQuickPowerTarget = ({
      element,
      requirePowerOn,
      missingMessage,
      title,
      zIndex,
      logMessage,
      debounceKey,
    }) => {
      if (!element) {
        Logger.debug(missingMessage);
        return;
      }

      const clickHandler = (e) => {
        // 使用通用防抖機制
        if (!this._debounce(debounceKey, 200)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const canQuickPower =
          this.isPowerVideoPlaying && (!requirePowerOn || this.isPowerOn);
        if (canQuickPower) {
          this.quickPowerOn();
        } else if (logger?.logAction) {
          logger.logAction(logMessage());
        }
      };

      element.addEventListener("click", clickHandler, false);
      element.style.cursor = "pointer";
      element.style.pointerEvents = "auto";
      element.style.userSelect = "none";
      if (zIndex) element.style.zIndex = zIndex;
      if (title) element.title = title;
    };
    if (this.powerKnob) {
      this.powerKnob.addEventListener("click", () => {
        this.setPowerState(!(this.isPowerOn || this.isPowerVideoPlaying), "knob");
      });
    }

    if (this.powerOnBtn) {
      this.powerOnBtn.addEventListener("click", () => {
        if (!this.isPowerVideoPlaying && !this.isPowerOn) {
          this.setPowerState(true, "panel");
        }
      });
    }

    if (this.powerOffBtn) {
      this.powerOffBtn.addEventListener("click", () => {
        if (this.isPowerOn || this.isPowerVideoPlaying) {
          this.setPowerState(false, "panel");
        }
      });
    }

    if (this.emergencyStopBtn) {
      this.emergencyStopBtn.addEventListener("click", () => this.emergencyStop());
    }

    if (this.quickPowerOnBtn) {
      this.quickPowerOnBtn.addEventListener("click", () => this.quickPowerOn());
    }

    bindQuickPowerTarget({
      element: this.powerLightOn,
      requirePowerOn: true,
      missingMessage: "找不到綠色燈號元素 (powerLightOn)",
      title: "點擊可快速開機（開機動畫進行中時）",
      zIndex: "1000",
      debounceKey: "greenLight",
      logMessage: () =>
        `綠色燈號點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying}, 電源:${this.isPowerOn})`,
    });

    bindQuickPowerTarget({
      element: this.powerLightArea,
      requirePowerOn: false,
      missingMessage: "找不到電源燈號區域元素 (powerLightArea)",
      title: "點擊可快速開機（開機動畫進行中時）",
      debounceKey: "lightArea",
      logMessage: () =>
        `電源燈號區域點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying})`,
    });

    this.setupSyncEventListeners();
  }

  /**
   * 設定遠端同步事件監聽器
   * @private
   */
  setupSyncEventListeners() {
    document.addEventListener("syncPowerState", (e) => {
      this.handleSyncPowerState(e.detail);
    });

    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });
  }

  /**
   * 監聽裝置模式變化（互動/非互動模式）
   * @param {object} data - 模式數據 { isInteractive }
   * @private
   */
  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    const powerButtons = [
      this.powerOnBtn,
      this.powerOffBtn,
      this.emergencyStopBtn,
      this.quickPowerOnBtn,
    ];
    powerButtons.forEach((button) => {
      button?.classList.toggle("is-hidden", !isInteractive);
    });

    if (this.powerKnob) {
      this.powerKnob.style.pointerEvents = isInteractive ? "auto" : "none";
    }
  }

  /**
   * 緊急停止：立即停止所有內容
   * @private
   */
  emergencyStop() {
    const mediaManager = this.panelMediaManager;
    const flowManager = this.experimentFlowManager;
    const logger = this.panelLogger;
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      this._clearMediaArea();
    }

    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    this._updatePowerKnobUI(true);

    this.enableAllButtons();

    if (flowManager?.isRunning) {
      flowManager.stopExperiment();
    }

    if (logger?.logAction) {
      logger.logAction(
        "緊急停止已啟動，所有系統已停止，媒體區已清空，按鈕狀態已重置",
      );
    }
  }

  /**
   * 快速開機：跳過開機影片，直接進入就緒狀態
   * 採用防抖機制（500ms）防止重複觸發
   */
  quickPowerOn() {
    const logger = this.panelLogger;
    const mediaManager = this.panelMediaManager;
    const flowManager = this.experimentFlowManager;
    const buttonManager = this.buttonManager;
    if (!this._debounce("quickPowerOn", 500)) {
      return;
    }

    if (this.isPowerOn && !this.isPowerVideoPlaying) {
      if (logger?.logAction) {
        logger.logAction("快速開機：系統已在執行中");
      }
      return;
    }

    if (this.isPowerVideoPlaying) {
      this._clearMediaArea();
    }

    if (logger?.logAction) {
      logger.logAction("快速開機完成");
    }

    // 快速開機：跳過或中斷開機影片
    this.isPowerOn = true;
    this.isPowerVideoPlaying = false;
    this._updatePowerKnobUI(false);

    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      this._clearMediaArea();
    }

    this.enableAllButtons();

    // 派送電源狀態變化，供 `action` 完成與同步使用。
    this.dispatchPowerStateChanged();

    if (buttonManager && flowManager?.isRunning) {
      buttonManager.updateMediaForCurrentAction();
    }

    if (flowManager?.isRunning) {
      return;
    }

    if (mediaManager) {
      setTimeout(() => {
        if (
          this.isPowerOn &&
          !this.isPowerVideoPlaying &&
          !flowManager?.isRunning
        ) {
          mediaManager.playHomePageLoop();
        }
      }, 150);
    }
  }

  /**
   * 派送電源狀態變化事件，並廣播到遠端（若已連接）
   * @private
   */
  dispatchPowerStateChanged() {
    const logger = this.panelLogger;
    const detail = {
      powerState: this.isPowerOn,
      isPowerVideoPlaying: this.isPowerVideoPlaying,
      timestamp: Date.now(),
    };

    const event = new CustomEvent("power_state_changed", { detail });
    document.dispatchEvent(event);
    if (logger?.logAction) {
      logger.logAction(
        "電源狀態變化",
        "power_change",
        null,
        false,
        false,
        false,
        null,
        detail,
      );
    }

    this.updateMediaAreaPowerIndicator();
    const syncClient = this.syncClient;
    const syncCore = this.experimentSyncCore;
    if (syncClient?.connected) {
      const broadcastPromise = syncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.POWER_STATE_UPDATE,
        clientId: syncClient?.clientId || "power_control",
        timestamp: Date.now(),
        powerState: this.isPowerOn,
        isPowerVideoPlaying: this.isPowerVideoPlaying,
      });

      if (broadcastPromise?.then) {
        broadcastPromise
          .then((result) => {
            Logger.debug(result ? "電源狀態已成功廣播" : "作為本機模式，電源狀態僅儲存本機");
          })
          .catch((error) => {
            Logger.warn("同步電源狀態失敗:", error);
          });
      }
    }
  }

  /**
   * 更新媒體區域電源狀態指標
   * @private
   */
  updateMediaAreaPowerIndicator() {
    const mediaArea = document.getElementById("mediaArea");
    if (!mediaArea) return;
    mediaArea.classList.toggle("power-off", !this.isPowerOn);
  }

  /**
   * 監聽遠端同步電源狀態事件
   * @param {object} data - 同步數據
   * @private
   */
  handleSyncPowerState(data) {
    try {
      if (typeof data?.powerState !== "boolean") {
        return;
      }
      this.isPowerOn = data.powerState;
      const isSessionRestore = data?._sessionRestore === true;
      // ================= 工作階段恢復時的動畫狀態處理 =================
      // 工作階段恢復時強制 isPowerVideoPlaying = false 的原因：
      // 1. 工作階段快照中的 isPowerVideoPlaying 不可靠（為瞬間狀態）
      // 2. 如果恢復時仍保留動畫狀態，可能會卡在「開機中」狀態
      // 3. 直接恢復為最終狀態（ON 或 OFF），避免重播開機動畫造成 UI 不一致
      //
      // 非工作階段恢復時保留原來的 isPowerVideoPlaying 值，用於同步遠端的動畫狀態
      this.isPowerVideoPlaying = !isSessionRestore && (data.isPowerVideoPlaying ?? false);

      this.updatePowerUIWithoutSync();

      const flowManager = this.experimentFlowManager;
      const mediaManager = this.panelMediaManager;
      if (flowManager?.isRunning) {
        this._refreshMediaAfterSyncRestore();
      } else if (mediaManager) {
        if (this.isPowerOn) {
          mediaManager.playHomePageLoop(true);
        } else {
          mediaManager.stopHomePageLoop();
          this._clearMediaArea();
        }
      }
    } catch (error) {
      Logger.error("處理電源狀態同步時發生錯誤:", error);
    }
  }

  /**
   * 更新電源 UI（不派送狀態變化事件）
   * 用於遠端同步時的 UI 更新
   * @private
   */
  updatePowerUIWithoutSync() {
    this._updatePowerKnobUI(false);
    this.updateMediaAreaPowerIndicator();
  }

}


export { PowerControl };
