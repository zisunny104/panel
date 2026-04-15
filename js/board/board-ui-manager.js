/**
 * BoardUIManager - 管理 board 頁面的 UI 與互動
 *
 * 負責受試者名稱輸入、按鈕事件、拖曳功能等互動，
 * 並將實驗控制邏輯委派給 ExperimentSystemManager 處理。
 */

import { ACTION_IDS } from "../constants/index.js";

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
    this.setupDragAndDrop();
    this.setupPanelToggleButton();
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
    this.participantNameInput = null;
    this._onParticipantInput = null;
    this._onParticipantChange = null;
    this._onDragStart = null;
    this._onDragEnd = null;
    this._onDrop = null;
    this.initialized = false;
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
   * 渲染單元詳細內容
   */
  renderUnitDetail() {
    const core = this.core;
    Logger.debug("renderUnitDetail: 開始渲染手勢序列面板", {
      hasCombination: !!core.currentCombination,
      gesture_count: core.currentCombination?.gestures?.length || 0,
    });

    if (!core.currentCombination) {
      Logger.warn("renderUnitDetail: currentCombination 為空，無法渲染");
      return;
    }

    const contentArea = document.getElementById("contentArea");
    if (!contentArea) {
      Logger.warn("renderUnitDetail: contentArea 元素不存在");
      return;
    }

    const script = core.currentCombination;

    Logger.debug("renderUnitDetail: 開始建構 HTML", {
      combinationName: script.combinationName,
      gestureCount: script.gestures?.length || 0,
    });

    const convertColorTags = (text) => {
      if (!text) return text;
      return text
        .replace(
          /\[orange\](.*?)\[\/orange\]/g,
          "<span style=\"color: #ff9800; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[red\](.*?)\[\/red\]/g,
          "<span style=\"color: #f44336; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[green\](.*?)\[\/green\]/g,
          "<span style=\"color: #4caf50; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[blue\](.*?)\[\/blue\]/g,
          "<span style=\"color: #2196f3; font-weight: 700;\">$1</span>",
        );
    };

    let html = "<div class=\"right-section\"><h2>實驗手勢序列</h2>";
    if (script.gestures) {
      html +=
        "<div style=\"display: grid; grid-template-columns: 1fr; gap: 12px;\">";

      script.gestures.forEach((gesture, idx) => {
        const isSystemOpen =
          gesture.step_id === "SYSTEM_OPEN" || gesture.gesture === "open";
        const isSystemClose =
          gesture.step_id === "SYSTEM_CLOSE" || gesture.gesture === "close";
        const isCapture =
          gesture.step_id === "FINAL_CAPTURE" || gesture.gesture === "capture";
        const isZoomIn =
          gesture.step_id === "FIRST_UNIT_ZOOM_IN" ||
          gesture.gesture === "zoom_in";
        const isZoomOut =
          gesture.step_id === "LAST_UNIT_ZOOM_OUT" ||
          gesture.gesture === "zoom_out";
        const isUnitSwitch =
          gesture.step_id?.startsWith("UNIT_EXIT_") ||
          gesture.step_id?.startsWith("UNIT_NAV_") ||
          gesture.step_id?.startsWith("UNIT_ENTER_");
        const hasPowerAction =
          Array.isArray(gesture.actions) &&
          gesture.actions.some(
            (action) =>
              action.action_id === ACTION_IDS.POWER_ON ||
              action.action_id === ACTION_IDS.POWER_OFF,
          );

        let borderColor = "#e0e0e0";
        let bgColor = "#f0f4ff";
        let accentColor = "#667eea";
        let tagBg = "#667eea";
        let tagText = "";

        if (isSystemOpen) {
          borderColor = "#4caf50";
          bgColor = "#e8f5e9";
          accentColor = "#4caf50";
          tagBg = "#4caf50";
          tagText = "教學系統";
        } else if (isSystemClose) {
          borderColor = "#f44336";
          bgColor = "#ffebee";
          accentColor = "#f44336";
          tagBg = "#f44336";
          tagText = "教學系統";
        } else if (isCapture) {
          borderColor = "#9c27b0";
          bgColor = "#f3e5f5";
          accentColor = "#9c27b0";
          tagBg = "#9c27b0";
          tagText = "拍攝記錄";
        } else if (isZoomIn || isZoomOut) {
          borderColor = "#00bcd4";
          bgColor = "#e0f7fa";
          accentColor = "#00bcd4";
          tagBg = "#00bcd4";
          tagText = isZoomIn ? "放大操作" : "縮小操作";
        } else if (isUnitSwitch) {
          borderColor = "#ff9800";
          bgColor = "#fff3e0";
          accentColor = "#ff9800";
          tagBg = "#ff9800";
          tagText = "單元切換";
        }

        let gestureNameEn = "";
        if (
          gesture.gesture &&
          core.gesturesData &&
          core.gesturesData[gesture.gesture]
        ) {
          gestureNameEn = core.gesturesData[gesture.gesture].en || "";
        }

        html += `
                    <div id="gesture-card-${idx}" class="gesture-card-inactive" style="position: relative; background: white; border: 2px solid ${borderColor}; border-radius: 8px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
                        ${
                          gesture.unit_name
                            ? `<div style="position: absolute; top: 10px; right: 10px; background: #667eea; color: white; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; z-index: 10;">${gesture.unit_name}</div>`
                            : ""
                        }
                        ${
                          tagText
                            ? `<div style="position: absolute; top: 10px; right: 10px; background: ${tagBg}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; z-index: 10;">${tagText}</div>`
                            : ""
                        }

                            <div id="timer-card-${idx}" class="timer-card"
                              style="--timer-accent: ${accentColor}; background: ${bgColor}; border: 2px solid ${accentColor};"
                              data-action="timer-card"
                              data-gesture-index="${idx}">

                            <div id="timer-display-${idx}" class="timer-display" style="color: ${accentColor};">
                                00:00.000
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                <div style="background: ${accentColor}; color: white; width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">${
                                  gesture.step
                                }</div>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: 700; color: #2c3e50; font-size: 50px; word-break: break-word;">${
                                      gesture.name
                                    }${
                                      gestureNameEn
                                        ? ` | ${gestureNameEn}`
                                        : ""
                                    }</div>
                                    <div style="font-size: 11px; color: #555; margin-top: 2px; word-break: break-word;">${convertColorTags(
                                      gesture.description,
                                    )}</div>
                                </div>
                            </div>
                        </div>

                        <div style="margin-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                            <button class="gesture-action-btn correct"
                                    data-action="mark-gesture"
                                    data-mark-status="correct"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <circle cx="12" cy="12" r="8.5" />
                                </svg>
                            </button>
                            <button class="gesture-action-btn uncertain"
                                    data-action="mark-gesture"
                                    data-mark-status="uncertain"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12,4.5 20.5,19.5 3.5,19.5" />
                                </svg>
                            </button>
                            <button class="gesture-action-btn incorrect"
                                    data-action="mark-gesture"
                                    data-mark-status="incorrect"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
                                    <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
                                </svg>
                            </button>
                        </div>

                        ${
                          gesture.reason
                            ? `
                            <div class="gesture-info-section step-info">
                                <div class="section-label">對應步驟</div>
                                <div class="section-content">${convertColorTags(
                                  gesture.reason,
                                )}</div>
                            </div>
                        `
                            : ""
                        }

                        ${
                          ((!isSystemOpen &&
                            !isSystemClose &&
                            !isCapture &&
                            !isZoomIn &&
                            !isZoomOut &&
                            !isUnitSwitch) ||
                            hasPowerAction) &&
                          (gesture.step_name ||
                            (gesture.actions && gesture.actions.length > 0))
                            ? `
                            <div class="gesture-info-section action-info">
                                ${
                                  gesture.step_name
                                    ? `
                                    <div class="gesture-step-card">
                                        <div class="step-id">${
                                          gesture.step_id || "N/A"
                                        }</div>
                                        <div class="step-name">${convertColorTags(
                                          gesture.step_name,
                                        )}</div>
                                    </div>
                                `
                                    : ""
                                }

                                ${
                                  gesture.actions && gesture.actions.length > 0
                                    ? `
                                    <div class="gesture-actions-container">
                                        ${gesture.actions
                                          .map(
                                            (action) => `
                                            <button
                                              class="action-button gesture-action-button"
                                              data-action="action-button"
                                              data-action-id="${
                                                action.action_id
                                              }"
                                              data-gesture-index="${idx}"
                                              data-completed="false">
                                                <div class="action-id">${
                                                  action.action_id
                                                }</div>
                                                <div class="action-name">${convertColorTags(
                                                  action.action_name,
                                                )}</div>
                                            </button>
                                        `,
                                          )
                                          .join("")}
                                    </div>
                                `
                                    : ""
                                }
                            </div>
                        `
                            : ""
                        }

                        <button class="gesture-next-button"
                                data-action="next-step"
                                data-gesture-index="${idx}"
                                data-gesture-name="${gesture.name}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="9,18 15,12 9,6" />
                            </svg>
                        </button>
                    </div>
                `;
      });
      html += "</div></div>";
    }

    contentArea.innerHTML = html;
    Logger.debug("renderUnitDetail: 手勢序列 HTML 已渲染到 DOM");

    const gestureCards = contentArea.querySelectorAll("[id^='gesture-card-']");
    Logger.debug("renderUnitDetail: 驗證渲染結果", {
      rendered_cards_count: gestureCards.length,
      expected_cards_count: core.currentCombination?.gestures?.length || 0,
    });

    if (
      gestureCards.length === 0 &&
      core.currentCombination?.gestures?.length > 0
    ) {
      Logger.warn(
        "renderUnitDetail: HTML 中沒有找到手勢卡片，但 script 中有手勢",
      );
    }

    core._bindGestureContentEvents(contentArea);
    core.updateExperimentStats();
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

};

// ES6 模組匯出
export default BoardUIManager;
