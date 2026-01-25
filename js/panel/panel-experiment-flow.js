/**
 * PanelExperimentFlow - 面板實驗流程控制管理器
 *
 * 負責實驗的開始、暫停、恢復、停止等流程控制邏輯
 * 專門處理步驟為基礎的實驗執行流程
 */
class PanelExperimentFlow {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
  }

  /**
   * 開始實驗
   */
  startExperiment() {
    // 確保從輸入框讀取最新的實驗ID，優先度：輸入框 > 狀態管理器 > 本機
    const experimentIdInput = document.getElementById("experimentIdInput");
    const inputValue = experimentIdInput?.value?.trim() || "";

    if (inputValue) {
      // 輸入框有值，使用輸入框的值，並同步到狀態管理器
      this.manager.currentExperimentId = inputValue;
      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(
          inputValue,
          "panel_start"
        );
      }
    } else {
      // 輸入框沒有值，使用狀態管理器的值
      const currentId = this.manager.getCurrentExperimentId();
      if (currentId) {
        this.manager.currentExperimentId = currentId;
      } else {
        // 只有在沒有ID時才產生新的
        this.manager.generateNewExperimentId();
      }
    }

    //開始 JSONL 實驗日誌記錄
    const experimentId = this.manager.getCurrentExperimentId();
    let subjectName =
      document.getElementById("subjectNameInput")?.value?.trim() || "";
    const combinationName =
      this.manager.currentCombination?.combination_name || "";

    // 如果受試者名稱為空，自動產生「受試者_實驗ID」
    if (!subjectName) {
      subjectName = `受試者_${experimentId}`;
      const subjectNameInput = document.getElementById("subjectNameInput");
      if (subjectNameInput) {
        // 更新輸入框，確保輸入欄等於實際使用的值
        subjectNameInput.value = subjectName;
      }
      Logger.debug(`自動產生受試者名稱: ${subjectName}`);
    }

    if (window.panelExperimentLog) {
      window.panelExperimentLog.startRecording(
        experimentId,
        subjectName,
        combinationName
      );
    }

    if (window.logger) {
      window.logger.clearLog();
      window.logger.logAction(
        `開始實驗 - ID: ${experimentId}`,
        null,
        null,
        false,
        false
      );

      // 自動最小化 logger 在實驗模式
      setTimeout(() => {
        window.logger.handleExperimentMode();
      }, 100);
    }

    const startExperimentButton = document.getElementById("startExperimentBtn");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons"
    );

    if (startExperimentButton) startExperimentButton.style.display = "none";
    // hide the whole row to avoid leaving empty space when the start button is hidden
    const experimentIdRow = document.getElementById("experimentIdRow");
    if (experimentIdRow) experimentIdRow.style.display = "none";
    if (experimentControlButtons) {
      experimentControlButtons.style.display = "flex";
      experimentControlButtons.classList.add("visible");
    }

    this.manager.isExperimentRunning = true;
    this.manager.ui.lockUnitList(true);
    this.manager.ui.lockExperimentId(true);

    // 立即開始計時器，不管是否等待開機
    this.manager.timer.startTimer();

    //先讀取選擇的單元 ID
    this.manager.loadSelectedUnits();
    this.manager.currentUnitIndex = 0;
    this.manager.currentStepIndex = 0;

    //立即廣播實驗開始訊號到其他裝置（不管是否需要開機）
    Logger.debug("廣播實驗開始訊號到其他裝置（experiment.html 自動開始）");

    // 只在同步模式下註冊實驗ID到中樞系統
    const finalExperimentId = this.manager.getCurrentExperimentId();
    if (window.experimentHubManager?.isInSyncMode?.() && finalExperimentId) {
      Logger.debug(`註冊實驗ID到中樞: ${finalExperimentId}`);
      window.experimentHubManager.registerExperimentId(
        finalExperimentId,
        "panel_start"
      );
    } else if (finalExperimentId) {
      Logger.debug(`實驗ID僅存本機: ${finalExperimentId}`);
    }

    this.manager.broadcastExperimentInitialization();

    // 檢查開機設定
    if (this.manager.includeStartup) {
      // 如果包含開機且機器目前是關閉的，等待使用者開機
      if (window.powerControl && !window.powerControl.isPowerOn) {
        Logger.debug("等待開機：呼叫 highlightPowerSwitch(true)");
        this.manager.waitingForPowerOn = true;
        this.manager.highlightPowerSwitch(true);
        if (window.logger) {
          window.logger.logAction("等待使用者開機", null, null, false, false);
        }
        // 設定按鈕顏色為執行中（等待開機也算執行中）
        if (window.mainApp?.setExperimentPanelButtonColor) {
          window.mainApp.setExperimentPanelButtonColor("running");
        } else {
          Logger.error(
            "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
          );
        }
        //不在此呼叫 loadUnitsAndStart()，等待打開電源後再呼叫
        // 計時已開始，但等待開機後才繼續

        //先載入單元資料（但不執行）
        this.manager.loadUnitsAndStart();

        Logger.debug("等待開機中，等待使用者按下電源按鈕");

        this.manager.dispatchExperimentStateChanged();
        return;
      }
    } else if (window.powerControl && !window.powerControl.isPowerOn) {
      // 不包含開機但機器是關閉的，自動開機
      window.powerControl.setPowerState(true, "實驗自動開機");
    }

    //電源已打開或不需要檢查電源，載入單元資料並初始化動作序列
    this.manager.loadUnitsAndStart();

    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }

    //分發實驗開始事件給同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_started", {
        detail: {
          experimentId: this.manager.getCurrentExperimentId(),
          subjectName: document.getElementById("subjectNameInput")?.value || "",
          combinationId: this.manager.currentCombination?.combination_id || "",
          combinationName:
            this.manager.currentCombination?.combination_name || ""
        }
      })
    );

    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("running");
    } else {
      Logger.error(
        "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
      );
    }
    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();

    //發送實驗開始的同步訊號到其他連線的裝置（experiment.html）
    if (window.syncManager?.core?.isConnected?.()) {
      const experimentStartedData = {
        type: "experiment_started",
        source: "panel",
        device_id: this.manager.clientId,
        experiment_id: this.manager.getCurrentExperimentId(),
        subject_name: document.getElementById("subjectNameInput")?.value || "",
        combination_id: this.manager.currentCombination?.combination_id || "",
        combination_name:
          this.manager.currentCombination?.combination_name || "",
        gesture_sequence: this.manager.currentCombination?.gestures || [],
        unit_count: this.manager.loadedUnits?.length || 0,
        gesture_count: this.manager.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString()
      };

      Logger.debug("發送 experiment_started 事件給遠端裝置");
      window.syncManager.core
        .syncState(experimentStartedData)
        .catch((error) => {
          Logger.warn("同步 experiment_started 失敗:", error);
        });
    }
  }

  /**
   * 切換暫停/恢復實驗
   */
  togglePauseExperiment() {
    if (!this.manager.isExperimentRunning) {
      Logger.warn("實驗未運行，無法切換暫停狀態");
      return;
    }

    if (this.manager.timer.isPaused()) {
      this.resumeExperiment();
    } else {
      this.pauseExperiment();
    }
  }

  /**
   * 暫停實驗
   */
  pauseExperiment() {
    if (!this.manager.isExperimentRunning) {
      Logger.warn("實驗未運行，無法暫停");
      return;
    }

    Logger.info("暫停實驗");

    // 暫停計時器
    this.manager.timer.pauseTimer();

    // 廣播暫停狀態
    this.manager.sync.broadcastExperimentPaused();

    // 更新UI
    this.manager.ui.updateExperimentUI();

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("暫停實驗", null, null, false, false);
    }

    // 更新按鈕顏色
    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("paused");
    }

    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();
  }

  /**
   * 恢復實驗
   */
  resumeExperiment() {
    if (!this.manager.isExperimentRunning) {
      Logger.warn("實驗未運行，無法恢復");
      return;
    }

    Logger.info("恢復實驗");

    // 恢復計時器
    this.manager.timer.resumeTimer();

    // 廣播恢復狀態
    this.manager.sync.broadcastExperimentResumed();

    // 更新UI
    this.manager.ui.updateExperimentUI();

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("恢復實驗", null, null, false, false);
    }

    // 更新按鈕顏色
    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("running");
    }

    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();
  }

  /**
   * 停止實驗
   */
  stopExperiment() {
    if (!this.manager.isExperimentRunning) {
      Logger.warn("實驗未運行，無法停止");
      return;
    }

    Logger.info("停止實驗");

    // 停止計時器
    this.manager.timer.stopTimer();

    // 停止日誌記錄
    if (window.panelExperimentLog) {
      window.panelExperimentLog.stopRecording();
    }

    // 記錄停止日誌
    if (window.logger) {
      window.logger.logAction("停止實驗", null, null, false, false);
    }

    // 重置狀態
    this.manager.isExperimentRunning = false;
    this.manager.currentUnitIndex = 0;
    this.manager.currentStepIndex = 0;

    // 廣播停止狀態
    this.manager.sync.broadcastExperimentStopped();

    // 解鎖UI
    this.manager.ui.lockUnitList(false);
    this.manager.ui.lockExperimentId(false);

    // 顯示開始按鈕，隱藏控制按鈕
    const startExperimentButton = document.getElementById("startExperimentBtn");
    const experimentIdRow = document.getElementById("experimentIdRow");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons"
    );

    if (startExperimentButton) startExperimentButton.style.display = "block";
    if (experimentIdRow) experimentIdRow.style.display = "block";
    if (experimentControlButtons) {
      experimentControlButtons.style.display = "none";
      experimentControlButtons.classList.remove("visible");
    }

    // 更新按鈕顏色
    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("stopped");
    }

    // 清除等待狀態
    this.manager.waitingForPowerOn = false;
    this.manager.waitingForPowerOff = false;

    // 取消電源開關高亮
    this.manager.highlightPowerSwitch(false);

    // 更新UI
    this.manager.ui.updateExperimentUI();

    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();

    // 發送停止同步訊號
    if (window.syncManager?.core?.isConnected?.()) {
      const experimentStoppedData = {
        type: "experiment_stopped",
        source: "panel",
        device_id: this.manager.clientId,
        experiment_id: this.manager.getCurrentExperimentId(),
        timestamp: new Date().toISOString()
      };

      window.syncManager.core
        .syncState(experimentStoppedData)
        .catch((error) => {
          Logger.warn("同步 experiment_stopped 失敗:", error);
        });
    }
  }

  /**
   * 下一步
   */
  nextStep() {
    if (!this.manager.isExperimentRunning || this.manager.timer.isPaused()) {
      return;
    }

    const currentUnit = this.manager.loadedUnits[this.manager.currentUnitIndex];
    if (!currentUnit) {
      Logger.warn("沒有當前單元，無法執行下一步");
      return;
    }

    const currentStep = currentUnit.steps[this.manager.currentStepIndex];
    if (!currentStep) {
      Logger.warn("沒有當前步驟，無法執行下一步");
      return;
    }

    // 執行當前步驟
    this.executeStep(currentStep);

    // 移動到下一步
    this.manager.currentStepIndex++;

    // 檢查是否完成當前單元的所有步驟
    if (this.manager.currentStepIndex >= currentUnit.steps.length) {
      // 當前單元完成，移動到下一個單元
      this.manager.currentUnitIndex++;
      this.manager.currentStepIndex = 0;

      // 檢查是否完成所有單元
      if (this.manager.currentUnitIndex >= this.manager.loadedUnits.length) {
        // 所有單元完成，檢查是否需要關機
        this.handleExperimentCompletion();
        return;
      } else {
        // 開始下一個單元
        this.startNextUnit();
      }
    }

    // 更新UI
    this.manager.ui.updateExperimentUI();
  }

  /**
   * 執行步驟
   */
  executeStep(step) {
    Logger.debug(`執行步驟: ${step.step_name}`);

    // 顯示媒體
    if (step.media_path) {
      this.manager.displayMedia(step.media_path);
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `執行步驟: ${step.step_name}`,
        "step_execution",
        step.step_id,
        false,
        false
      );
    }

    // 設定下一步計時器（如果有持續時間）
    if (step.duration && step.duration > 0) {
      setTimeout(() => {
        this.nextStep();
      }, step.duration * 1000);
    }
  }

  /**
   * 開始下一個單元
   */
  startNextUnit() {
    const nextUnit = this.manager.loadedUnits[this.manager.currentUnitIndex];
    if (!nextUnit) {
      Logger.warn("沒有下一個單元");
      return;
    }

    Logger.info(`開始單元: ${nextUnit.unit_name}`);

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `開始單元: ${nextUnit.unit_name}`,
        "unit_start",
        nextUnit.unit_id,
        false,
        false
      );
    }

    // 顯示單元媒體（如果有）
    if (nextUnit.media_path) {
      this.manager.displayMedia(nextUnit.media_path);
    }

    // 更新UI
    this.manager.ui.updateExperimentUI();
  }

  /**
   * 處理實驗完成
   */
  handleExperimentCompletion() {
    Logger.info("所有單元完成，實驗結束");

    // 記錄完成日誌
    if (window.logger) {
      window.logger.logAction(
        "實驗完成",
        "experiment_complete",
        null,
        false,
        false
      );
    }

    // 檢查是否需要關機
    if (this.manager.includeShutdown) {
      if (window.powerControl && window.powerControl.isPowerOn) {
        Logger.debug("等待關機：呼叫 highlightPowerSwitch(true)");
        this.manager.waitingForPowerOff = true;
        this.manager.highlightPowerSwitch(true);

        if (window.logger) {
          window.logger.logAction("等待使用者關機", null, null, false, false);
        }

        // 更新按鈕顏色為等待關機
        if (window.mainApp?.setExperimentPanelButtonColor) {
          window.mainApp.setExperimentPanelButtonColor("waiting_shutdown");
        }

        this.manager.dispatchExperimentStateChanged();
        return;
      }
    }

    // 不需要關機或已經關機，結束實驗
    this.finalizeExperiment();
  }

  /**
   * 最終化實驗
   */
  finalizeExperiment() {
    Logger.info("最終化實驗");

    // 停止計時器
    this.manager.timer.stopTimer();

    // 停止日誌記錄
    if (window.panelExperimentLog) {
      window.panelExperimentLog.stopRecording();
    }

    // 重置狀態
    this.manager.isExperimentRunning = false;
    this.manager.currentUnitIndex = 0;
    this.manager.currentStepIndex = 0;

    // 清除等待狀態
    this.manager.waitingForPowerOn = false;
    this.manager.waitingForPowerOff = false;

    // 取消電源開關高亮
    this.manager.highlightPowerSwitch(false);

    // 更新UI
    this.manager.ui.updateExperimentUI();

    // 更新按鈕顏色
    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("completed");
    }

    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();

    Logger.info("實驗最終化完成");
  }
}

// 匯出流程管理器類別（實例化時需要傳入manager）
window.PanelExperimentFlow = PanelExperimentFlow;
