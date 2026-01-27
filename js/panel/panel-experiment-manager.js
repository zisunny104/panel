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
    // 初始化各功能模組
    this.initializeComponents();

    // 延遲初始化到 DOM 準備完成
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initialize(), {
        once: true,
      });
    } else {
      this.initialize();
    }
  }

  /**
   * 初始化各功能模組
   */
  initializeComponents() {
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
    this.pendingParticipantNameUpdate = null; // 等待實驗結束後同步的受試者名稱更新

    // 電源流程控制
    this.includeStartup = true;
    this.includeShutdown = true;
    this.waitingForPowerOn = false;
    this.waitingForPowerOff = false;
  }

  /**
   * 設定初始化事件監聽
   */
  setupInitialization() {
    // 延遲初始化到 DOM 準備完成
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initialize(), {
        once: true,
      });
    } else {
      this.initialize();
    }
  }

  /**
   * 初始化所有功能（在 DOM 準備後調用）
   */
  initialize() {
    // 先初始化UI
    this.ui.initialize();

    // 初始化動作管理器（用於同步接收遠端按鈕動作）
    this.initializeActionManager();
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
      "#startExperimentBtn, #pauseExperimentBtn, #stopExperimentBtn",
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

      if (syncItems?.includes("participantName")) {
        Logger.debug("同步項目: 受試者名稱");
        const hubState = await this.getHubState(sessionId);
        if (hubState?.participantName) {
          this.currentParticipantName = hubState.participantName;
          this.updateParticipantNameDisplay();
          Logger.info(`受試者名稱已同步: ${hubState.participantName}`);
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

  /**
   * 初始化連線時取得實驗ID
   * 使用新的 ExperimentHubClient 系統
   */

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
    this.flow.showCurrentStepMediaOrHome();

    if (window.logger) {
      window.logger.logAction(
        `等待指令 - ${unit.unit_name || unitId}：${
          step.step_name || step.step_id
        }`,
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
    this.flow.showCurrentStepMediaOrHome();
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
      this.power.handleExperimentEnd();
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
          autoplay: true,
        },
      );
      if (window.logger) {
        window.logger.logAction("回到首頁");
      }
    }
  }

  /** 檢查並處理沒有交互操作的步驟自動進展 */
  checkAutoProgressionForEmptyInteractions(step, unit) {
    // 所有進展都由 ActionManager 管理
    return;
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
    this.units.renderDefaultSequences();
    this.renderUnitList();
    // 初始化後自動套用預設組合
    this.units.selectDefaultCombination();
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
        data,
      );
    }
  }

  /**
   * 初始化動作管理器
   * 用於同步狀態下接收遠端按鈕動作並更新UI
   */
  initializeActionManager() {
    // 如果 SyncManager 還沒初始化，等待初始化完成
    if (!window.syncManager?.initialized) {
      Logger.debug(
        "SyncManager 未初始化，等待初始化事件再初始化 ActionManager",
      );
      const handleInitialized = () => {
        Logger.debug("收到初始化事件，初始化 ActionManager");
        this.createActionManager();
        document.removeEventListener("CLIENT_INITIALIZED", handleInitialized);
      };
      document.addEventListener("CLIENT_INITIALIZED", handleInitialized, {
        once: true,
      });
      return;
    }

    // SyncManager 已初始化，直接創建 ActionManager
    this.createActionManager();
  }

  /**
   * 創建動作管理器實例
   */
  createActionManager() {
    if (window.ActionManager) {
      // 新的統一ActionManager會自動初始化
      Logger.debug("ActionManager 已準備就緒");
    }
  }

  /**
   * 代理方法：將 window.experiment.updateHighlightVisibility() 委派給 ui 模組
   */
  updateHighlightVisibility() {
    if (this.ui && typeof this.ui.updateHighlightVisibility === "function") {
      return this.ui.updateHighlightVisibility();
    }
    Logger.warn("ui.updateHighlightVisibility 方法不可用");
  }
}

// 匯出主面板實驗管理器單例
window.panelExperiment = new PanelExperimentManager();

// 向後相容性：也暴露為 experiment
window.experiment = window.panelExperiment;
