/**
 * PanelExperimentManager - 主面板實驗管理器
 *
 * 負責主面板的實驗流程控制，專注於步驟為基礎的邏輯
 * 管理主面板的實驗流程、單元選擇、步驟切換、UI互動等
 * 專門用於 index.html，與 ActionManager 協作
 *
 * 主要功能：
 * - 實驗流程控制（開始、暫停、恢復、停止）
 * - 單元載入與步驟管理
 * - UI 狀態同步
 * - 電源流程控制
 * - 遠端同步支援
 */
class PanelExperimentManager {
  // 常數定義
  static HOME_PAGE_VIDEO_PATH = "assets/units/SYSTEM/home_page.mp4";

  constructor() {
    // 效能優化：快取常用 DOM 元素
    this.cachedElements = new Map();

    // 初始化各功能模組
    this.timer = window.panelExperimentTimer;
    this.ui = new PanelExperimentUI(this);
    this.sync = new PanelExperimentSync(this);
    this.flow = new PanelExperimentFlow(this);
    this.units = new PanelExperimentUnits(this);
    this.media = new PanelExperimentMedia(this);
    this.power = new PanelExperimentPower(this);

    // 狀態屬性
    this.isExperimentRunning = false;
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.loadedUnits = [];
    this.currentExperimentId = null;
    this.currentCombination = null; // 追蹤目前選中的單元組合
    this.pendingExperimentIdUpdate = null; // 等待實驗結束後同步的實驗ID更新
    this.pendingSubjectNameUpdate = null; // 等待實驗結束後同步的受試者名稱更新

    // 電源流程控制
    this.includeStartup = true;
    this.includeShutdown = true;
    this.waitingForPowerOn = false;
    this.waitingForPowerOff = false;

    // 延遲初始化到 DOM 準備完成
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initialize(), {
        once: true
      });
    } else {
      this.initialize();
    }
  }

  /**
   * 初始化所有功能（在 DOM 準備後調用）
   */
  initialize() {
    return this.ui.initialize();
  }

  /** 效能優化：快取 DOM 元素 */
  getCachedElement(id) {
    if (!this.cachedElements.has(id)) {
      this.cachedElements.set(id, document.getElementById(id));
    }
    return this.cachedElements.get(id);
  }

  /** 檢查是否在檢視模式 */
  get isViewerMode() {
    return window.syncManager && !window.syncManager.isInteractiveMode;
  }

  /** 取得同步客戶端角色 */
  get syncRole() {
    return window.syncManager?.core?.syncClient?.role;
  }

  /** 同步狀態方法 */
  get syncState() {
    return window.syncManager?.core?.syncState;
  }

  /** 同步客戶端ID */
  get clientId() {
    return window.syncManager?.core?.syncClient?.clientId || "panel_device";
  }

  /** 設定事件監聽器 */
  setupEventListeners() {
    return this.ui.setupEventListeners();
  }

  /** 設定同步事件監聽器 */
  setupSyncEventListeners() {
    return this.ui.setupSyncEventListeners();
  }

  /** 處理實驗狀態同步 */
  handleSyncExperimentState(data) {
    this.sync.handleSyncExperimentState(data);
  }

  /** 套用遠端實驗狀態 */
  applyRemoteExperimentState(data) {
    this.sync.applyRemoteExperimentState(data);
  }

  /** 處理遠端按鈕動作 */

  /** 處理裝置模式變更 */
  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    // 根據模式顯示/隱藏實驗控制按鈕
    const controlButtons = document.querySelectorAll(
      "#startExperimentBtn, #pauseExperimentBtn, #stopExperimentBtn"
    );
    controlButtons.forEach((button) => {
      if (button) {
        button.style.display = isInteractive ? "block" : "none";
      }
    });
  }

  /** 廣播實驗初始化 - 實驗開始時同步ID和單元組合 */
  broadcastExperimentInitialization() {
    this.sync.broadcastExperimentInitialization();
  }

  /** 設定實驗控制按鈕 */
  setupExperimentControls() {
    return this.ui.setupExperimentControls();
  }

  /**
   * 同步加入後的初始化：讀取中樞資料並同步到本機
   * @param {Object} detail - sync_session_joined 事件詳情
   */
  async initializeFromSync(detail) {
    try {
      const { sessionId, shouldSyncFromHub, syncItems } = detail;

      if (!shouldSyncFromHub) {
        Logger.debug("跳過中樞同步");
        return;
      }

      Logger.info("開始從中樞同步資料", syncItems);

      // 應該同步的項目：實驗ID、受試者名稱、實驗組合、實驗狀態
      if (syncItems?.includes("experimentId")) {
        Logger.debug("同步項目: 實驗ID");
        // 從中樞讀取目前的實驗ID
        const hubState = await this.getHubState(sessionId);
        if (hubState?.experimentId) {
          this.currentExperimentId = hubState.experimentId;
          this.updateExperimentIdDisplay();
          Logger.info(`實驗ID已同步: ${hubState.experimentId}`);
        }
      }

      if (syncItems?.includes("subjectName")) {
        Logger.debug("同步項目: 受試者名稱");
        const hubState = await this.getHubState(sessionId);
        if (hubState?.subjectName) {
          this.currentSubjectName = hubState.subjectName;
          this.updateSubjectNameDisplay();
          Logger.info(`受試者名稱已同步: ${hubState.subjectName}`);
        }
      }

      if (syncItems?.includes("combination")) {
        Logger.debug("同步項目: 實驗組合");
        const hubState = await this.getHubState(sessionId);
        if (hubState?.combination) {
          this.currentCombination = hubState.combination;
          this.updateCombinationDisplay();
          Logger.info(`實驗組合已同步: ${hubState.combination?.name}`);
        }
      }

      if (syncItems?.includes("experimentState")) {
        Logger.debug("同步項目: 實驗狀態");
        const hubState = await this.getHubState(sessionId);
        if (hubState?.state) {
          this.currentState = hubState.state;
          this.updateExperimentStateDisplay();
          Logger.info(`實驗狀態已同步: ${hubState.state}`);
        }
      }

      Logger.info("中樞資料同步完成");
    } catch (error) {
      Logger.error("中樞同步失敗:", error);
    }
  }

  /**
   * 從中樞取得目前工作階段的狀態
   * @param {string} sessionId - 工作階段ID
   * @returns {Object} 中樞狀態
   */
  async getHubState(sessionId) {
    return this.sync.getHubState(sessionId);
  }

  /**
   * 更新按鈕狀態：根據角色禁用/啟用按鈕
   */
  /** 產生新的實驗ID */
  generateNewExperimentId() {
    return this.ui.generateNewExperimentId();
  }

  /** 產生新的實驗ID 並在同步模式下註冊到中樞 */
  async generateNewExperimentIdWithHub() {
    try {
      Logger.debug("產生新的實驗ID...");

      // 產生新的實驗ID
      const newId = RandomUtils.generateNewExperimentId();

      // 更新本機狀態
      this.currentExperimentId = newId;
      this.updateExperimentIdDisplay();

      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(newId, "generate");
      }

      // 檢查是否在同步模式
      if (window.experimentHubManager?.hubClient) {
        Logger.debug(`同步模式: 註冊新ID到中樞: ${newId}`);
        try {
          await window.experimentHubManager.hubClient.registerExperimentId(
            newId,
            "panel_manager"
          );
          Logger.info(`實驗ID已成功註冊到中樞: ${newId}`);
        } catch (error) {
          Logger.warn(`無法連線到實驗中樞: ${error.message}`);
        }
      } else {
        Logger.debug(`獨立模式: 新ID僅存本機: ${newId}`);
      }

      // 廣播新的實驗ID
      this.broadcastExperimentIdUpdate(newId);

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
        "[PanelExperimentManager 智慧重新產生] 獨立模式 - 直接產生新的實驗ID"
      );
      await this.generateNewExperimentIdWithHub();
      return;
    }

    try {
      // 取得中樞的實驗ID
      const hubExperimentId = await hubManager.getExperimentId();
      const currentExperimentId = this.currentExperimentId;

      Logger.debug(
        `[PanelExperimentManager 智慧重新產生] 中樞ID: ${hubExperimentId}, 本機ID: ${currentExperimentId}`
      );

      if (
        hubExperimentId &&
        currentExperimentId &&
        hubExperimentId !== currentExperimentId
      ) {
        // 實驗ID與中樞不同，同步到中樞的ID
        Logger.info(
          `[PanelExperimentManager 智慧重新產生] 實驗ID與中樞不同，同步到中樞ID: ${hubExperimentId}`
        );
        this.currentExperimentId = hubExperimentId;
        this.updateExperimentIdDisplay();

        // 更新狀態管理器
        if (window.experimentStateManager) {
          window.experimentStateManager.setExperimentId(
            hubExperimentId,
            "sync"
          );
        }

        // 廣播同步
        this.broadcastExperimentIdUpdate(hubExperimentId);
      } else {
        // 實驗ID與中樞相同或中樞沒有ID，產生新的ID
        Logger.info(
          "[PanelExperimentManager 智慧重新產生] 產生新的實驗ID並廣播"
        );
        await this.generateNewExperimentIdWithHub();
      }
    } catch (error) {
      Logger.error(
        "[PanelExperimentManager 智慧重新產生] 檢查中樞狀態失敗:",
        error
      );
      // 出錯時仍產生新的ID
      await this.generateNewExperimentIdWithHub();
    }
  }

  /**
   * 初始化連線時取得實驗ID
   * 使用新的 ExperimentHubClient 系統
   */

  // 移除重複的方法：createSeededRandom 和 shuffleArray
  // 這些方法已統一在 js/core/random-utils.js 中
  // panel-experiment-manager 現在透過 CombinationSelector 使用統一邏輯

  /** 自動重新套用指定隨機組合（如果目前選中的是隨機組合） */
  autoReapplyRandomCombination() {
    if (this.currentCombination && this.currentCombination.is_randomizable) {
      // 延遲執行，讓輸入框的值先更新完成
      setTimeout(() => {
        this.applyUnitCombination(this.currentCombination);
        if (window.logger) {
          const experimentId = this.getCurrentExperimentId();
          window.logger.logAction(`ID變更(${experimentId})，重新隨機排列`);
        }
      }, 50);
    }
  }

  /** 更新實驗ID顯示 */
  updateExperimentIdDisplay() {
    return this.ui.updateExperimentIdDisplay();
  }

  /** 取得目前實驗ID（從狀態管理器讀取） */
  getCurrentExperimentId() {
    return this.ui.getCurrentExperimentId();
  }

  /** 開始實驗 */
  startExperiment() {
    return this.flow.startExperiment();
  }

  /** 高亮電源開關 */
  highlightPowerSwitch(enable) {
    return this.power.highlightPowerSwitch(enable);
  }

  /** 更新所有綠色高亮提示的可見性 */
  /** 關閉實驗面板 */
  closeExperimentPanel() {
    // 檢查是否有實驗面板關閉按鈕，如果有就觸發關閉
    const experimentPanel = document.getElementById("experimentPanel");
    const closeBtn = document.getElementById("closeExperimentPanel");

    if (experimentPanel && experimentPanel.style.display !== "none") {
      if (window.logger) {
        window.logger.logAction("自動關閉實驗面板");
      }

      if (closeBtn) {
        // 使用面板管理器的關閉方法
        if (window.panelManager) {
          window.panelManager.closePanel("experiment");
        } else {
          // 回退方案：直接觸發關閉按鈕
          closeBtn.click();
        }
      } else {
        // 如果沒有關閉按鈕，直接隱藏面板
        experimentPanel.style.display = "none";
        experimentPanel.classList.add("hidden");
      }
    }
  }

  /** 處理電源狀態變化 */
  onPowerStateChanged(isPowerOn) {
    if (this.waitingForPowerOn && isPowerOn) {
      // 等待開機完成
      Logger.debug("電源打開，開始實驗");
      this.waitingForPowerOn = false;
      this.highlightPowerSwitch(false);
      if (window.logger) {
        window.logger.logAction("開機完成", null, null, false, false);
      }
      // 設定按鈕顏色為執行中
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("running");
      } else {
        Logger.error(
          "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
        );
      }

      //打開電源時，先高亮電源按鈕作為確認
      Logger.debug("電源已打開，高亮電源按鈕");
      this.highlightPowerSwitch(true);

      //延遲後清除電源按鈕高亮，載入資料並顯示第一個動作的按鈕高亮
      setTimeout(() => {
        this.highlightPowerSwitch(false);

        //此時才初始化動作序列和顯示第一個按鈕高亮
        if (!window.actionManager?.isInitialized) {
          Logger.debug("打開電源後，開始載入單元資料和初始化動作序列");
          this.loadUnitsAndStart();
        } else {
          // 已經初始化過，只更新按鈕高亮
          if (window.buttonManager) {
            Logger.debug("更新按鈕高亮");
            window.buttonManager.updateMediaForCurrentAction();
          }
        }

        //多螢幕同步：電源打開後廣播實驗狀態到其他裝置
        Logger.debug("電源打開後，廣播實驗初始化到其他裝置");

        //現在才廣播實驗初始化，此時按鈕高亮已準備好，experiment.html 也可以自動啟動
        this.broadcastExperimentInitialization();

        this.dispatchExperimentStateChanged();
      }, 500);

      // 實驗開始後自動關閉實驗面板（延遲確保所有初始化完成）
      setTimeout(() => {
        this.closeExperimentPanel();
      }, 1000);
    } else if (this.waitingForPowerOff && !isPowerOn) {
      // 等待關機完成
      this.waitingForPowerOff = false;
      this.highlightPowerSwitch(false);
      if (window.logger) {
        window.logger.logAction("關機完成，實驗結束", null, null, false, false);
      }
      // 結束實驗
      this.finishExperiment();
    } else if (
      this.isExperimentRunning &&
      !isPowerOn &&
      !this.waitingForPowerOff
    ) {
      //實驗進行中，電源關閉 → 立即結束實驗
      Logger.debug("實驗進行中偵測到電源關閉，立即結束實驗");
      if (window.logger) {
        window.logger.logAction(
          "異常關機，實驗被迫結束",
          null,
          null,
          false,
          false
        );
      }
      this.finishExperiment();
    } else if (
      this.isExperimentRunning &&
      isPowerOn &&
      !this.waitingForPowerOn &&
      !this.waitingForPowerOff
    ) {
      // 實驗進行中，電源重新開啟，還原目前步驟的媒體播放
      this.showCurrentStepMedia();
      // 確保按鈕高亮效果被更新
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
    }
  }

  /** 載入選擇的單元 */
  loadSelectedUnits() {
    return this.units.loadSelectedUnits();
  }
  /** 載入單元資料並開始實驗 */
  async loadUnitsAndStart() {
    return this.units.loadUnitsAndStart();
  }

  /** 顯示實驗等待狀態 */
  showExperimentWaitingState() {
    if (!window._allUnits || this.loadedUnits.length === 0) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.currentStepIndex];
    if (!step) return;

    // 顯示目前步驟的媒體內容和按鈕高亮
    this.showCurrentStepMediaOrHome();

    if (window.logger) {
      window.logger.logAction(
        `等待指令 - ${unit.unit_name || unitId}：${
          step.step_name || step.step_id
        }`
      );
    }

    // 更新綠色高亮提示
    this.ui.updateHighlightVisibility();
  }

  /** 暫停/繼續實驗 */
  togglePauseExperiment() {
    return this.flow.togglePauseExperiment();
  }

  /** 停止實驗 */
  stopExperiment(isManualStop = true) {
    return this.flow.stopExperiment();
  }

  /** 顯示目前步驟的媒體內容 */
  showCurrentStepMedia() {
    this.showCurrentStepMediaOrHome();
  }

  /** 處理步驟轉換 */
  handleStepTransition(interaction, key) {
    if (!interaction) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;
    const currentStep = unit.steps[this.currentStepIndex];
    const isFirstStep =
      this.currentStepIndex === 0 &&
      currentStep &&
      currentStep.step_id.includes("_1");

    if (
      window.buttonManager &&
      !window.buttonManager.isPowerOn() &&
      !isFirstStep
    ) {
      if (window.logger) {
        window.logger.logAction(
          `操作被阻止：機器未開機，請先開啟機器電源再進行操作 (${key})`
        );
      }
      return;
    }

    if (window.logger) {
      window.logger.logAction(
        `${key} → ${interaction.function_name || "下一步"}`
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
        (s) => s.step_id === interaction.next_step_id
      );
      if (nextIdx !== -1) {
        this.currentStepIndex = nextIdx;
        this.showCurrentStepMediaOrHome();
        // 觸發同步事件
        this.dispatchExperimentStateChanged();
        // 立即更新綠色高亮
        this.ui.updateHighlightVisibility();
        // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
        if (window.buttonManager) {
          window.buttonManager.updateExperimentButtonStyles();
        }
        return;
      }
    }
    this.handleAutoProgression();
  }

  /** 處理自動進展邏輯 */
  handleAutoProgression() {
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    if (this.currentStepIndex + 1 < unit.steps.length) {
      this.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.dispatchExperimentStateChanged();
      // 立即更新綠色高亮
      this.ui.updateHighlightVisibility();
      // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
    } else {
      this.handleUnitCompletion();
    }
  }

  /** 處理單元完成 */
  handleUnitCompletion() {
    this.currentUnitIndex++;
    this.currentStepIndex = 0;
    if (this.currentUnitIndex < this.loadedUnits.length) {
      const nextUnitId = this.loadedUnits[this.currentUnitIndex];

      //記錄單元變更到 JSONL 實驗日誌
      if (window.panelExperimentLog) {
        window.panelExperimentLog.logUnitChange(
          nextUnitId,
          this.currentUnitIndex,
          this.loadedUnits.length
        );
      }

      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.dispatchExperimentStateChanged();
      // 立即更新綠色高亮
      this.ui.updateHighlightVisibility();
      // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
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
      this.includeShutdown &&
      window.powerControl &&
      window.powerControl.isPowerOn
    ) {
      // 需要關機且機器目前是開啟的，等待使用者關機
      this.waitingForPowerOff = true;
      this.highlightPowerSwitch(true);
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
    this.stopExperiment(false);
  }

  /** 處理空的 next_step_id */
  handleEmptyNextStepId() {
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    // 檢查是否有下一個單元
    if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
      // 有下一個單元，跳轉到下一個單元的第一個步驟
      const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
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

  /** 處理回到首頁 */
  handleReturnToHome() {
    if (window.mediaManager) {
      // 使用統一的首頁動畫路徑常數
      window.mediaManager.playMedia(
        PanelExperimentManager.HOME_PAGE_VIDEO_PATH,
        {
          controls: false,
          muted: true,
          loop: true,
          autoplay: true
        }
      );
      if (window.logger) {
        window.logger.logAction("回到首頁");
      }
    }
  }

  /** 顯示目前步驟媒體或首頁循環 */
  showCurrentStepMediaOrHome() {
    if (!window._allUnits || this.loadedUnits.length === 0) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.currentStepIndex];
    if (!step) return;

    const _isFirstStep =
      this.currentStepIndex === 0 && step.step_id.includes("_1");
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
      // 清除按鈕高亮（因為機器未開機）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
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
          }
        }
      );
      if (window.logger) {
        window.logger.logAction(`播放首頁 - ${step.step_name || step.step_id}`);
      }
    }

    // 預先載入下一個步驟的媒體（如果存在）
    this.preloadNextStepMedia(unit);

    // 更新按鈕高亮樣式
    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }

    // 檢查是否需要自動進展（步驟沒有可用的交互操作）
    this.checkAutoProgressionForEmptyInteractions(step, unit);
  }

  /** 檢查並處理沒有交互操作的步驟自動進展 */
  checkAutoProgressionForEmptyInteractions(step, unit) {
    // 所有進展都由 ActionManager 管理
    return;
  }

  /** 處理步驟自動進展邏輯 */
  handleStepAutoProgression(unit) {
    // 檢查是否還有下一個步驟
    if (this.currentStepIndex + 1 < unit.steps.length) {
      // 還有下一個步驟，正常進展
      this.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      if (window.buttonManager) {
        setTimeout(() => {
          window.buttonManager.updateExperimentButtonStyles();
        }, 10);
      }
    } else {
      // 這是最後一個步驟，檢查是否有下一個單元
      if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
        // 有下一個單元，跳轉到下一個單元的第一個步驟
        const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
        if (window.logger) {
          window.logger.logAction(
            `單元完成，自動進入下一個單元：${nextUnitId}`
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

    const nextStepIndex = this.currentStepIndex + 1;
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
    } else if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
      // 如果目前單元已完成，預先載入下一個單元的媒體
      const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
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

    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    const step = unit && unit.steps ? unit.steps[this.currentStepIndex] : null;

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

  /** 鎖定/解鎖單元列表 */
  /** 設定實驗ID相關事件 */
  /** 初始化實驗UI */
  initializeExperimentUI() {
    this.renderDefaultSequences();
    this.renderUnitList();
    // 初始化後自動套用預設組合
    this.selectDefaultCombination();
  }

  /**
   * 選擇並套用預設組合
   * 優先級：快取 > 設定中的預設 > 第一個
   */
  selectDefaultCombination() {
    try {
      // 非同步載入組合資料
      loadUnitsFromScenarios()
        .then((data) => {
          if (!data || !Array.isArray(data.unit_combinations)) return;

          let selectedCombination = null;

          // 優先檢查本機快取
          const cachedCombinationId = localStorage.getItem(
            "last_selected_combination_id"
          );
          if (cachedCombinationId) {
            selectedCombination = data.unit_combinations.find(
              (c) => c.combination_id === cachedCombinationId
            );
          }

          // 如果沒有快取，使用設定中的預設組合
          if (!selectedCombination) {
            const defaultCombinationId =
              window.CONFIG?.experiment?.defaultCombinationId;
            if (defaultCombinationId) {
              selectedCombination = data.unit_combinations.find(
                (c) => c.combination_id === defaultCombinationId
              );
            }
          }

          // 如果都沒有，使用第一個組合
          if (!selectedCombination && data.unit_combinations.length > 0) {
            selectedCombination = data.unit_combinations[0];
          }

          // 套用選定的組合
          if (selectedCombination) {
            Logger.debug(
              `套用預設組合: ${selectedCombination.combination_name}`
            );
            this.applyUnitCombination(selectedCombination);
          }
        })
        .catch((error) => {
          Logger.warn("套用預設組合失敗:", error);
        });
    } catch (error) {
      Logger.warn("選擇預設組合時發生錯誤:", error);
    }
  }

  /** 從 scenarios.json 渲染預設實驗序列 */
  async renderDefaultSequences() {
    try {
      const data = await loadUnitsFromScenarios();
      // 找出所有組合列表容器（index.html 和 experiment.html 共用）
      const lists = document.querySelectorAll(".experiment-default-list");
      if (lists.length === 0) return;

      if (data && Array.isArray(data.unit_combinations)) {
        const defaultCombinationId =
          window.CONFIG?.experiment?.defaultCombinationId;

        // 為每個列表容器渲染組合
        lists.forEach((list) => {
          list.innerHTML = "";

          data.unit_combinations.forEach((combination) => {
            const li = document.createElement("li");
            li.className = "combination-item";
            li.dataset.combinationId = combination.combination_id;
            li.innerHTML = `
              <div class="combo-name">${combination.combination_name}</div>
              <div class="combo-desc">${combination.description || ""}</div>
            `;
            li.addEventListener("click", () =>
              this.applyUnitCombination(combination)
            );

            // 如果是預設組合，自動選擇並點擊
            if (
              defaultCombinationId &&
              combination.combination_id === defaultCombinationId
            ) {
              li.classList.add("active");
              // 延遲套用，確保 DOM 已完全更新
              setTimeout(() => {
                this.applyUnitCombination(combination);
              }, 0);
            }

            list.appendChild(li);
          });
        });
      }
    } catch (error) {
      Logger.error("載入 scenarios.json 組合失敗:", error);
      if (window.logger) {
        window.logger.logAction(`載入單元組合失敗: ${error.message}`);
      }
    }
  }

  /** 套用預設單元組合 */
  applyDefaultSequence(sequenceId, unitIds) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 清除目前組合追蹤（因為這不是來自新的unit_combinations）
    this.currentCombination = null;

    const allBtns = document.querySelectorAll(".default-combo-btn");
    let clickedBtn = null;
    allBtns.forEach((btn) => {
      if (btn.dataset.sequenceId === sequenceId) clickedBtn = btn;
      btn.classList.remove("active");
    });
    if (clickedBtn) {
      clickedBtn.classList.add("active");
      clickedBtn.style.transform = "scale(0.95)";
      setTimeout(() => {
        clickedBtn.style.transform = "";
      }, 150);
    }

    if (unitIds && Array.isArray(unitIds)) {
      // 清空所有勾選
      Array.from(unitList.children).forEach((li) => {
        const checkbox = li.querySelector("input[type=\"checkbox\"]");
        if (checkbox) checkbox.checked = false;
      });

      // 取得所有項目
      const allItems = Array.from(unitList.children);
      const startupCard = allItems.find((item) =>
        item.classList.contains("startup-card")
      );
      const shutdownCard = allItems.find((item) =>
        item.classList.contains("shutdown-card")
      );
      const normalItems = allItems.filter(
        (item) => !item.classList.contains("power-option-card")
      );

      // 建立新的排序
      const orderedItems = [];

      // 1. 先放開機卡片（如果存在）並勾選
      if (startupCard) {
        const checkbox = startupCard.querySelector("input[type=\"checkbox\"]");
        if (checkbox) checkbox.checked = true;
        orderedItems.push(startupCard);
      }

      // 2. 按照指定順序放入選中的普通單元
      unitIds.forEach((unitId) => {
        const item = normalItems.find((li) => li.dataset.unitId === unitId);
        if (item) {
          const checkbox = item.querySelector("input[type=\"checkbox\"]");
          if (checkbox) checkbox.checked = true;
          orderedItems.push(item);
        }
      });

      // 3. 放入未選中的普通單元
      normalItems.forEach((item) => {
        if (!unitIds.includes(item.dataset.unitId)) {
          orderedItems.push(item);
        }
      });

      // 4. 最後放關機卡片（如果存在）並勾選
      if (shutdownCard) {
        const checkbox = shutdownCard.querySelector("input[type=\"checkbox\"]");
        if (checkbox) checkbox.checked = true;
        orderedItems.push(shutdownCard);
      }

      // 重新排列列表
      unitList.innerHTML = "";
      orderedItems.forEach((item) => unitList.appendChild(item));

      // 更新開機關機選項的狀態
      this.includeStartup = true;
      this.includeShutdown = true;

      this.enableUnitDragSort(unitList);
      this.updateSelectAllState();
      this.updateAllUnitButtonStates();
      if (window.logger) {
        window.logger.logAction(
          `已套用預設組合：${sequenceId}，單元順序：開機 → ${unitIds.join(
            " → "
          )} → 關機`
        );
      }
    }
    this.enableUnitDragSort(unitList);
    this.updateAllUnitButtonStates();
  }

  /** 套用新的單元組合 */
  applyUnitCombination(combination) {
    this.applyCombinationAfterProcessing(combination);
  }

  applyCombinationAfterProcessing(combination) {
    // 儲存目前選中的組合
    this.currentCombination = combination;

    // 使用中央 CombinationSelector 進行選擇
    if (window.CombinationSelector) {
      // 取得目前實驗ID以便可隨機組合使用
      const experimentId = this.getCurrentExperimentId();
      window.CombinationSelector.selectCombination(combination, experimentId);
    }

    // 更新面板特定的狀態
    this.includeStartup = true;
    this.includeShutdown = true;

    // 記錄日誌
    if (window.logger) {
      const experimentId = this.getCurrentExperimentId();
      if (combination.is_randomizable) {
        window.logger.logAction(
          `套用組合：${combination.combination_name} (ID:${experimentId})`
        );
      } else {
        window.logger.logAction(`套用組合：${combination.combination_name}`);
      }
    }
  }

  /**
   * Unit UI / 排序等行為委派到 PanelExperimentUnits
   */
  async renderUnitList() {
    return this.units.renderUnitList();
  }

  addStartupCard(unitList) {
    return this.units.addStartupCard(unitList);
  }

  addShutdownCard(unitList) {
    return this.units.addShutdownCard(unitList);
  }

  createUnitListItem(unit) {
    return this.units.createUnitListItem(unit);
  }

  moveUnit(li, direction) {
    return this.units.moveUnit(li, direction);
  }

  enableUnitDragSort(unitList) {
    return this.units.enableUnitDragSort(unitList);
  }

  toggleSelectAllUnits(checked) {
    return this.units.toggleSelectAllUnits(checked);
  }

  updateSelectAllState() {
    return this.units.updateSelectAllState();
  }

  updateUnitButtonStates(li) {
    return this.units.updateUnitButtonStates(li);
  }

  updateAllUnitButtonStates() {
    return this.units.updateAllUnitButtonStates();
  }

  /** 觸發實驗狀態變化事件（用於多客戶端同步） */
  dispatchExperimentStateChanged() {
    this.sync.dispatchExperimentStateChanged();
  }

  /** 記錄動作到日誌 */
  logAction(action, data = {}) {
    if (window.logger) {
      window.logger.logAction(
        action,
        null,
        null,
        false,
        false,
        false,
        null,
        data
      );
    }
  }
}

// 匯出主面板實驗管理器單例
window.panelExperiment = new PanelExperimentManager();

// 向後相容性：也暴露為 experiment
window.experiment = window.panelExperiment;
