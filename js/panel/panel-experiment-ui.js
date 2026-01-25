/**
 * PanelExperimentUI - 面板實驗UI管理器
 *
 * 負責所有UI狀態的更新、管理和初始化
 * 包括按鈕狀態、視覺提示、鎖定控制、事件監聽器設置等
 */
class PanelExperimentUI {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
  }

  /**
   * 主初始化方法
   */
  initialize() {
    // 初始化順序：先設定ID，再初始化UI（包括設定組合）
    this.setupEventListeners();
    this.setupExperimentIdEvents(); // 設定實驗ID相關事件
    this.initializeExperimentId(); // 初始化實驗ID
    this.initializePowerOptions();
    this.initializeExperimentUI(); // 最後初始化UI和設定預設組合（此時ID已準備好）
  }

  /**
   * 更新實驗UI狀態
   */
  updateExperimentUI() {
    // 更新停止按鈕狀態（開始按鈕在實驗進行時會被隱藏）
    const stopBtn = this.manager.getCachedElement("stopExperimentBtn");

    if (stopBtn) {
      stopBtn.disabled = !this.manager.isExperimentRunning;
    }

    // 更新暫停指示器
    const pauseIndicator = this.manager.getCachedElement("pauseIndicator");
    if (pauseIndicator) {
      pauseIndicator.style.display = this.manager.timer.isPaused()
        ? "block"
        : "none";
      pauseIndicator.textContent = this.manager.timer.isPaused()
        ? "⏸ 暫停中"
        : "";
    }
  }

  /**
   * 更新按鈕狀態：根據角色禁用/啟用按鈕
   */
  updateButtonStates() {
    // 如果 SyncManager 還沒初始化，等待 CLIENT_INITIALIZED 事件
    if (!window.syncManager?.initialized) {
      Logger.debug("SyncManager 未初始化，等待 CLIENT_INITIALIZED 事件");
      const handleInitialized = () => {
        Logger.debug("收到 CLIENT_INITIALIZED 事件，更新按鈕狀態");
        this.updateButtonStates();
        document.removeEventListener("CLIENT_INITIALIZED", handleInitialized);
      };
      document.addEventListener("CLIENT_INITIALIZED", handleInitialized, {
        once: true
      });
      return;
    }

    const isViewer =
      window.syncManager?.core?.syncClient?.role ===
      window.SyncManager?.ROLE?.VIEWER;
    const buttonsToDisable = [
      "startExperimentBtn",
      "pauseExperimentBtn",
      "stopExperimentBtn",
      "regenerateIdButton"
    ];

    Logger.debug("updateButtonStates", {
      isViewer,
      role: window.syncManager?.core?.syncClient?.role
    });

    buttonsToDisable.forEach((buttonId) => {
      const button = this.manager.getCachedElement(buttonId);
      if (button) {
        if (isViewer) {
          button.disabled = true;
          button.classList.add("disabled");
          button.title = "檢視模式下無法操作";
        } else {
          button.disabled = false;
          button.classList.remove("disabled");
          button.title = "";
        }
      }
    });
  }

  /**
   * 更新所有綠色高亮提示的可見性
   */
  updateHighlightVisibility() {
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const showHighlight = toggleTouchVisuals && toggleTouchVisuals.checked;

    // 如果視覺提示被關閉，清除所有高亮
    if (!showHighlight) {
      const powerSwitchArea = document.getElementById("powerSwitchArea");
      if (powerSwitchArea) {
        powerSwitchArea.classList.remove("next-step-highlight");
      }
      document.querySelectorAll(".button-overlay").forEach((btn) => {
        btn.classList.remove("next-step-highlight");
      });
      return;
    }

    // 視覺提示開啟時，才檢查實驗狀態並顯示高亮
    // 實驗進行中時，需要檢查：
    // 1. 如果是第一步（開機步驟），顯示高亮
    // 2. 如果不是第一步但機器未開機，清除高亮
    if (this.manager.isExperimentRunning) {
      const isFirstStep =
        this.manager.currentStepIndex === 0 &&
        this.manager.currentScenario?.steps?.[0]?.step_id?.includes("_1");

      if (
        !isFirstStep &&
        window.powerControl &&
        !window.powerControl.isPowerOn
      ) {
        // 機器未開機且不是開機步驟，清除高亮
        const powerSwitchArea = document.getElementById("powerSwitchArea");
        if (powerSwitchArea) {
          powerSwitchArea.classList.remove("next-step-highlight");
        }
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          btn.classList.remove("next-step-highlight");
        });
        return;
      }

      // 實驗進行中且視覺提示開啟，保持高亮（由其他方法控制具體哪些按鈕高亮）
      return;
    }

    // 實驗未進行時，清除所有高亮
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.remove("next-step-highlight");
    }
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
    });
  }

  /**
   * 鎖定/解鎖單元列表
   */
  lockUnitList(lock) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;
    Array.from(unitList.children).forEach((li) => {
      const checkbox = li.querySelector("input[type=\"checkbox\"]");
      if (checkbox) checkbox.disabled = lock;
      const upBtn = li.querySelector(".unit-sort-btn[title=\"上移\"]");
      const downBtn = li.querySelector(".unit-sort-btn[title=\"下移\"]");
      if (upBtn) upBtn.disabled = lock;
      if (downBtn) downBtn.disabled = lock;
      const dragHandle = li.querySelector(".unit-drag-handle");
      if (dragHandle) dragHandle.style.pointerEvents = lock ? "none" : "";
    });
  }

  /**
   * 鎖定/解鎖實驗ID輸入框
   */
  lockExperimentId(lock) {
    const _experimentIdInput = document.getElementById("experimentIdInput");
    const _regenerateIdButton = document.getElementById("regenerateIdButton");
    const experimentIdInputGroup = document.querySelector(
      ".experiment-id-input-group"
    );

    Logger.debug(
      `lockExperimentId(${lock}) - InputGroup found:`,
      !!experimentIdInputGroup
    );

    if (lock) {
      // 實驗開始時，將實驗ID轉換為徽章樣式
      const currentId = this.manager.getCurrentExperimentId();
      if (experimentIdInputGroup) {
        Logger.debug("鎖定實驗ID - 轉換為徽章樣式");
        experimentIdInputGroup.innerHTML = `
                    <label>實驗ID</label>
                    <div class="experiment-id-badge">${currentId}</div>
                    <div id="experimentTimer" class="experiment-timer">花費時間：00:00</div>
                `;
      }
    } else {
      // 實驗結束時，還原輸入框
      if (experimentIdInputGroup) {
        experimentIdInputGroup.innerHTML = `
                    <label for="experimentIdInput">實驗ID</label>
                    <input type="text" id="experimentIdInput" class="experiment-id-input" maxlength="10" placeholder="載入中...">
                    <button id="regenerateIdButton" class="regenerate-id-btn" title="重新產生ID">重新產生</button>
                    <div id="experimentTimer" class="experiment-timer">花費時間：00:00</div>
                `;
        // 重新設定事件監聽器（在 UI 模組內綁定）
        this.setupExperimentIdEvents();
        // 保持目前實驗ID，不要重新產生
        const newInput = document.getElementById("experimentIdInput");
        if (newInput && this.manager.currentExperimentId) {
          newInput.value = this.manager.currentExperimentId;
        }
      }
    }
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    this.setupExperimentControls();
    this.setupSyncEventListeners();
  }

  /**
   * 設定同步事件監聽器
   */
  setupSyncEventListeners() {
    // 同步事件監聽器
    const syncEvents = {
      experimentStateUpdate: (data) =>
        this.manager.handleSyncExperimentState(data),
      deviceModeChanged: (data) => this.manager.handleDeviceModeChanged(data),
      experimentIdUpdate: (data) =>
        this.manager.sync.handleRemoteExperimentIdUpdate(data),
      subjectNameUpdate: (data) =>
        this.manager.sync.handleRemoteSubjectNameUpdate(data),
      experimentStart: (data) =>
        this.manager.sync.handleRemoteExperimentStart(data),
      experimentStop: (data) =>
        this.manager.sync.handleRemoteExperimentStop(data),
      experimentPause: (data) =>
        this.manager.sync.handleRemoteExperimentPause(data),
      experimentResume: (data) =>
        this.manager.sync.handleRemoteExperimentResume(data),
      powerOn: (data) => this.manager.sync.handleRemotePowerOn(data),
      powerOff: (data) => this.manager.sync.handleRemotePowerOff(data),
      unitSelectionUpdate: (data) =>
        this.manager.sync.handleRemoteUnitSelectionUpdate(data),
      combinationUpdate: (data) =>
        this.manager.sync.handleRemoteCombinationUpdate(data),
      stepNavigation: (data) =>
        this.manager.sync.handleRemoteStepNavigation(data),
      mediaControl: (data) => this.manager.sync.handleRemoteMediaControl(data),
      uiStateUpdate: (data) =>
        this.manager.sync.handleRemoteUIStateUpdate(data),
      experimentReset: (data) =>
        this.manager.sync.handleRemoteExperimentReset(data)
    };

    // 註冊同步事件
    Object.entries(syncEvents).forEach(([event, handler]) => {
      window.addEventListener(`sync_${event}`, (e) => handler(e.detail));
    });

    // 廣播事件監聽器
    window.addEventListener("experiment_id_broadcasted", (e) => {
      if (e.detail?.experimentId) {
        this.manager.handleRemoteExperimentIdUpdate({
          experimentId: e.detail.experimentId,
          source: e.detail.source || "broadcast"
        });
      }
    });

    window.addEventListener("subject_name_broadcasted", (e) => {
      if (e.detail?.subjectName) {
        this.manager.handleRemoteSubjectNameUpdate({
          subjectName: e.detail.subjectName,
          source: e.detail.source || "broadcast"
        });
      }
    });

    // 同步狀態恢復事件
    window.addEventListener("sync_state_restored", (event) => {
      this.manager.initializeFromSync(event.detail);
    });

    Logger.debug("同步事件監聽器設定完成");
  }

  /**
   * 設定實驗控制項
   */
  setupExperimentControls() {
    // 防止重複初始化
    if (this._experimentControlsInitialized) {
      Logger.debug("實驗控制項已初始化，跳過");
      return;
    }

    this._experimentControlsInitialized = true;

    // 開始實驗按鈕
    const startButton = this.manager.getCachedElement("startExperimentBtn");
    if (startButton) {
      startButton.addEventListener("click", () => {
        this.manager.startExperiment();
      });
    }

    // 關閉面板按鈕
    const closeButton = this.manager.getCachedElement("closeExperimentPanel");
    if (closeButton) {
      closeButton.addEventListener("click", () => {
        this.manager.closeExperimentPanel();
      });
    }

    // 電源按鈕事件
    const powerButton = this.manager.getCachedElement("powerButton");
    if (powerButton) {
      powerButton.addEventListener("click", () => {
        this.manager.power.handlePowerToggle();
      });
    }

    // 電源狀態變化監聽
    window.addEventListener("power_state_changed", (event) => {
      this.manager.onPowerStateChanged(event.detail.isPowerOn);
    });

    // 單元選擇相關事件
    this.setupUnitSelectionEvents();

    // 組合選擇相關事件
    this.setupCombinationEvents();

    // 媒體控制事件
    this.setupMediaControlEvents();

    Logger.debug("實驗控制項設定完成");
  }

  /**
   * 設定單元選擇事件
   */
  setupUnitSelectionEvents() {
    // 全選/取消全選
    const selectAllCheckbox = this.manager.getCachedElement("selectAllUnits");
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener("change", (e) => {
        this.manager.units.toggleSelectAllUnits(e.target.checked);
      });
    }

    // 單元checkbox事件（使用事件委派）
    const unitList = this.manager.getCachedElement("experiment-units-list");
    if (unitList) {
      unitList.addEventListener("change", (e) => {
        if (e.target.matches("input[name=\"unitCheckbox\"]")) {
          this.manager.ui.updateUnitSelectionUI();
          this.manager.updateSelectAllState();
        }
      });
    }
  }

  /**
   * 設定組合選擇事件
   */
  setupCombinationEvents() {
    // 組合卡片點擊事件（使用事件委派）
    document.addEventListener("click", (e) => {
      const combinationItem = e.target.closest(".combination-item");
      if (combinationItem) {
        const combinationId = combinationItem.dataset.combinationId;
        const combination = window.combinationsData?.find(
          (c) => c.combination_id === combinationId
        );
        if (combination) {
          this.manager.units.handleCombinationSelection(combination);
        }
      }
    });
  }

  /**
   * 設定媒體控制事件
   */
  setupMediaControlEvents() {
    // 媒體結束事件
    window.addEventListener("media_ended", () => {
      this.manager.media.handleMediaEnd();
    });

    // 媒體錯誤事件
    window.addEventListener("media_error", (event) => {
      Logger.error("媒體播放錯誤:", event.detail?.error);
    });
  }

  /**
   * 設定實驗ID相關事件
   */
  setupExperimentIdEvents() {
    const experimentIdInput =
      this.manager.getCachedElement("experimentIdInput");
    const regenerateIdButton =
      this.manager.getCachedElement("regenerateIdButton");

    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        this.manager.currentExperimentId = e.target.value;
        this.manager.updateExperimentIdDisplay();
      });

      experimentIdInput.addEventListener("blur", () => {
        // 當輸入框失去焦點時，廣播新的實驗ID
        if (this.manager.currentExperimentId) {
          this.manager.broadcastExperimentId();
        }
      });
    }

    if (regenerateIdButton) {
      regenerateIdButton.addEventListener("click", () => {
        this.manager.generateNewExperimentId();
      });
    }
  }

  /**
   * 初始化實驗ID
   */
  async initializeExperimentId() {
    try {
      let experimentId = null;

      // 第1步：檢查是否在同步模式，優先從中樞取得
      if (window.experimentHubManager?.hubClient) {
        try {
          experimentId =
            await window.experimentHubManager.hubClient.getExperimentId();
          if (experimentId) {
            Logger.debug(`第1優先：從中樞取得實驗ID: ${experimentId}`);
            this.manager.currentExperimentId = experimentId;
            if (window.experimentStateManager) {
              window.experimentStateManager.syncExperimentIdWithInput(
                experimentId
              );
            }
            return;
          }
        } catch (e) {
          Logger.debug(`中樞讀取失敗，嘗試其他來源: ${e.message}`);
        }
      }

      // 第2步：檢查快照ID（非同步模式優先）
      if (window.experimentStateManager?.experimentId) {
        experimentId = window.experimentStateManager.experimentId;
        Logger.debug(`第2優先：使用快照ID: ${experimentId}`);
        this.manager.currentExperimentId = experimentId;
        this.manager.updateExperimentIdDisplay();
        return;
      }

      // 第3步：檢查輸入框是否已有值
      const inputId = window.experimentStateManager?.getInputExperimentId();
      if (inputId) {
        experimentId = inputId;
        Logger.debug(`第3優先：使用輸入框ID: ${experimentId}`);
        this.manager.currentExperimentId = experimentId;
        if (window.experimentStateManager) {
          window.experimentStateManager.syncExperimentIdWithInput(experimentId);
        }
        return;
      }

      // 第4步：都沒有ID，產生新ID
      Logger.debug("第4步：產生新ID");
      this.manager.generateNewExperimentId();
    } catch (e) {
      Logger.warn("初始化實驗ID失敗，即將產生新ID:", e);
      this.manager.generateNewExperimentId();
    }
  }

  /**
   * 初始化電源選項
   */
  initializePowerOptions() {
    const includeStartup = this.manager.getCachedElement("includeStartup");
    const includeShutdown = this.manager.getCachedElement("includeShutdown");

    if (includeStartup) {
      includeStartup.checked = this.manager.includeStartup;
      includeStartup.addEventListener("change", (e) => {
        this.manager.includeStartup = e.target.checked;
        Logger.debug(`電源啟動選項: ${e.target.checked ? "啟用" : "停用"}`);
      });
    }

    if (includeShutdown) {
      includeShutdown.checked = this.manager.includeShutdown;
      includeShutdown.addEventListener("change", (e) => {
        this.manager.includeShutdown = e.target.checked;
        Logger.debug(`電源關閉選項: ${e.target.checked ? "啟用" : "停用"}`);
      });
    }
  }

  /**
   * 初始化實驗UI
   */
  initializeExperimentUI() {
    // 載入並渲染單元列表
    this.manager.units.renderUnitList();

    // 載入並渲染預設組合
    this.manager.renderDefaultSequences();

    // 初始化UI狀態
    this.manager.ui.initializeUI();

    // 設定預設組合（如果有的話）
    this.manager.applyDefaultCombination();

    Logger.debug("實驗UI初始化完成");
  }

  /**
   * 生成新的實驗ID
   */
  generateNewExperimentId() {
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:-]/g, "");
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newId = `EXP${timestamp}${random}`;

    this.manager.currentExperimentId = newId;
    this.updateExperimentIdDisplay();

    // 廣播新的實驗ID
    this.broadcastExperimentId();

    Logger.info(`生成新實驗ID: ${newId}`);
    return newId;
  }

  /**
   * 更新實驗ID顯示
   */
  updateExperimentIdDisplay() {
    const experimentIdInput =
      this.manager.getCachedElement("experimentIdInput");
    const experimentIdDisplay = this.manager.getCachedElement(
      "experimentIdDisplay"
    );

    if (experimentIdInput && this.manager.currentExperimentId) {
      experimentIdInput.value = this.manager.currentExperimentId;
    }

    if (experimentIdDisplay && this.manager.currentExperimentId) {
      experimentIdDisplay.textContent = this.manager.currentExperimentId;
    }
  }

  /**
   * 取得當前實驗ID
   */
  getCurrentExperimentId() {
    return this.manager.currentExperimentId;
  }

  /**
   * 廣播實驗ID
   */
  broadcastExperimentId() {
    if (!this.manager.currentExperimentId) return;

    // 發送廣播事件
    window.dispatchEvent(
      new CustomEvent("experiment_id_broadcasted", {
        detail: {
          experimentId: this.manager.currentExperimentId,
          source: this.manager.clientId,
          timestamp: new Date().toISOString()
        }
      })
    );

    // 如果在同步模式下，發送同步事件
    if (window.syncManager?.isActive) {
      window.syncManager.broadcast("experiment_id_update", {
        experimentId: this.manager.currentExperimentId,
        source: this.manager.clientId,
        timestamp: new Date().toISOString()
      });
    }

    Logger.debug(`廣播實驗ID: ${this.manager.currentExperimentId}`);
  }

  /**
   * 處理遠端實驗ID更新
   */
  handleRemoteExperimentIdUpdate(data) {
    if (!data?.experimentId) return;

    const oldId = this.manager.currentExperimentId;
    this.manager.currentExperimentId = data.experimentId;

    // 如果實驗正在運行，排程更新
    if (this.manager.isExperimentRunning) {
      this.manager.pendingExperimentIdUpdate = data.experimentId;
      Logger.info(`實驗運行中，排程ID更新: ${data.experimentId}`);
    } else {
      this.updateExperimentIdDisplay();
      Logger.info(`遠端實驗ID更新: ${oldId} -> ${data.experimentId}`);
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `ID變更(${oldId} -> ${data.experimentId})`,
        "experiment_id_update",
        data.experimentId,
        false,
        false
      );
    }
  }

  /**
   * 處理遠端受試者名稱更新
   */
  handleRemoteSubjectNameUpdate(data) {
    if (!data?.subjectName) return;

    const oldName = this.manager.currentSubjectName || "";
    this.manager.currentSubjectName = data.subjectName;

    // 如果實驗正在運行，排程更新
    if (this.manager.isExperimentRunning) {
      this.manager.pendingSubjectNameUpdate = data.subjectName;
      Logger.info(`實驗運行中，排程受試者名稱更新: ${data.subjectName}`);
    } else {
      this.updateSubjectNameDisplay();
      Logger.info(`遠端受試者名稱更新: ${oldName} -> ${data.subjectName}`);
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `受試者變更(${oldName} -> ${data.subjectName})`,
        "subject_name_update",
        data.subjectName,
        false,
        false
      );
    }
  }

  /**
   * 更新受試者名稱顯示
   */
  updateSubjectNameDisplay() {
    const subjectNameInput = this.manager.getCachedElement("subjectNameInput");
    const subjectNameDisplay =
      this.manager.getCachedElement("subjectNameDisplay");

    if (subjectNameInput && this.manager.currentSubjectName) {
      subjectNameInput.value = this.manager.currentSubjectName;
    }

    if (subjectNameDisplay && this.manager.currentSubjectName) {
      subjectNameDisplay.textContent = this.manager.currentSubjectName;
    }
  }

  /**
   * 應用待定的ID更新
   */
  applyPendingIdUpdates() {
    if (this.manager.pendingExperimentIdUpdate) {
      this.manager.currentExperimentId = this.manager.pendingExperimentIdUpdate;
      this.updateExperimentIdDisplay();
      Logger.info(
        `應用待定實驗ID更新: ${this.manager.pendingExperimentIdUpdate}`
      );
      this.manager.pendingExperimentIdUpdate = null;
    }

    if (this.manager.pendingSubjectNameUpdate) {
      this.manager.currentSubjectName = this.manager.pendingSubjectNameUpdate;
      this.updateSubjectNameDisplay();
      Logger.info(
        `應用待定受試者名稱更新: ${this.manager.pendingSubjectNameUpdate}`
      );
      this.manager.pendingSubjectNameUpdate = null;
    }
  }

  /**
   * 從同步狀態恢復ID
   */
  restoreFromSyncState(syncState) {
    if (syncState?.experimentId) {
      this.manager.currentExperimentId = syncState.experimentId;
      this.updateExperimentIdDisplay();
      Logger.info(`從同步狀態恢復實驗ID: ${syncState.experimentId}`);
    }

    if (syncState?.subjectName) {
      this.manager.currentSubjectName = syncState.subjectName;
      this.updateSubjectNameDisplay();
      Logger.info(`從同步狀態恢復受試者名稱: ${syncState.subjectName}`);
    }
  }
}

// 匯出UI管理器類別（實例化時需要傳入manager）
window.PanelExperimentUI = PanelExperimentUI;
