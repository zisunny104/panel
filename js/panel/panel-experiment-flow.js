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
   * 更新實驗相關的UI組件
   */
  updateExperimentUI() {
    // 更新UI顯示
    this.manager.ui.updateExperimentUI();
    // 更新高亮提示
    this.manager.ui.updateHighlightVisibility();
    // 更新按鈕樣式
    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }
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
          "panel_start",
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
    let participantName =
      document.getElementById("participantNameInput")?.value?.trim() || "";
    const combinationName =
      this.manager.currentCombination?.combination_name || "";

    // 如果受試者名稱為空，自動產生「受試者_實驗ID」
    if (!participantName) {
      participantName = `受試者_${experimentId}`;
      const participantNameInput = document.getElementById(
        "participantNameInput",
      );
      if (participantNameInput) {
        // 更新輸入框，確保輸入欄等於實際使用的值
        participantNameInput.value = participantName;
      }
      Logger.debug(`自動產生受試者名稱: ${participantName}`);
    }

    if (window.logger) {
      window.logger.clearLog();
      window.logger.logAction(
        `開始實驗 - ID: ${experimentId}`,
        null,
        null,
        false,
        false,
      );

      // 自動最小化 logger 在實驗模式
      setTimeout(() => {
        window.logger.handleExperimentMode();
      }, 100);

      // 關閉設定面板
      if (window.panelManager) {
        window.panelManager.closePanel("settings");
      }
    }

    const startExperimentButton = document.getElementById("startExperimentBtn");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons",
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
        "panel_start",
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
            "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義",
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

    this.updateExperimentUI();

    // 開始執行第一個步驟
    this.nextStep();

    //分發實驗開始事件給同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_started", {
        detail: {
          experimentId: this.manager.getCurrentExperimentId(),
          participantName:
            document.getElementById("participantNameInput")?.value || "",
          combinationId: this.manager.currentCombination?.combination_id || "",
          combinationName:
            this.manager.currentCombination?.combination_name || "",
        },
      }),
    );

    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("running");
    } else {
      Logger.error(
        "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義",
      );
    }
    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();

    //發送實驗開始的同步訊號到其他連線的裝置（experiment.html）
    if (window.syncManager?.core?.isConnected?.()) {
      const experimentStartedData = {
        type: window.SyncDataTypes.EXPERIMENT_STARTED,
        source: "panel",
        clientId: this.manager.clientId,
        experimentId: this.manager.getCurrentExperimentId(),
        participantName:
          document.getElementById("participantNameInput")?.value || "",
        combinationId: this.manager.currentCombination?.combination_id || "",
        combinationName:
          this.manager.currentCombination?.combination_name || "",
        gestureSequence: this.manager.currentCombination?.gestures || [],
        unitCount: this.manager.loadedUnits?.length || 0,
        gestureCount: this.manager.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString(),
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
      "experimentControlButtons",
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
        type: SyncDataTypes.EXPERIMENT_STOPPED,
        source: "panel",
        clientId: this.manager.clientId,
        experimentId: this.manager.getCurrentExperimentId(),
        timestamp: new Date().toISOString(),
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
        false,
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
        false,
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
        false,
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

  /** 產生新的實驗ID 並在同步模式下註冊到中樞 */
  async generateNewExperimentIdWithHub() {
    try {
      Logger.debug("產生新的實驗ID...");

      // 產生新的實驗ID
      const newId = RandomUtils.generateNewExperimentId();

      // 更新本機狀態
      this.manager.currentExperimentId = newId;
      this.manager.updateExperimentIdDisplay();

      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(newId, "generate");
      }

      // 檢查是否在同步模式
      if (window.experimentHubManager?.hubClient) {
        Logger.debug(`同步模式: 註冊新ID到中樞: ${newId}`);
        try {
          await window.experimentHubManager.hubClient.registerExperimentId(
            newId,
            "panel_manager",
          );
          Logger.info(`實驗ID已成功註冊到中樞: ${newId}`);
        } catch (error) {
          Logger.warn(`無法連線到實驗中樞: ${error.message}`);
        }
      } else {
        Logger.debug(`獨立模式: 新ID僅存本機: ${newId}`);
      }

      // 廣播新的實驗ID
      this.manager.broadcastExperimentIdUpdate(newId);

      Logger.info(`新的實驗ID已產生: ${newId}`);
      return newId;
    } catch (error) {
      Logger.error("產生新實驗ID失敗:", error);
      throw error;
    }
  }

  /** 智慧重新產生實驗ID - 檢查中樞同步狀態 */
  async smartRegenerateExperimentId() {
    const hubManager = window.experimentHubManager;

    // 檢查是否在同步模式
    if (!hubManager?.isInSyncMode?.()) {
      Logger.debug(
        "[PanelExperimentManager 智慧重新產生] 獨立模式 - 直接產生新的實驗ID",
      );
      await this.generateNewExperimentIdWithHub();
      return;
    }

    try {
      // 取得中樞的實驗ID
      const hubExperimentId = await hubManager.getExperimentId();
      const currentExperimentId = this.manager.currentExperimentId;

      Logger.debug(
        `[PanelExperimentManager 智慧重新產生] 中樞ID: ${hubExperimentId}, 本機ID: ${currentExperimentId}`,
      );

      if (
        hubExperimentId &&
        currentExperimentId &&
        hubExperimentId !== currentExperimentId
      ) {
        // 實驗ID與中樞不同，同步到中樞的ID
        Logger.info(
          `[PanelExperimentManager 智慧重新產生] 實驗ID與中樞不同，同步到中樞ID: ${hubExperimentId}`,
        );
        this.manager.currentExperimentId = hubExperimentId;
        this.manager.updateExperimentIdDisplay();

        // 更新狀態管理器
        if (window.experimentStateManager) {
          window.experimentStateManager.setExperimentId(
            hubExperimentId,
            "sync",
          );
        }

        // 廣播同步
        this.manager.broadcastExperimentIdUpdate(hubExperimentId);
      } else {
        // 實驗ID與中樞相同或中樞沒有ID，產生新的ID
        Logger.info(
          "[PanelExperimentManager 智慧重新產生] 產生新的實驗ID並廣播",
        );
        await this.generateNewExperimentIdWithHub();
      }
    } catch (error) {
      Logger.error(
        "[PanelExperimentManager 智慧重新產生] 檢查中樞狀態失敗:",
        error,
      );
      // 出錯時仍產生新的ID
      await this.generateNewExperimentIdWithHub();
    }
  }

  /** 處理步驟轉換 */
  handleStepTransition(interaction, key) {
    if (!interaction) return;
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;
    const currentStep = unit.steps[this.manager.currentStepIndex];
    const isFirstStep =
      this.manager.currentStepIndex === 0 &&
      currentStep &&
      currentStep.step_id.includes("_1");

    if (
      window.buttonManager &&
      !window.buttonManager.isPowerOn() &&
      !isFirstStep
    ) {
      if (window.logger) {
        window.logger.logAction(
          `操作被阻止：機器未開機，請先開啟機器電源再進行操作 (${key})`,
        );
      }
      return;
    }

    if (window.logger) {
      window.logger.logAction(
        `${key} → ${interaction.function_name || "下一步"}`,
      );
    }

    if (interaction.next_step_id) {
      if (interaction.next_step_id === "END_UNIT") {
        this.handleUnitCompletion();
        return;
      }
      if (interaction.next_step_id === "") {
        // 空的 next_step_id，根據目前位置決定下一步
        this.handleEmptyNextStepId();
        return;
      }
      const nextIdx = unit.steps.findIndex(
        (s) => s.step_id === interaction.next_step_id,
      );
      if (nextIdx !== -1) {
        this.manager.currentStepIndex = nextIdx;
        this.showCurrentStepMediaOrHome();
        // 觸發同步事件
        this.manager.dispatchExperimentStateChanged();
        // 更新UI組件
        this.updateExperimentUI();
        return;
      }
    }
    this.handleAutoProgression();
  }

  /** 處理自動進展邏輯 */
  handleAutoProgression() {
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    if (this.manager.currentStepIndex + 1 < unit.steps.length) {
      this.manager.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.manager.dispatchExperimentStateChanged();
      // 更新UI組件
      this.updateExperimentUI();
    } else {
      this.handleUnitCompletion();
    }
  }

  /** 處理單元完成 */
  handleUnitCompletion() {
    this.manager.currentUnitIndex++;
    this.manager.currentStepIndex = 0;
    if (this.manager.currentUnitIndex < this.manager.loadedUnits.length) {
      const nextUnitId =
        this.manager.loadedUnits[this.manager.currentUnitIndex];

      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.manager.dispatchExperimentStateChanged();
      // 更新UI顯示
      this.updateExperimentUI();
      if (window.logger) {
        window.logger.logAction(`進入單元：${nextUnitId}`);
      }
    } else {
      if (window.logger) {
        window.logger.logAction("所有單元已完成");
      }
      // 檢查是否需要關機流程
      this.handleExperimentEnd();
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
      this.finishExperiment();
    }
  }

  /** 完成實驗（處理最終清理和日誌匯出） */
  finishExperiment() {
    if (window.logger) {
      window.logger.logAction("實驗結束");
    }

    // 清除預先載入的媒體
    if (window.mediaManager) {
      window.mediaManager.clearPreloadedMedia();
    }

    //自動停止（不廣播到其他裝置）
    this.manager.stopExperiment(false);
  }

  /** 處理空的 next_step_id */
  handleEmptyNextStepId() {
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    // 檢查是否有下一個單元
    if (this.manager.currentUnitIndex + 1 < this.manager.loadedUnits.length) {
      // 有下一個單元，跳轉到下一個單元的第一個步驟
      const nextUnitId =
        this.manager.loadedUnits[this.manager.currentUnitIndex + 1];
      if (window.logger) {
        window.logger.logAction(`跳轉到下一個單元：${nextUnitId}`);
      }
      this.handleUnitCompletion();
    } else {
      // 這是最後一個單元，處理實驗結束
      if (window.logger) {
        window.logger.logAction("最後一個單元，準備關機");
      }
      this.handleExperimentEnd();
    }
  }

  /** 顯示目前步驟媒體或首頁循環 */
  showCurrentStepMediaOrHome() {
    if (!window._allUnits || this.manager.loadedUnits.length === 0) return;
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.manager.currentStepIndex];
    if (!step) return;

    const _isFirstStep =
      this.manager.currentStepIndex === 0 && step.step_id.includes("_1");
    const isPowerOn = window.buttonManager
      ? window.buttonManager.isPowerOn()
      : true;

    // 如果機器未開機，顯示等待開機提示（所有步驟都一樣）
    if (!isPowerOn) {
      if (window.mediaManager && window.mediaManager.mediaArea) {
        window.mediaManager.mediaArea.innerHTML = `
                    <div class="machine-status-message">
                        <div class="machine-status-icon">⚡</div>
                        <div class="machine-status-title">機器未開機</div>
                        <div class="machine-status-subtitle">請先開啟機器電源</div>
                        <div class="machine-status-waiting">等待中...</div>
                    </div>
                `;
      }
      // 更新UI顯示
      this.updateExperimentUI();
      return;
    }

    // 處理媒體播放
    const mediaFile = step.media_file;
    if (mediaFile && window.mediaManager) {
      // 有媒體檔案，播放步驟媒體
      window.mediaManager.showStepMedia(mediaFile);
    } else if (window.mediaManager && isPowerOn) {
      // 沒有媒體檔案且機器已開機，播放首頁循環
      window.mediaManager.playMedia(
        PanelExperimentManager.HOME_PAGE_VIDEO_PATH,
        {
          controls: false,
          muted: true,
          loop: true,
          autoplay: true,
          onError: (e, errorInfo) => {
            Logger.warn("首頁影片載入失敗:", errorInfo);
            // 顯示無媒體內容的狀態
            if (window.mediaManager && window.mediaManager.mediaArea) {
              window.mediaManager.mediaArea.innerHTML = `
                            <div class="waiting-message">
                                <div class="waiting-icon">📺</div>
                                <div>此步驟無媒體內容</div>
                                <div class="waiting-text">等待操作指令...</div>
                            </div>
                        `;
            }
          },
        },
      );
      if (window.logger) {
        window.logger.logAction(`播放首頁 - ${step.step_name || step.step_id}`);
      }
    }

    // 預先載入下一個步驟的媒體（如果存在）
    this.preloadNextStepMedia(unit);

    // 更新UI顯示
    this.updateExperimentUI();
  }

  /** 檢查並處理沒有交互操作的步驟自動進展 */
  checkAutoProgressionForEmptyInteractions(step, unit) {
    // 所有進展都由 ActionManager 管理
    return;
  }

  /** 處理步驟自動進展邏輯 */
  handleStepAutoProgression(unit) {
    // 檢查是否還有下一個步驟
    if (this.manager.currentStepIndex + 1 < unit.steps.length) {
      // 還有下一個步驟，正常進展
      this.manager.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      setTimeout(() => {
        this.updateExperimentUI();
      }, 10);
    } else {
      // 這是最後一個步驟，檢查是否有下一個單元
      if (this.manager.currentUnitIndex + 1 < this.manager.loadedUnits.length) {
        // 有下一個單元，跳轉到下一個單元的第一個步驟
        const nextUnitId =
          this.manager.loadedUnits[this.manager.currentUnitIndex + 1];
        if (window.logger) {
          window.logger.logAction(
            `單元完成，自動進入下一個單元：${nextUnitId}`,
          );
        }
        this.handleUnitCompletion();
      } else {
        // 這是最後一個單元，處理實驗結束
        if (window.logger) {
          window.logger.logAction("最後一個單元完成，準備結束實驗");
        }
        this.handleExperimentEnd();
      }
    }
  }

  /** 預先載入下一個步驟的媒體（減少黑畫面等待時間） */
  preloadNextStepMedia(currentUnit) {
    if (!window.mediaManager || !currentUnit) return;

    const nextStepIndex = this.manager.currentStepIndex + 1;
    const mediaFilesToPreload = [];

    // 收集後續步驟的媒體檔案
    if (nextStepIndex < currentUnit.steps.length) {
      const nextStep = currentUnit.steps[nextStepIndex];
      if (nextStep?.media_file) {
        mediaFilesToPreload.push(nextStep.media_file);
      }

      // 也預先載入往後第二個步驟的媒體（如果存在）
      if (nextStepIndex + 1 < currentUnit.steps.length) {
        const stepAfterNext = currentUnit.steps[nextStepIndex + 1];
        if (stepAfterNext?.media_file) {
          mediaFilesToPreload.push(stepAfterNext.media_file);
        }
      }
    } else if (
      this.manager.currentUnitIndex + 1 <
      this.manager.loadedUnits.length
    ) {
      // 如果目前單元已完成，預先載入下一個單元的媒體
      const nextUnitId =
        this.manager.loadedUnits[this.manager.currentUnitIndex + 1];
      const nextUnit = window._allUnits?.find((u) => u.unit_id === nextUnitId);
      if (nextUnit?.steps?.[0]?.media_file) {
        mediaFilesToPreload.push(nextUnit.steps[0].media_file);
      }
    }

    // 批次預先載入媒體檔案
    if (mediaFilesToPreload.length > 0) {
      window.mediaManager.preloadMediaBatch(mediaFilesToPreload);
    }
  }

  /** 處理鍵盤互動 */
  handleKeyboardInteraction(event) {
    //重點修正：如果任何輸入框有焦點，忽略鍵盤事件
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.classList.contains("editable"))
    ) {
      return false; // 輸入框有焦點，不處理
    }

    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    const step =
      unit && unit.steps ? unit.steps[this.manager.currentStepIndex] : null;

    if (step && step.interactions) {
      let key = event.key;
      if (event.shiftKey && !/^Shift/.test(key)) key = "Shift+" + key;
      let found = null;
      for (const k in step.interactions) {
        if (k.toLowerCase() === key.toLowerCase()) {
          found = step.interactions[k];
          break;
        }
      }
      if (found) {
        this.handleStepTransition(found, key);
        return true;
      }
    }
    return false;
  }

  /** 顯示目前步驟的媒體內容 */
  showCurrentStepMedia() {
    this.showCurrentStepMediaOrHome();
  }
}

// 匯出流程管理器類別（實例化時需要傳入manager）
window.PanelExperimentFlow = PanelExperimentFlow;
