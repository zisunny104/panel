/**
 * PowerControl - 電源控制管理器
 *
 * 負責電源狀態管理、UI更新和多裝置同步
 */
import {
  ACTION_IDS,
  POWER_BUTTON_STATES,
  SYNC_DATA_TYPES,
  SYNC_EVENTS,
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
    this.lastGreenLightClick = 0;
    this.lastQuickPowerOn = 0;
    this._suppressPowerActionCompletionUntil = 0;
    this.powerOnBtn = document.getElementById("powerOnBtn");
    this.powerOffBtn = document.getElementById("powerOffBtn");
    this.emergencyStopBtn = document.getElementById("emergencyStopBtn");
    this.quickPowerOnBtn = document.getElementById("quickPowerOnBtn");
    this.powerKnob = document.getElementById("powerKnob");
    this.powerLightOn = document.getElementById("powerLightOn");
    this.powerLightArea = document.getElementById("powerLightArea");
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

  setPowerSwitchHighlight(enable) {
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.toggle("next-step-highlight", enable);
    }

    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.toggle("next-step-highlight", enable);
    });
  }

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

  _handlePowerActionCompletion(detail) {
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

    // 僅在電源動作完成時回報同步
    if (
      (actionId === ACTION_IDS.POWER_ON && detail?.powerState) ||
      (actionId === ACTION_IDS.POWER_OFF && detail && detail.powerState === false)
    ) {
      if (actionHandler.completedActions?.has(actionId)) {
        return;
      }
      actionHandler.handleCorrectAction(actionId, {
        source: "power_state",
        powerState: detail?.powerState,
      });

      const syncCore = this.experimentSyncCore;
      const syncClient = this.syncClient;
      const systemManager = this.experimentSystemManager;
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
    }
  }

  /**
   * 若目前 action 為電源動作且狀態已符合，直接完成該 action
   */
  syncPowerActionWithState() {
    const actionHandler = this.experimentActionHandler;
    if (!actionHandler) return;

    const currentAction = actionHandler.getCurrentAction?.();
    const actionId = currentAction?.actionId || currentAction?.action_id || null;
    if (!actionId) return;

    if (actionId === ACTION_IDS.POWER_ON && this.isPowerOn) {
      actionHandler.handleCorrectAction(actionId, {
        source: "power_state",
        powerState: true,
      });
    }

    if (actionId === ACTION_IDS.POWER_OFF && !this.isPowerOn) {
      actionHandler.handleCorrectAction(actionId, {
        source: "power_state",
        powerState: false,
      });
    }
  }

  updatePowerUI() {
    const consoleLogger = Logger;
    const buttonManager = this.buttonManager;
    if (this.powerKnob) {
      this.powerKnob.style.transform = this.isPowerOn
        ? "translate(-50%,-50%) scale(0.95) rotate(90deg)"
        : "translate(-50%,-50%) scale(0.95) rotate(0deg)";
    }

    if (this.powerLightOn) {
      if (this.isPowerOn) {
        this.powerLightOn.classList.remove("is-hidden");
        consoleLogger.debug("電源燈號已亮起 (isPowerOn:", this.isPowerOn, ")");
      } else {
        this.powerLightOn.classList.add("is-hidden");
        consoleLogger.debug("電源燈號已熄滅 (isPowerOn:", this.isPowerOn, ")");
      }
    } else {
      consoleLogger.warn("powerLightOn 元素未找到");
    }

    this.updateMediaControlButtons();

    if (buttonManager) {
      buttonManager.updateExperimentButtonStyles();
      buttonManager.updateMediaForCurrentAction();
    }

    this.dispatchPowerStateChanged();
  }

  setPowerState(nextState, trigger) {
    const logger = this.panelLogger;
    const mediaManager = this.panelMediaManager;
    const buttonManager = this.buttonManager;
    const flowManager = this.experimentFlowManager;
    if (trigger === "sync") {
      // 避免同步觸發時重複回報 action 完成
      this._suppressPowerActionCompletionUntil = Date.now() + 800;
    }
    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
    });
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.remove("next-step-highlight");
    }

    if (nextState === false) {
      // 關機流程：停止媒體並重置狀態
      this.isPowerOn = false;
      this.isPowerVideoPlaying = false;

      if (mediaManager) {
        mediaManager.stopHomePageLoop();
        if (mediaManager.mediaArea) {
          mediaManager.mediaArea.innerHTML = "";
          mediaManager.mediaArea.classList.remove("loading");
        }
      }

      this.updatePowerUI();
      this.enableAllButtons();

      if (buttonManager) {
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          btn.classList.remove("next-step-highlight");
          btn.classList.remove("next-step-highlight-secondary");
          btn.classList.remove("next-step-highlight-shift");
        });
      }

      if (logger?.logAction) {
        const action = trigger === "knob" ? "旋轉開關關機" : "按鈕關機";
        logger.logAction(
          `${action}，所有影片已停止，媒體區已清空，按鈕狀態已重置`,
        );
      }

      if (flowManager?.isRunning) {
        flowManager.stopExperiment();
      }
      return;
    }

    if (this.isPowerVideoPlaying || this.isPowerOn === nextState) return;

    if (mediaManager) {
      mediaManager.stopHomePageLoop();
    }

    this.isPowerOn = nextState;
    this.isPowerVideoPlaying = true;
    this.updatePowerUI();

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
          if (mediaManager && mediaManager.mediaArea) {
            mediaManager.mediaArea.innerHTML = "";
          }
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

  setupEventListeners() {
    const logger = this.panelLogger;
    const bindQuickPowerTarget = ({
      element,
      requirePowerOn,
      missingMessage,
      title,
      zIndex,
      logMessage,
    }) => {
      if (!element) {
        Logger.debug(missingMessage);
        return;
      }

      const clickHandler = (e) => {
        // 防止重複點擊觸發快速開機
        if (this.lastGreenLightClick && Date.now() - this.lastGreenLightClick < 200) {
          return;
        }
        this.lastGreenLightClick = Date.now();

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
        if (this.isPowerOn || this.isPowerVideoPlaying) {
          this.setPowerState(false, "knob");
        } else {
          this.setPowerState(true, "knob");
        }
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
      this.emergencyStopBtn.addEventListener("click", () => {
        this.emergencyStop();
      });
    }

    if (this.quickPowerOnBtn) {
      this.quickPowerOnBtn.addEventListener("click", () => {
        this.quickPowerOn();
      });
    }

    bindQuickPowerTarget({
      element: this.powerLightOn,
      requirePowerOn: true,
      missingMessage: "找不到綠色燈號元素 (powerLightOn)",
      title: "點擊可快速開機（開機動畫進行中時）",
      zIndex: "1000",
      logMessage: () =>
        `綠色燈號點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying}, 電源:${this.isPowerOn})`,
    });

    bindQuickPowerTarget({
      element: this.powerLightArea,
      requirePowerOn: false,
      missingMessage: "找不到電源燈號區域元素 (powerLightArea)",
      title: "點擊可快速開機（開機動畫進行中時）",
      logMessage: () =>
        `電源燈號區域點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying})`,
    });

    this.setupSyncEventListeners();
  }

  setupSyncEventListeners() {
    document.addEventListener("syncPowerState", (e) => {
      this.handleSyncPowerState(e.detail);
    });

    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (e) => {
      if (!e.detail) return;
      const myId = this.syncClient?.clientId;
      if (myId && e.detail.clientId === myId) return;
      if (e.detail.powerState !== undefined) {
        this.applyRemotePowerState(e.detail);
      }
    });

    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });
  }

  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    const powerButtons = [
      this.powerOnBtn,
      this.powerOffBtn,
      this.emergencyStopBtn,
      this.quickPowerOnBtn,
    ];
    powerButtons.forEach((button) => {
      if (button) {
        if (isInteractive) button.classList.remove("is-hidden");
        else button.classList.add("is-hidden");
      }
    });

    if (this.powerKnob) {
      this.powerKnob.style.pointerEvents = isInteractive ? "auto" : "none";
    }
  }

  emergencyStop() {
    const mediaManager = this.panelMediaManager;
    const flowManager = this.experimentFlowManager;
    const logger = this.panelLogger;
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      if (mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
        mediaManager.mediaArea.classList.remove("loading");
      }
    }

    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    this.updatePowerUI();

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

  quickPowerOn() {
    const logger = this.panelLogger;
    const mediaManager = this.panelMediaManager;
    const flowManager = this.experimentFlowManager;
    const buttonManager = this.buttonManager;
    if (this.lastQuickPowerOn && Date.now() - this.lastQuickPowerOn < 500) {
      return;
    }
    this.lastQuickPowerOn = Date.now();

    if (this.isPowerOn && !this.isPowerVideoPlaying) {
      if (logger?.logAction) {
        logger.logAction("快速開機：系統已在執行中");
      }
      return;
    }

    if (this.isPowerVideoPlaying) {
      if (mediaManager && mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
      }

      if (logger?.logAction) {
        logger.logAction("快速開機完成");
      }
    } else {
      if (logger?.logAction) {
        logger.logAction("快速開機完成");
      }
    }

    // 快速開機：跳過或中斷開機影片
    this.isPowerOn = true;
    this.isPowerVideoPlaying = false;

    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      if (mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
        mediaManager.mediaArea.classList.remove("loading");
      }
    }

    this.enableAllButtons();

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

    this.broadcastPowerState();
  }

  updateMediaAreaPowerIndicator() {
    const mediaArea = document.getElementById("mediaArea");
    if (!mediaArea) return;

    if (this.isPowerOn) {
      mediaArea.classList.remove("power-off");
    } else {
      mediaArea.classList.add("power-off");
    }
  }

  broadcastPowerState() {
    const consoleLogger = Logger;
    const syncClient = this.syncClient;
    const syncCore = this.experimentSyncCore;
    const powerData = {
      powerState: this.isPowerOn,
      isPowerVideoPlaying: this.isPowerVideoPlaying,
      timestamp: Date.now(),
    };

    document.dispatchEvent(
      new CustomEvent("power_state_changed", {
        detail: powerData,
      }),
    );

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
            if (!result) {
              consoleLogger.debug("作為本機模式，電源狀態僅儲存本機");
            } else {
              consoleLogger.debug("電源狀態已成功廣播");
            }
          })
          .catch((error) => {
            consoleLogger.warn("同步電源狀態失敗:", error);
          });
      }
    }
  }

  handleSyncPowerState(data) {
    try {
      this.isPowerOn = data.powerState;
      this.isPowerVideoPlaying = data.isPowerVideoPlaying;

      this.updatePowerUIWithoutSync();
    } catch (error) {
      Logger.error("處理電源狀態同步時發生錯誤:", error);
    }
  }

  updatePowerUIWithoutSync() {
    const consoleLogger = Logger;
    const buttonManager = this.buttonManager;
    if (this.powerKnob) {
      this.powerKnob.style.transform = this.isPowerOn
        ? "translate(-50%,-50%) scale(0.95) rotate(90deg)"
        : "translate(-50%,-50%) scale(0.95) rotate(0deg)";
    }

    if (this.powerLightOn) {
      if (this.isPowerOn) {
        this.powerLightOn.classList.remove("is-hidden");
        consoleLogger.debug(
          "電源燈號已亮起 (updatePowerUIWithoutSync, isPowerOn:",
          this.isPowerOn,
          ")",
        );
      } else {
        this.powerLightOn.classList.add("is-hidden");
        consoleLogger.debug(
          "電源燈號已熄滅 (updatePowerUIWithoutSync, isPowerOn:",
          this.isPowerOn,
          ")",
        );
      }
    } else {
      consoleLogger.warn("powerLightOn 元素未找到 (updatePowerUIWithoutSync)");
    }

    this.updateMediaControlButtons();

    if (buttonManager) {
      buttonManager.updateExperimentButtonStyles();
      buttonManager.updateMediaForCurrentAction();
    }
  }

  applyRemotePowerState(state) {
    const consoleLogger = Logger;
    const mediaManager = this.panelMediaManager;
    const buttonManager = this.buttonManager;
    const logger = this.panelLogger;
    const oldPowerState = this.isPowerOn;
    const oldVideoPlaying = this.isPowerVideoPlaying;

    this.isPowerOn = state.powerState;
    // 遠端同步不重播動畫
    this.isPowerVideoPlaying = false;

    if (
      oldPowerState !== this.isPowerOn ||
      oldVideoPlaying !== this.isPowerVideoPlaying
    ) {
      consoleLogger.debug(
        `套用遠端電源狀態: ${oldPowerState} -> ${this.isPowerOn}`,
      );

      this.updatePowerUIWithoutSync();

      if (oldVideoPlaying) {
        if (mediaManager) {
          mediaManager.stopHomePageLoop();
          if (mediaManager.mediaArea) {
            mediaManager.mediaArea.innerHTML = "";
            mediaManager.mediaArea.classList.remove("loading");
          }
        }
      }

      if (buttonManager) {
        buttonManager.updateMediaForCurrentAction();
      }

      if (logger?.logAction) {
        logger.logAction(
          `[遠端同步] 電源狀態已更新為: ${this.isPowerOn ? "開啟" : "關閉"}`,
          "power_sync",
          null,
          false,
          false,
          false,
          null,
          { oldState: oldPowerState, newState: this.isPowerOn },
        );
      }
    }
  }
}

// ES6 模組匯出
export default PowerControl;
export { PowerControl };
