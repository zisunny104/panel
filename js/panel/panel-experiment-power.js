/**
 * PanelExperimentPower - 面板實驗電源管理器
 *
 * 負責電源開關控制、電源狀態監控、電源流程處理等電源相關功能
 * 專門處理實驗過程中電源的開啟、關閉和狀態管理邏輯
 */
class PanelExperimentPower {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
  }

  /**
   * 處理電源開啟
   */
  handlePowerOn() {
    Logger.debug("處理電源開啟事件");

    // 檢查是否正在等待開機
    if (this.manager.waitingForPowerOn) {
      Logger.info("電源已開啟，繼續實驗流程");

      // 清除等待狀態
      this.manager.waitingForPowerOn = false;

      // 取消電源開關高亮
      this.manager.highlightPowerSwitch(false);

      // 繼續載入單元並開始
      this.manager.loadUnitsAndStart();

      // 更新按鈕顏色
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("running");
      }

      // 記錄日誌
      if (window.logger) {
        window.logger.logAction(
          "電源已開啟，繼續實驗",
          null,
          null,
          false,
          false,
        );
      }

      this.manager.dispatchExperimentStateChanged();
    }
  }

  /**
   * 處理電源關閉
   */
  handlePowerOff() {
    Logger.debug("處理電源關閉事件");

    // 檢查是否正在等待關機
    if (this.manager.waitingForPowerOff) {
      Logger.info("電源已關閉，結束實驗");

      // 清除等待狀態
      this.manager.waitingForPowerOff = false;

      // 取消電源開關高亮
      this.manager.highlightPowerSwitch(false);

      // 最終化實驗
      this.manager.flow.finalizeExperiment();

      // 記錄日誌
      if (window.logger) {
        window.logger.logAction(
          "電源已關閉，實驗結束",
          null,
          null,
          false,
          false,
        );
      }
    }
  }

  /**
   * 高亮電源開關
   */
  highlightPowerSwitch(highlight) {
    // 使用正確的選擇器匹配電源按鈕
    const powerButtons = document.querySelectorAll(".media-power-btn");
    powerButtons.forEach((button) => {
      if (highlight) {
        button.classList.add("next-step-highlight");
        Logger.debug("電源按鈕已高亮");
      } else {
        button.classList.remove("next-step-highlight");
        Logger.debug("電源按鈕高亮已取消");
      }
    });
  }

  /**
   * 檢查電源狀態
   */
  checkPowerState() {
    if (!window.powerControl) {
      Logger.warn("powerControl 未初始化");
      return false;
    }

    const isPowerOn = window.powerControl.isPowerOn;
    Logger.debug(`電源狀態: ${isPowerOn ? "開啟" : "關閉"}`);
    return isPowerOn;
  }

  /**
   * 設定電源狀態
   */
  setPowerState(powerOn, reason = "") {
    if (!window.powerControl) {
      Logger.warn("powerControl 未初始化");
      return;
    }

    Logger.debug(`${powerOn ? "開啟" : "關閉"}電源: ${reason}`);
    window.powerControl.setPowerState(powerOn, reason);

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `${powerOn ? "開啟" : "關閉"}電源`,
        "power_control",
        null,
        false,
        false,
        false,
        null,
        { reason },
      );
    }
  }

  /**
   * 處理電源狀態變化
   */
  handlePowerStateChange(isPowerOn) {
    Logger.debug(`電源狀態變化: ${isPowerOn ? "開啟" : "關閉"}`);

    if (isPowerOn) {
      this.handlePowerOn();
    } else {
      this.handlePowerOff();
    }

    // 廣播電源狀態變化
    this.broadcastPowerStateChange(isPowerOn);
  }

  /**
   * 廣播電源狀態變化
   */
  broadcastPowerStateChange(isPowerOn) {
    if (window.syncManager?.core?.isConnected?.()) {
      const powerStateData = {
        type: window.SyncDataTypes.POWER_STATE_CHANGED,
        source: "panel",
        clientId: this.manager.clientId,
        is_power_on: isPowerOn,
        timestamp: new Date().toISOString(),
      };

      window.syncManager.core.syncState(powerStateData).catch((error) => {
        Logger.warn("同步電源狀態失敗:", error);
      });
    }
  }

  /**
   * 處理遠端電源狀態變化
   */
  handleRemotePowerStateChange(data) {
    Logger.debug(`收到遠端電源狀態變化: ${data.is_power_on ? "開啟" : "關閉"}`);

    // 更新本地電源控制（如果存在）
    if (window.powerControl) {
      window.powerControl.setPowerState(data.is_power_on, "遠端同步");
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `遠端電源${data.is_power_on ? "開啟" : "關閉"}`,
        "remote_power_change",
        null,
        false,
        false,
      );
    }
  }

  /**
   * 檢查是否需要電源控制
   */
  requiresPowerControl() {
    return this.manager.includeStartup || this.manager.includeShutdown;
  }

  /**
   * 取得電源控制狀態
   */
  getPowerControlStatus() {
    return {
      includeStartup: this.manager.includeStartup,
      includeShutdown: this.manager.includeShutdown,
      waitingForPowerOn: this.manager.waitingForPowerOn,
      waitingForPowerOff: this.manager.waitingForPowerOff,
      isPowerOn: this.checkPowerState(),
    };
  }

  /**
   * 重置電源控制狀態
   */
  resetPowerControlState() {
    this.manager.waitingForPowerOn = false;
    this.manager.waitingForPowerOff = false;
    this.highlightPowerSwitch(false);

    Logger.debug("電源控制狀態已重置");
  }

  /**
   * 高亮電源開關
   */
  highlightPowerSwitch(enable) {
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    // 遵守用戶設定來啟用視覺提示
    const showTouchVisuals =
      localStorage.getItem("showTouchVisuals") !== "false";

    // 只在視覺提示啟用時才輸出調試日誌
    if (showTouchVisuals) {
      Logger.debug(
        `highlightPowerSwitch(${enable}): powerSwitchArea=${
          powerSwitchArea ? "找到" : "未找到"
        }`,
      );
    }

    if (powerSwitchArea) {
      if (showTouchVisuals) {
        Logger.debug(
          `   目前 display=${powerSwitchArea.style.display}, visibility=${powerSwitchArea.style.visibility}`,
        );
      }

      if (enable) {
        // 遵守用戶設定來啟用視覺提示
        if (
          showTouchVisuals &&
          !document.body.classList.contains("visual-hints-enabled")
        ) {
          document.body.classList.add("visual-hints-enabled");
        }

        // 實驗進行中，無條件高亮電源按鈕
        if (!powerSwitchArea.classList.contains("next-step-highlight")) {
          powerSwitchArea.classList.add("next-step-highlight");
        }
      } else {
        // 檢查是否已移除，避免重複移除
        if (powerSwitchArea.classList.contains("next-step-highlight")) {
          powerSwitchArea.classList.remove("next-step-highlight");
        }
      }
    } else if (showTouchVisuals) {
      Logger.debug("無法找到 powerSwitchArea 元素！");
    }
  }

  /**
   * 設定電源選項
   */
  setPowerOptions(includeStartup, includeShutdown) {
    this.manager.includeStartup = includeStartup;
    this.manager.includeShutdown = includeShutdown;

    // 更新UI
    const startupCheckbox = this.manager.getCachedElement("includeStartup");
    const shutdownCheckbox = this.manager.getCachedElement("includeShutdown");

    if (startupCheckbox) {
      startupCheckbox.checked = includeStartup;
    }

    if (shutdownCheckbox) {
      shutdownCheckbox.checked = includeShutdown;
    }

    Logger.debug(
      `電源選項已更新: 開機=${includeStartup}, 關機=${includeShutdown}`,
    );
  }

  /** 處理電源狀態變化 */
  onPowerStateChanged(isPowerOn) {
    if (this.manager.waitingForPowerOn && isPowerOn) {
      // 等待開機完成 - 電源打開時立即移除電源按鈕高亮
      Logger.debug("電源打開，開機動畫播放中，移除電源按鈕高亮");
      this.manager.waitingForPowerOn = false;
      this.manager.highlightPowerSwitch(false);

      if (window.logger) {
        window.logger.logAction("開機完成", null, null, false, false);
      }
      // 設定按鈕顏色為執行中
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("running");
      } else {
        Logger.error(
          "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義",
        );
      }

      // 電源打開後，直接載入資料並顯示第一個動作的按鈕高亮
      Logger.debug("電源已打開，準備載入單元資料和顯示按鈕高亮");

      //此時才初始化動作序列和顯示第一個按鈕高亮
      if (!window.actionManager?.isInitialized) {
        Logger.debug("打開電源後，開始載入單元資料和初始化動作序列");
        // 等待 loadUnitsAndStart 完成後再執行 nextStep
        this.manager.loadUnitsAndStart().then(() => {
          // 根據設定面板的開關更新視覺提示
          if (this.manager.ui) {
            this.manager.ui.updateHighlightVisibility();
          }

          // 開始執行第一個步驟
          setTimeout(() => {
            if (this.manager.flow?.nextStep) {
              this.manager.flow.nextStep();
            }
          }, 100);
        });
      } else {
        // 已經初始化過，只更新按鈕高亮
        if (window.buttonManager) {
          Logger.debug("更新按鈕高亮");
          window.buttonManager.updateMediaForCurrentAction();
        }

        // 根據設定面板的開關更新視覺提示
        if (this.manager.ui) {
          this.manager.ui.updateHighlightVisibility();
        }
      }

      //多螢幕同步：電源打開後廣播實驗狀態到其他裝置
      Logger.debug("電源打開後，廣播實驗初始化到其他裝置");

      //現在才廣播實驗初始化，此時按鈕高亮已準備好，experiment.html 也可以自動啟動
      this.manager.broadcastExperimentInitialization();

      this.manager.dispatchExperimentStateChanged();

      // 實驗開始後自動關閉實驗面板（延遲確保所有初始化完成）
      setTimeout(() => {
        this.manager.closeExperimentPanel();
      }, 1000);
    } else if (this.manager.waitingForPowerOff && !isPowerOn) {
      // 等待關機完成
      this.manager.waitingForPowerOff = false;
      this.manager.highlightPowerSwitch(false);
      if (window.logger) {
        window.logger.logAction("關機完成，實驗結束", null, null, false, false);
      }
      // 電源關閉時清除所有按鈕高亮
      if (window.buttonManager) {
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          btn.classList.remove("next-step-highlight");
          btn.classList.remove("next-step-highlight-secondary");
          btn.classList.remove("next-step-highlight-shift");
        });
      }
      // 更新按鈕狀態（電源已關閉）
      if (window.buttonManager) {
        window.buttonManager.updateMediaForCurrentAction();
      }
      // 結束實驗
      this.manager.finishExperiment();
    } else if (
      this.manager.isExperimentRunning &&
      !isPowerOn &&
      !this.manager.waitingForPowerOff
    ) {
      //實驗進行中，電源關閉 → 立即結束實驗
      Logger.debug("實驗進行中偵測到電源關閉，立即結束實驗");
      if (window.logger) {
        window.logger.logAction(
          "異常關機，實驗被迫結束",
          null,
          null,
          false,
          false,
        );
      }
      // 電源關閉時清除所有按鈕高亮
      if (window.buttonManager) {
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          btn.classList.remove("next-step-highlight");
          btn.classList.remove("next-step-highlight-secondary");
          btn.classList.remove("next-step-highlight-shift");
        });
      }
      // 更新按鈕狀態（電源已關閉）
      if (window.buttonManager) {
        window.buttonManager.updateMediaForCurrentAction();
      }
      this.manager.finishExperiment();
    } else if (
      this.manager.isExperimentRunning &&
      isPowerOn &&
      !this.manager.waitingForPowerOn &&
      !this.manager.waitingForPowerOff
    ) {
      // 實驗進行中，電源重新開啟，還原目前步驟的媒體播放
      this.manager.showCurrentStepMedia();
      // 確保按鈕高亮效果被更新
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
    }
  }

  /** 處理實驗結束流程 */
  handleExperimentEnd() {
    if (
      this.manager.includeShutdown &&
      window.powerControl &&
      window.powerControl.isPowerOn
    ) {
      // 需要關機且機器目前是開啟的，等待使用者關機
      this.manager.waitingForPowerOff = true;
      this.manager.highlightPowerSwitch(true);
      if (window.logger) {
        window.logger.logAction("等待關機", null, null, false, false);
      }
    } else {
      // 不需要關機或機器已經關閉，直接結束實驗
      this.manager.finishExperiment();
    }
  }
}

// 匯出電源管理器類別（實例化時需要傳入manager）
window.PanelExperimentPower = PanelExperimentPower;
