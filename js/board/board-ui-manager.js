/**
 * BoardUIManager - 管理 board 頁面的 UI 與互動
 *
 * 負責處理受試者名稱輸入、按鈕事件、拖拽功能等 UI 互動，
 * 並將實驗控制邏輯委派給 ExperimentSystemManager 處理。
 */

class BoardUIManager {
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

    Logger.debug("BoardUIManager 初始化完成");
  }

  /**
   * 設置UI事件監聽器
   */
  setupEventListeners() {
    // 實驗ID 輸入框事件由 ExperimentSystemManager 統一管理
    // 此處不重複綁定 setupExperimentIdInput()

    // 受試者名稱輸入框事件
    this.setupParticipantNameInput();

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
   * 設定受試者名稱輸入框事件
   */
  setupParticipantNameInput() {
    const participantNameInput = document.getElementById(
      "participantNameInput",
    );
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

    const isHidden = detail.classList.contains("is-hidden");
    if (isHidden) {
      detail.classList.remove("is-hidden");
      toggle.style.transform = "rotate(180deg)";
    } else {
      detail.classList.add("is-hidden");
      toggle.style.transform = "rotate(0deg)";
    }
  }

  /**
   * 渲染統一UI
   */
  async renderUnifiedUI() {
    try {
      // 確保數據已經載入
      if (!this.core.scriptData) {
        await this.core.loadScenarioData();
      }

      // 如果有實驗系統管理器，使用它來渲染UI
      if (window.experimentSystemManager) {
        await window.experimentSystemManager.initializeUI(
          {
            combinationSelector: "#combinationSelectorContainer",
            unitPanel: "#unitsPanelContainer",
            experimentControls: "#experimentControlsContainer",
          },
          this.core.scriptData,
        );

        // 初始化 Panel UI 組件（包括實驗日誌面板）
        try {
          if (typeof this.core.uiManager.initializePanelUI === "function") {
            await this.core.uiManager.initializePanelUI();
          }
        } catch (e) {
          Logger.warn("初始化 Panel UI 失敗", e);
        }

        Logger.debug("使用 ExperimentSystemManager 渲染UI完成");
        return;
      }

      // ExperimentSystemManager 不可用，拋出錯誤
      throw new Error("ExperimentSystemManager 不可用，無法渲染UI");
    } catch (error) {
      Logger.error("渲染統一UI失敗:", error);
      throw error;
    }
  }

  /**
   * 渲染手勢類型參考面板
   */
  renderGestureTypesReference() {
    const leftPanel = document.querySelector(".left-panel");
    if (
      !leftPanel ||
      !this.core.scenariosData ||
      !this.core.scenariosData.gesture_list
    )
      return;

    // 檢查是否已經存在，避免重複新增
    let refDiv = document.querySelector(".gesture-reference");
    if (refDiv) {
      refDiv.remove();
    }

    const gestureTypes = this.core.scenariosData.gesture_list;

    refDiv = document.createElement("div");
    refDiv.className = "gesture-reference";
    refDiv.style.marginTop = "20px";
    refDiv.innerHTML = `
            <h2 style="cursor: pointer; display: flex; align-items: center; color: #2c3e50; margin-bottom: 12px; font-weight: 700;"
                onclick="document.querySelector('.gesture-types-list').style.display =
                document.querySelector('.gesture-types-list').style.display === 'none' ? 'block' : 'none'">
                手勢參考 <span style="font-size: 12px; margin-left: auto;">▼</span>
            </h2>
            <div class="gesture-types-list" style="display: none;">
                ${gestureTypes
                  .map(
                    (g) => `
                    <div class="gesture-type-item">
                        <span class="gesture-type-code">${g.gesture_id}</span>
                        <span class="gesture-type-name">${g.gesture_name}</span>
                        <span class="gesture-type-desc">${g.gesture_description}</span>
                        <span style="font-size: 11px; color: #999; margin-left: auto;">${g.gesture_key}</span>
                    </div>
                `,
                  )
                  .join("")}
            </div>
        `;

    leftPanel.appendChild(refDiv);
  }

  /**
   * 清理資源
   */
  destroy() {
    // 移除事件監聽器
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("dragstart", this.handleDragStart);
    document.removeEventListener("dragend", this.handleDragEnd);
    document.removeEventListener("drop", this.handleDrop);

    Logger.debug("BoardUIManager 已清理");
  }
}

// 匯出到全局作用域
window.BoardUIManager = BoardUIManager;
