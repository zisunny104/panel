/**
 * PowerControl - 電源控制管理器
 *
 * 負責電源狀態管理、UI更新和多裝置同步
 */
import { ACTION_IDS, SYNC_DATA_TYPES, SYNC_EVENTS } from "../constants/index.js";
import { Logger } from "../core/console-manager.js";

class PowerControl {
  /**
   * 建構子 - 初始化電源控制管理器
   */
  constructor({
    logger = Logger,
    panelLogger = null,
    experimentActionHandler = null,
    experimentFlowManager = null,
    experimentSyncCore = null,
    syncClient = null,
    buttonManager = null,
    panelMediaManager = null,
  } = {}) {
    this.logger = logger;
    this.panelLogger = panelLogger;
    this.experimentActionHandler = experimentActionHandler;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentSyncCore = experimentSyncCore;
    this.syncClient = syncClient;
    this.buttonManager = buttonManager;
    this.panelMediaManager = panelMediaManager;
    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    this.lastGreenLightClick = 0; // 防止重複點擊的時間戳
    this.lastQuickPowerOn = 0; // 防止重複快速開機的時間戳
    this._suppressPowerActionCompletionUntil = 0;
    this.powerOnBtn = document.getElementById("powerOnBtn");
    this.powerOffBtn = document.getElementById("powerOffBtn");
    this.emergencyStopBtn = document.getElementById("emergencyStopBtn");
    this.quickPowerOnBtn = document.getElementById("quickPowerOnBtn");
    this.powerKnob = document.getElementById("powerKnob");
    this.powerLightOn = document.getElementById("powerLightOn");
    this.powerLightArea = document.getElementById("powerLightArea");
    this.setupEventListeners();
    document.addEventListener("power_state_changed", (event) => {
      this._handlePowerActionCompletion(event.detail);
    });
    this.updatePowerUIWithoutSync(); // 初始化時不觸發同步事件
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  _getConsoleLogger() {
    return this.logger || Logger;
  }

  _getPanelLogger() {
    return this.panelLogger;
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

  _getButtonManager() {
    return this.buttonManager;
  }

  _getMediaManager() {
    return this.panelMediaManager;
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

    this._getConsoleLogger().debug("Power: 已高亮電源開關，提示關機");
    return true;
  }

  _handlePowerActionCompletion(detail) {
    const actionHandler = this._getActionHandler();
    const flowManager = this._getFlowManager();
    if (!actionHandler) return;
    if (!flowManager?.isRunning) return;

    if (Date.now() < this._suppressPowerActionCompletionUntil) {
      return;
    }

    const currentAction = actionHandler.getCurrentAction?.();
    const actionId =
      currentAction?.actionId || currentAction?.action_id || null;
    if (!actionId) return;

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

      const syncCore = this._getSyncCore();
      const syncClient = this._getSyncClient();
      syncCore?.safeBroadcast?.({
        type: SYNC_DATA_TYPES.ACTION_COMPLETED,
        clientId: syncClient?.clientId || "power_control",
        timestamp: Date.now(),
        actionId,
        powerState: detail?.powerState,
      }).catch((error) => {
        this._getConsoleLogger().warn("同步電源 action 完成失敗:", error);
      });
    }
  }

  /**
   * 更新電源 UI 狀態
   */
  updatePowerUI() {
    const consoleLogger = this._getConsoleLogger();
    const buttonManager = this._getButtonManager();
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

  /**
   * 設定電源狀態並處理 UI/媒體
   * @param {boolean} nextState - 新的電源狀態
   * @param {string} trigger - 觸發來源
   */
  setPowerState(nextState, trigger) {
    const logger = this._getPanelLogger();
    const mediaManager = this._getMediaManager();
    const buttonManager = this._getButtonManager();
    const flowManager = this._getFlowManager();
    if (trigger === "sync") {
      this._suppressPowerActionCompletionUntil = Date.now() + 800;
    }
    // 立即取消電源開關的高亮效果（按鈕被按下時）
    document.querySelectorAll(".media-power-btn").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
    });
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.remove("next-step-highlight");
    }

    // 如果要關機，無論目前狀態如何都應該執行（包括開機動畫進行中）
    if (nextState === false) {
      // 強制關機處理
      this.isPowerOn = false;
      this.isPowerVideoPlaying = false;

      // 停止所有媒體並清空媒體區域
      if (mediaManager) {
        mediaManager.stopHomePageLoop();
        // 確保停止所有媒體播放，避免載入失敗訊息
        if (mediaManager.mediaArea) {
          mediaManager.mediaArea.innerHTML = "";
          // 移除任何可能的載入中狀態
          mediaManager.mediaArea.classList.remove("loading");
        }
      }

      this.updatePowerUI();
      this.enableAllButtons();

      // 電源關閉時清除所有按鈕高亮
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

      // 通知實驗管理器電源由開轉關
      if (flowManager?.isRunning) {
        flowManager.stopExperiment();
      }
      return;
    }

    // 開機邏輯：如果已經在開機或開機動畫播放中，則忽略
    if (this.isPowerVideoPlaying || this.isPowerOn === nextState) return;

    // 停止首頁循環
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
    }

    this.isPowerOn = nextState;
    // 【重要】先設置 isPowerVideoPlaying，然後再調用 updatePowerUI()
    // 這樣 updatePowerUI() 中的 updateMediaForCurrentAction() 才能正確抑制按鈕高亮
    this.isPowerVideoPlaying = true;
    this.updatePowerUI();

    // 開機處理（nextState 必定為 true，因為關機已在上面處理）
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

          // 先重置動畫狀態，再更新媒體與高亮，避免被抑制邏輯擋下
          this.isPowerVideoPlaying = false;

          // 開機後更新按鈕高亮與媒體
          if (buttonManager) {
            buttonManager.updateExperimentButtonStyles();
            buttonManager.updateMediaForCurrentAction();
          }

          // 【待驗證】實驗模式開機後，自動開始第一個action
          // 注意：此函數會重複呼叫 updateMediaForCurrentAction()（已在上方呼叫過）
          // 若無其他作用，待確認後可移除
          // if (window.buttonManager && window.experimentFlowManager?.isRunning) {
          //   this.handleExperimentPowerOnAutoStart();
          // }
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
   * 啟用所有按鈕
   */
  enableAllButtons() {
    const buttonManager = this._getButtonManager();
    const flowManager = this._getFlowManager();
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    buttonOverlays.forEach((btn) => btn.classList.remove("disabled"));

    // 根據目前電源狀態設定媒體控制按鈕的可用性
    this.updateMediaControlButtons();

    // 如果實驗正在進行中，重新更新按鈕高亮效果
    if (buttonManager && flowManager?.isRunning) {
      // 使用 setTimeout 確保 DOM 更新完成後再執行
      setTimeout(() => {
        buttonManager.updateExperimentButtonStyles();
      }, 10);
    }
  }

  /**
   * 停用所有按鈕
   */
  disableAllButtons() {
    // 如果正在等待開機，不要新增 disabled 類，讓 temporarily-disabled 樣式生效
    const isWaitingForPowerOn = false; // 新架構不使用 waitingForPowerOn 機制
    if (!isWaitingForPowerOn) {
      const buttonOverlays = document.querySelectorAll(".button-overlay");
      buttonOverlays.forEach((btn) => btn.classList.add("disabled"));
    }

    // 開機動畫播放期間的按鈕狀態
    if (this.powerOnBtn) this.powerOnBtn.disabled = true;
    if (this.powerOffBtn) this.powerOffBtn.disabled = true;
    if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = false; // 快速開機在動畫播放中應該可用
    if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = false; // 緊急停止在動畫播放中應該可用
  }

  /**
   * 更新媒體控制按鈕的可用性
   */
  updateMediaControlButtons() {
    if (this.isPowerVideoPlaying) {
      // 開機動畫播放中：開機按鈕停用，快速開機啟用（可跳過動畫），關機和緊急停止可用
      if (this.powerOnBtn) this.powerOnBtn.disabled = true;
      if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = false; // 啟用，可以跳過動畫
      if (this.powerOffBtn) this.powerOffBtn.disabled = true;
      if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = false;
    } else if (this.isPowerOn) {
      // 已開機狀態：開機相關按鈕停用，關機和緊急停止可用
      if (this.powerOnBtn) this.powerOnBtn.disabled = true;
      if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = true;
      if (this.powerOffBtn) this.powerOffBtn.disabled = false;
      if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = false;
    } else {
      // 關機狀態：開機相關按鈕可用，關機和緊急停止按鈕停用（沒有東西需要停止）
      if (this.powerOnBtn) this.powerOnBtn.disabled = false;
      if (this.quickPowerOnBtn) this.quickPowerOnBtn.disabled = false;
      if (this.powerOffBtn) this.powerOffBtn.disabled = true;
      if (this.emergencyStopBtn) this.emergencyStopBtn.disabled = true; // 關機時停用緊急停止
    }
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    const logger = this._getPanelLogger();
    // 電源旋鈕點擊
    if (this.powerKnob) {
      this.powerKnob.addEventListener("click", () => {
        // 如果要關機，無論什麼狀態都允許
        if (this.isPowerOn || this.isPowerVideoPlaying) {
          this.setPowerState(false, "knob");
        } else {
          // 只有在完全關機狀態下才能開機
          this.setPowerState(true, "knob");
        }
      });
    }

    // 開機按鈕
    if (this.powerOnBtn) {
      this.powerOnBtn.addEventListener("click", () => {
        if (!this.isPowerVideoPlaying && !this.isPowerOn) {
          this.setPowerState(true, "panel");
        }
      });
    }

    // 關機按鈕
    if (this.powerOffBtn) {
      this.powerOffBtn.addEventListener("click", () => {
        // 關機按鈕應該在任何時候都能工作（包括開機動畫播放中）
        if (this.isPowerOn || this.isPowerVideoPlaying) {
          this.setPowerState(false, "panel");
        }
      });
    }

    // 緊急停止按鈕
    if (this.emergencyStopBtn) {
      this.emergencyStopBtn.addEventListener("click", () => {
        this.emergencyStop();
      });
    }

    // 快速開機按鈕
    if (this.quickPowerOnBtn) {
      this.quickPowerOnBtn.addEventListener("click", () => {
        this.quickPowerOn();
      });
    }

    // 綠色燈號點擊快速開機
    if (this.powerLightOn) {
      // 防重複點擊的處理器
      const greenLightClickHandler = (e) => {
        // 防止同一個物理點擊觸發多次（200ms 防抖）
        if (
          this.lastGreenLightClick &&
          Date.now() - this.lastGreenLightClick < 200
        ) {
          return;
        }
        this.lastGreenLightClick = Date.now();

        e.preventDefault();
        e.stopPropagation();

        // 開機動畫播放中且電源已開啟時才允許快速開機（跳過動畫）
        if (this.isPowerVideoPlaying && this.isPowerOn) {
          this.quickPowerOn();
        } else {
          if (logger?.logAction) {
            logger.logAction(
              `綠色燈號點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying}, 電源:${this.isPowerOn})`,
            );
          }
        }
      };

      // 只綁定一個 click 事件，避免重複觸發
      this.powerLightOn.addEventListener(
        "click",
        greenLightClickHandler,
        false,
      );

      // 確保元素可以接收點擊事件
      this.powerLightOn.style.cursor = "pointer";
      this.powerLightOn.style.pointerEvents = "auto";
      this.powerLightOn.style.userSelect = "none";
      this.powerLightOn.style.zIndex = "1000";
      this.powerLightOn.title = "點擊可快速開機（開機動畫進行中時）";
    } else {
      this._getConsoleLogger().debug("找不到綠色燈號元素 (powerLightOn)");
    }

    // 電源燈號區域點擊快速開機（擴展點擊區域）
    if (this.powerLightArea) {
      const powerLightAreaClickHandler = (e) => {
        // 防止同一個物理點擊觸發多次（200ms 防抖）
        if (
          this.lastGreenLightClick &&
          Date.now() - this.lastGreenLightClick < 200
        ) {
          return;
        }
        this.lastGreenLightClick = Date.now();

        e.preventDefault();
        e.stopPropagation();

        // 開機動畫播放中時才允許快速開機（跳過動畫）
        if (this.isPowerVideoPlaying) {
          this.quickPowerOn();
        } else {
          if (logger?.logAction) {
            logger.logAction(
              `電源燈號區域點擊 - 目前狀態不符合快速開機條件 (播放中:${this.isPowerVideoPlaying})`,
            );
          }
        }
      };

      // 為電源燈號區域新增點擊事件
      this.powerLightArea.addEventListener(
        "click",
        powerLightAreaClickHandler,
        false,
      );

      // 確保元素可以接收點擊事件
      this.powerLightArea.style.cursor = "pointer";
      this.powerLightArea.style.pointerEvents = "auto";
      this.powerLightArea.style.userSelect = "none";
      this.powerLightArea.title = "點擊可快速開機（開機動畫進行中時）";
    } else {
      this._getConsoleLogger().debug("找不到電源燈號區域元素 (powerLightArea)");
    }

    // 設定同步事件監聽器
    this.setupSyncEventListeners();
  }

  /**
   * 設定同步事件監聽器
   */
  setupSyncEventListeners() {
    // 監聽來自其他裝置的電源狀態同步（廣播事件）
    document.addEventListener("syncPowerState", (e) => {
      this.handleSyncPowerState(e.detail);
    });

    // 監聽來自輪詢機制的全域狀態更新（從 sync-client.js 的 triggerStateUpdate 觸發）
      window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (e) => {
      if (!e.detail) return;
      // 防止自我回聲
      const myId = this._getSyncClient()?.clientId;
      if (myId && e.detail.clientId === myId) return;
      if (e.detail.powerState !== undefined) {
        this.applyRemotePowerState(e.detail);
      }
    });

    // 監聽裝置模式變更
    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });
  }

  /**
   * 處理裝置模式變更
   * @param {Object} data - 裝置模式數據
   * @param {boolean} data.isInteractive - 是否為互動模式
   */
  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    // 根據模式顯示/隱藏電源控制按鈕
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

    // 電源旋鈕在觀看模式下停用點擊
    if (this.powerKnob) {
      this.powerKnob.style.pointerEvents = isInteractive ? "auto" : "none";
    }
  }

  /**
   * 緊急停止功能
   */
  emergencyStop() {
    const mediaManager = this._getMediaManager();
    const flowManager = this._getFlowManager();
    const logger = this._getPanelLogger();
    // 立即停止所有媒體播放
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      // 緊急停止時，媒體區塊應該完全清空，不顯示任何內容
      if (mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
        // 移除任何可能的載入中狀態，避免載入失敗訊息
        mediaManager.mediaArea.classList.remove("loading");
      }
    }

    // 強制關機並重置開機動畫狀態
    this.isPowerOn = false;
    this.isPowerVideoPlaying = false;
    this.updatePowerUI();

    // 重新啟用所有按鈕（如果開機動畫進行中被停用的話）
    this.enableAllButtons();

    // 停止實驗
    if (flowManager?.isRunning) {
      flowManager.stopExperiment();
    }

    // 記錄日誌
    if (logger?.logAction) {
      logger.logAction(
        "緊急停止已啟動，所有系統已停止，媒體區已清空，按鈕狀態已重置",
      );
    }
  }

  /**
   * 快速開機功能
   */
  quickPowerOn() {
    const logger = this._getPanelLogger();
    const mediaManager = this._getMediaManager();
    const flowManager = this._getFlowManager();
    const buttonManager = this._getButtonManager();
    // 防止短時間內重複執行快速開機
    if (this.lastQuickPowerOn && Date.now() - this.lastQuickPowerOn < 500) {
      return;
    }
    this.lastQuickPowerOn = Date.now();

    // 如果已經完全開機，無需再次開機
    if (this.isPowerOn && !this.isPowerVideoPlaying) {
      if (logger?.logAction) {
        logger.logAction("快速開機：系統已在執行中");
      }
      return;
    }

    // 如果開機動畫正在播放，停止動畫並直接跳到開機完成狀態
    if (this.isPowerVideoPlaying) {
      // 停止目前播放的開機影片
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

    // 快速開機（跳過開機影片或中斷正在播放的開機影片）
    this.isPowerOn = true;
    this.isPowerVideoPlaying = false;

    // 先停止所有媒體，確保狀態乾淨
    if (mediaManager) {
      mediaManager.stopHomePageLoop();
      if (mediaManager.mediaArea) {
        mediaManager.mediaArea.innerHTML = "";
        // 移除任何載入狀態
        mediaManager.mediaArea.classList.remove("loading");
      }
    }

    this.enableAllButtons();

    // 通知實驗管理器電源狀態變化（如有需要）
    if (buttonManager && flowManager?.isRunning) {
      buttonManager.updateMediaForCurrentAction();
    }

    // 如果在實驗中，讓實驗管理器處理媒體播放
    if (flowManager?.isRunning) {
      // 實驗中的媒體播放由實驗管理器控制
      return;
    }

    // 立即播放首頁循環（非實驗模式）
    if (mediaManager) {
      // 延遲播放首頁循環，確保狀態完全清理
      setTimeout(() => {
        // 再次確認系統還是開機狀態且不在實驗中才播放
        if (
          this.isPowerOn &&
          !this.isPowerVideoPlaying &&
          !flowManager?.isRunning
        ) {
          mediaManager.playHomePageLoop();
        }
      }, 150); // 增加延遲時間
    }
  }

  /**
   * 觸發電源狀態變化事件（用於多客戶端同步）
   */
  dispatchPowerStateChanged() {
    const logger = this._getPanelLogger();
    const detail = {
      powerState: this.isPowerOn,
      isPowerVideoPlaying: this.isPowerVideoPlaying,
      timestamp: Date.now(),
    };

    // 觸發自定義事件
    const event = new CustomEvent("power_state_changed", { detail });
    document.dispatchEvent(event);

    // 同時記錄到日誌
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

    // 更新媒體區塊的開機狀態顏色指示
    this.updateMediaAreaPowerIndicator();

    // 廣播電源狀態變更
    this.broadcastPowerState();
  }

  /**
   * 根據開機狀態更新媒體區塊的視覺提示外框顏色
   */
  updateMediaAreaPowerIndicator() {
    const mediaArea = document.getElementById("mediaArea");
    if (!mediaArea) return;

    if (this.isPowerOn) {
      // 開機：移除 power-off 類別，顯示亮綠色
      mediaArea.classList.remove("power-off");
    } else {
      // 關機：新增 power-off 類別，顯示墨綠色
      mediaArea.classList.add("power-off");
    }
  }

  /** 廣播電源狀態變更 */
  broadcastPowerState() {
    const consoleLogger = this._getConsoleLogger();
    const syncClient = this._getSyncClient();
    const syncCore = this._getSyncCore();
    const powerData = {
      powerState: this.isPowerOn,
      isPowerVideoPlaying: this.isPowerVideoPlaying,
      timestamp: Date.now(),
    };

    // 本機廣播事件
    document.dispatchEvent(
      new CustomEvent("power_state_changed", {
        detail: powerData,
      }),
    );

    // 向其他端點同步狀態
      if (syncClient?.connected) {
        syncCore?.safeBroadcast?.({
          type: SYNC_DATA_TYPES.POWER_STATE_UPDATE,
        clientId: syncClient?.clientId || "power_control",
        timestamp: Date.now(),
        powerState: this.isPowerOn,
        isPowerVideoPlaying: this.isPowerVideoPlaying,
      }).catch((error) => {
        consoleLogger.warn("同步電源狀態失敗:", error);
      });

      if (!syncResult) {
        consoleLogger.debug("作為本機模式，電源狀態僅儲存本機");
      } else {
        consoleLogger.debug("電源狀態已成功廣播");
      }
    }
  }

  /** 處理電源狀態同步 */
  handleSyncPowerState(data) {
    // 所有角色都應該接收同步狀態
    // operator 可以操作也可以接收遠端狀態更新
    // viewer 只能接收，不能操作

    try {
      // 同步電源狀態但不觸發新的廣播
      const _oldState = this.isPowerOn;
      this.isPowerOn = data.powerState;
      this.isPowerVideoPlaying = data.isPowerVideoPlaying;

      // 更新UI但不觸發事件
      this.updatePowerUIWithoutSync();
    } catch (error) {
      this._getConsoleLogger().error("處理電源狀態同步時發生錯誤:", error);
    }
  }

  /** 更新UI但不觸發同步事件 */
  updatePowerUIWithoutSync() {
    const consoleLogger = this._getConsoleLogger();
    const buttonManager = this._getButtonManager();
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

  /** 套用遠端電源狀態（來自 sync_state_update 事件） */
  applyRemotePowerState(state) {
    const consoleLogger = this._getConsoleLogger();
    const mediaManager = this._getMediaManager();
    const buttonManager = this._getButtonManager();
    const logger = this._getPanelLogger();
    // 所有角色都應該接收並套用遠端狀態
    // 這確保多裝置間的狀態一致性

    const oldPowerState = this.isPowerOn;
    const oldVideoPlaying = this.isPowerVideoPlaying;

    // 只需更新核心狀態，不播放動畫
    this.isPowerOn = state.powerState;
    // 遠端狀態中的 isPowerVideoPlaying 通常不需要同步（動畫已在遠端完成）
    this.isPowerVideoPlaying = false;

    // 如果狀態有變化，才更新UI
    if (
      oldPowerState !== this.isPowerOn ||
      oldVideoPlaying !== this.isPowerVideoPlaying
    ) {
      consoleLogger.debug(
        `套用遠端電源狀態: ${oldPowerState} -> ${this.isPowerOn}`,
      );

      // 更新UI但不觸發廣播事件
      this.updatePowerUIWithoutSync();

      // 停止所有媒體（如果本機有播放中的媒體）
      if (oldVideoPlaying) {
        if (mediaManager) {
          mediaManager.stopHomePageLoop();
          if (mediaManager.mediaArea) {
            mediaManager.mediaArea.innerHTML = "";
            mediaManager.mediaArea.classList.remove("loading");
          }
        }
      }

      // 通知實驗管理器電源狀態變化
      if (buttonManager) {
        buttonManager.updateMediaForCurrentAction();
      }

      // 記錄同步事件
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

  // 處理實驗模式開機後的自動開始邏輯
  handleExperimentPowerOnAutoStart() {
    const flowManager = this._getFlowManager();
    const buttonManager = this._getButtonManager();
    // 確保在實驗模式且電源已開啟
    if (!flowManager?.isRunning || !this.isPowerOn) {
      return;
    }

    // 更新按鈕高亮狀態以反映目前動作
    if (buttonManager) {
      buttonManager.updateMediaForCurrentAction();
    }
  }
}

// ES6 模組匯出
export default PowerControl;
export { PowerControl };
