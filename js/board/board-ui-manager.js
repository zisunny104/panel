/**
 * ExperimentUIManager - 實驗UI管理器
 * 負責處理所有UI相關的操作和事件
 *
 * 注意：使用 experiment-utils.js 中通過 window 暴露的全局函數
 */

class ExperimentUIManager {
  constructor(coreManager) {
    this.core = coreManager;
    this.initialized = false;
  }

  /**
   * 初始化UI管理器
   */
  init() {
    if (this.initialized) return;

    this.setupEventListeners();
    this.exposeGlobalFunctions();
    this.initialized = true;

    Logger.debug("ExperimentUIManager 初始化完成");
  }

  /**
   * 設置UI事件監聽器
   */
  setupEventListeners() {
    // 實驗ID輸入框事件
    this.setupExperimentIdInput();

    // 受試者名稱輸入框事件
    this.setupParticipantNameInput();

    // 按鈕事件
    this.setupButtonEvents();

    // 拖拽功能
    this.setupDragAndDrop();

    // 鍵盤事件
    this.setupKeyboardEvents();
  }

  /**
   * 暴露全域函數供 HTML 調用
   */
  exposeGlobalFunctions() {
    // UI 控制函數
    window.toggleLeftPanel = this.toggleLeftPanel.bind(this);
    window.toggleGestureStats = this.toggleGestureStats.bind(this);
  }

  /**
   * 設置實驗ID輸入框事件
   */
  setupExperimentIdInput() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        this.core.experimentId = e.target.value;
      });

      experimentIdInput.addEventListener("change", async (e) => {
        const newExperimentId = e.target.value;
        if (newExperimentId && this.core.syncHandler) {
          await this.handleExperimentIdChange(newExperimentId);
        }
      });
    }

    // 重新產生按鈕
    const regenerateIdBtn = document.getElementById("regenerateIdBtn");
    if (regenerateIdBtn) {
      regenerateIdBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.smartRegenerateExperimentId();
      });
    }
  }

  /**
   * 處理實驗ID變更
   */
  async handleExperimentIdChange(newExperimentId) {
    try {
      // 驗證實驗ID格式
      if (!this.validateExperimentId(newExperimentId)) {
        alert("實驗ID格式無效");
        return;
      }

      // 更新核心管理器的實驗ID
      this.core.experimentId = newExperimentId;

      // 如果有腳本資料，重新載入
      if (this.core.currentCombination && this.core.scriptData) {
        const combination = this.core.scriptData.combinations.find(
          (c) =>
            c.combination_id === this.core.currentCombination.combination_id,
        );
        if (combination) {
          await this.core.loadScriptForCombination(
            combination,
            newExperimentId,
          );
        }
      }

      // 廣播更新
      if (this.core.syncHandler) {
        this.core.syncHandler.broadcastExperimentIdUpdate(newExperimentId);
      }

      Logger.debug(`實驗ID已更新為: ${newExperimentId}`);
    } catch (error) {
      Logger.error("更新實驗ID失敗:", error);
      alert("更新實驗ID時發生錯誤");
    }
  }

  /**
   * 智能重新產生實驗ID
   */
  async smartRegenerateExperimentId() {
    const result = RandomUtils.generateNewExperimentId();

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.value = result;
    }

    await this.handleExperimentIdChange(result);
  }

  /**
   * 驗證實驗ID格式
   */
  validateExperimentId(experimentId) {
    // 基本驗證：不為空，至少3個字符
    return experimentId && experimentId.length >= 3;
  }

  /**
   * 設置受試者名稱輸入框事件
   */
  setupParticipantNameInput() {
    const participantNameInput = document.getElementById("participantName");
    if (participantNameInput) {
      participantNameInput.addEventListener("input", (e) => {
        this.core.participantName = e.target.value;
      });

      participantNameInput.addEventListener("change", (e) => {
        this.handleParticipantNameChange(e.target.value);
      });
    }
  }

  /**
   * 處理受試者名稱變更
   */
  handleParticipantNameChange(newName) {
    this.core.participantName = newName;

    // 廣播更新
    if (this.core.syncHandler && this.core.syncHandler.isConnected) {
      // 實現廣播邏輯
    }

    this.core.logAction("participant_name_updated", {
      participant_name: newName,
      clientId: this.core.getClientId(),
    });
  }

  /**
   * 設置按鈕事件
   */
  setupButtonEvents() {
    // 全域函數已由 experiment-utils.js 暴露到 window
    // 無需再次綁定
  }

  /**
   * 設置拖拽功能
   */
  setupDragAndDrop() {
    // 實現拖拽功能
    document.addEventListener("dragstart", (e) => {
      if (e.target.classList.contains("draggable")) {
        this.core.draggedElement = e.target;
        e.dataTransfer.effectAllowed = "move";
      }
    });

    document.addEventListener("dragend", (e) => {
      this.core.draggedElement = null;
    });

    document.addEventListener("drop", (e) => {
      e.preventDefault();
      // 處理放置邏輯
    });
  }

  /**
   * 設置鍵盤事件
   */
  setupKeyboardEvents() {
    document.addEventListener("keydown", (e) => {
      this.handleKeyDown(e);
    });

    document.addEventListener("keyup", (e) => {
      this.handleKeyUp(e);
    });
  }

  /**
   * 處理鍵盤按下事件
   */
  handleKeyDown(e) {
    // 實現鍵盤快捷鍵邏輯
    switch (e.key) {
      case " ":
        e.preventDefault();
        // 空格鍵：暫停/繼續實驗
        if (this.core.stateManager) {
          this.core.stateManager.toggleExperiment();
        }
        break;
      case "Escape":
        // ESC鍵：停止實驗
        if (this.core.stateManager) {
          this.core.stateManager.stopExperiment();
        }
        break;
    }
  }

  /**
   * 處理鍵盤釋放事件
   */
  handleKeyUp(e) {
    // 處理鍵盤釋放邏輯
  }

  /**
   * 處理遠端動作
   */
  handleRemoteAction(detail) {
    Logger.debug("UI管理器處理遠端動作", detail);

    // 根據動作類型處理UI更新
    switch (detail.action_type) {
      case "button_press":
        this.simulateButtonPress(detail.button_id);
        break;
      case "gesture_mark":
        this.updateGestureDisplay(detail);
        break;
      default:
        Logger.debug("未知的遠端動作類型:", detail.action_type);
    }
  }

  /**
   * 模擬按鈕按下
   */
  simulateButtonPress(buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.click();
    }
  }

  /**
   * 更新手勢顯示
   */
  updateGestureDisplay(data) {
    // 更新手勢統計顯示
    if (this.core.gestureStats && data.gesture_name) {
      // 更新統計資料
    }
  }

  /**
   * 渲染手勢統計列表
   */
  renderGestureStats() {
    // 實現手勢統計渲染邏輯
  }

  /**
   * 切換左側面板的展開或收起狀態
   */
  toggleLeftPanel() {
    const leftPanel = document.querySelector(".left-panel");
    const toggleBtn = document.getElementById("panelToggleBtn");

    leftPanel.classList.toggle("collapsed");
    toggleBtn.classList.toggle("collapsed");
  }

  /**
   * 切換手勢統計詳細資訊的顯示或隱藏
   */
  toggleGestureStats() {
    const detail = document.getElementById("gestureStatsDetail");
    const toggle = document.getElementById("gestureStatsToggle");

    if (detail.style.display === "none") {
      detail.style.display = "block";
      toggle.style.transform = "rotate(180deg)";
    } else {
      detail.style.display = "none";
      toggle.style.transform = "rotate(0deg)";
    }
  }

  /**
   * 清理資源
   */
  destroy() {
    // 移除事件監聽器
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("dragstart", this.handleDragStart);
    document.removeEventListener("dragend", this.handleDragEnd);
    document.removeEventListener("drop", this.handleDrop);

    Logger.debug("ExperimentUIManager 已清理");
  }
}

// 匯出
export { ExperimentUIManager };
