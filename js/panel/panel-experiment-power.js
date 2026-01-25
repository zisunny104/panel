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
          false
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
          false
        );
      }
    }
  }

  /**
   * 高亮電源開關
   */
  highlightPowerSwitch(highlight) {
    const powerSwitch = document.querySelector(".power-button");
    if (powerSwitch) {
      if (highlight) {
        powerSwitch.classList.add("highlight");
        Logger.debug("電源開關已高亮");
      } else {
        powerSwitch.classList.remove("highlight");
        Logger.debug("電源開關高亮已取消");
      }
    }
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
        { reason }
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
        type: "power_state_changed",
        source: "panel",
        device_id: this.manager.clientId,
        is_power_on: isPowerOn,
        timestamp: new Date().toISOString()
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
        false
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
      isPowerOn: this.checkPowerState()
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
    Logger.debug(
      `highlightPowerSwitch(${enable}): powerSwitchArea=${
        powerSwitchArea ? "找到" : "未找到"
      }`
    );

    if (powerSwitchArea) {
      Logger.debug(
        `   目前 display=${powerSwitchArea.style.display}, visibility=${powerSwitchArea.style.visibility}`
      );

      if (enable) {
        //實驗進行中，無條件高亮電源按鈕
        powerSwitchArea.classList.add("next-step-highlight");
        Logger.debug("電源按鈕已高亮 (added class)");
        Logger.debug(`   classList=${powerSwitchArea.classList.toString()}`);
      } else {
        powerSwitchArea.classList.remove("next-step-highlight");
        Logger.debug("電源按鈕高亮已移除");
      }
    } else {
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
      `電源選項已更新: 開機=${includeStartup}, 關機=${includeShutdown}`
    );
  }
}

// 匯出電源管理器類別（實例化時需要傳入manager）
window.PanelExperimentPower = PanelExperimentPower;
