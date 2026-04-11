/**
 * BoardUIManager - 管理 board 頁面的 UI 與互動
 *
 * 負責受試者名稱輸入、按鈕事件、拖曳功能等互動，
 * 並將實驗控制邏輯委派給 ExperimentSystemManager 處理。
 */

export const BoardUIManager = class BoardUIManager {
  /**
   * @param {Object} coreManager - BoardPageManager 實例
   */
  constructor(coreManager) {
    this.core = coreManager;
    this.initialized = false;
    this.participantNameInput = null;
    this._onParticipantInput = null;
    this._onParticipantChange = null;
    this._onDragStart = null;
    this._onDragEnd = null;
    this._onDrop = null;
    this._onKeyDown = null;
  }

  /**
   * 初始化 UI 管理器
   */
  init() {
    if (this.initialized) return;

    const initStart = performance.now();

    this.setupEventListeners();
    this.initialized = true;

    const duration = performance.now() - initStart;
    Logger.debug(
      `BoardUIManager 初始化完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 設定 UI 事件監聽器
   */
  setupEventListeners() {
    this.setupParticipantNameInput();
    this.setupDragAndDrop();
    this.setupKeyboardEvents();
    this.setupPanelToggleButton();
  }

  /**
   * 設定受試者名稱輸入框事件
   */
  setupParticipantNameInput() {
    const participantNameInput = document.getElementById(
      "participantNameInput",
    );
    if (participantNameInput) {
      this.participantNameInput = participantNameInput;
      this._onParticipantInput = (e) => {
        this.core.participantName = e.target.value;
      };
      this._onParticipantChange = (e) => {
        this.handleParticipantNameChange(e.target.value);
      };

      participantNameInput.addEventListener("input", this._onParticipantInput);
      participantNameInput.addEventListener(
        "change",
        this._onParticipantChange,
      );
    }
  }

  /**
   * 處理受試者名稱變更
   * @param {string} newName - 新的受試者名稱
   */
  handleParticipantNameChange(newName) {
    this.core.participantName = newName;
    if (this.core.syncHandler && this.core.syncHandler.isConnected) {
    }

    this.core.logAction("participant_name_updated", {
      participant_name: newName,
      clientId: this.core.getClientId(),
    });
  }

  /**
   * 設定拖曳功能
   */
  setupDragAndDrop() {
    this._onDragStart = (e) => {
      if (e.target.classList.contains("draggable")) {
        this.core.draggedElement = e.target;
        e.dataTransfer.effectAllowed = "move";
      }
    };

    this._onDragEnd = () => {
      this.core.draggedElement = null;
    };

    this._onDrop = (e) => {
      e.preventDefault();
    };

    document.addEventListener("dragstart", this._onDragStart);
    document.addEventListener("dragend", this._onDragEnd);
    document.addEventListener("drop", this._onDrop);
  }

  /**
   * 設定鍵盤事件
   */
  setupKeyboardEvents() {
    this._onKeyDown = (e) => {
      this.handleKeyDown(e);
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  setupPanelToggleButton() {
    const panelToggleBtn = document.getElementById("panelToggleBtn");
    if (!panelToggleBtn) return;
    panelToggleBtn.addEventListener("click", () => this.toggleLeftPanel());
  }

  destroy() {
    if (this.participantNameInput) {
      if (this._onParticipantInput) {
        this.participantNameInput.removeEventListener(
          "input",
          this._onParticipantInput,
        );
      }
      if (this._onParticipantChange) {
        this.participantNameInput.removeEventListener(
          "change",
          this._onParticipantChange,
        );
      }
    }

    if (this._onDragStart) {
      document.removeEventListener("dragstart", this._onDragStart);
    }
    if (this._onDragEnd) {
      document.removeEventListener("dragend", this._onDragEnd);
    }
    if (this._onDrop) {
      document.removeEventListener("drop", this._onDrop);
    }
    if (this._onKeyDown) {
      document.removeEventListener("keydown", this._onKeyDown);
    }

    this.participantNameInput = null;
    this._onParticipantInput = null;
    this._onParticipantChange = null;
    this._onDragStart = null;
    this._onDragEnd = null;
    this._onDrop = null;
    this._onKeyDown = null;
    this.initialized = false;
  }

  /**
   * 處理鍵盤按下事件
   * @param {KeyboardEvent} e - 鍵盤事件
   */
  handleKeyDown(e) {
    switch (e.key) {
      case " ":
        e.preventDefault();
        if (this.core.stateManager) {
          this.core.stateManager.toggleExperiment();
        }
        break;
      case "Escape":
        if (this.core.stateManager) {
          this.core.stateManager.stopExperiment();
        }
        break;
    }
  }

  /**
   * 處理遠端動作
   * @param {Object} detail - 遠端動作資料
   */
  handleRemoteAction(detail) {
    Logger.debug("UI 管理器處理遠端動作", detail);
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
   * @param {string} buttonId - 按鈕 ID
   */
  simulateButtonPress(buttonId) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.click();
    }
  }

  /**
   * 更新手勢顯示
   * @param {Object} data - 手勢資料
   */
  updateGestureDisplay(data) {
    if (this.core.gestureStats && data.gesture_name) {
    }
  }

  /**
   * 切換左側面板的展開或收合狀態
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
   * 渲染統一 UI
   */
  async renderUnifiedUI() {
    try {
      if (!this.core.scriptData) {
        await this.core.loadScenarioData();
      }

      const systemManager = this.core.experimentSystemManager;
      if (systemManager) {
        if (!systemManager.state?.initialized) {
          try {
            await systemManager.initialize();
          } catch (error) {
            Logger.warn("ExperimentSystemManager 初始化失敗，略過統一 UI", error);
            return;
          }
        }

        await systemManager.initializeUI(
          {
            combinationSelector: "#combinationSelectorContainer",
            unitPanel: "#unitsPanelContainer",
            experimentControls: "#experimentControlsContainer",
          },
          this.core.scriptData,
        );
        try {
          if (typeof this.core.uiManager.initializePanelUI === "function") {
            await this.core.uiManager.initializePanelUI();
          }
        } catch (e) {
          Logger.warn("初始化 Panel UI 失敗", e);
        }

        Logger.debug("使用 ExperimentSystemManager 渲染 UI 完成");
        return;
      }

      Logger.warn("ExperimentSystemManager 不可用，略過統一 UI 渲染");
      return;
    } catch (error) {
      Logger.error("渲染統一 UI 失敗:", error);
      return;
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
    let refDiv = document.querySelector(".gesture-reference");
    if (refDiv) {
      refDiv.remove();
    }

    const gestureTypes = this.core.scenariosData.gesture_list;

    refDiv = document.createElement("div");
    refDiv.className = "gesture-reference";
    refDiv.style.marginTop = "20px";
    refDiv.innerHTML = `
        <h2 class="gesture-reference-toggle" style="cursor: pointer; display: flex; align-items: center; color: #2c3e50; margin-bottom: 12px; font-weight: 700;">
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

    const toggle = refDiv.querySelector(".gesture-reference-toggle");
    const list = refDiv.querySelector(".gesture-types-list");
    if (toggle && list) {
      toggle.addEventListener("click", () => {
        list.style.display = list.style.display === "none" ? "block" : "none";
      });
    }
  }

  /**
   * 清理資源
   */
  destroy() {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("dragstart", this.handleDragStart);
    document.removeEventListener("dragend", this.handleDragEnd);
    document.removeEventListener("drop", this.handleDrop);

    Logger.debug("BoardUIManager 已清理");
  }
};

// ES6 模組匯出
export default BoardUIManager;
