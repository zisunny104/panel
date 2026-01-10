// experiment-page-manager.js - 實驗頁面管理器
// 專門用於 experiment.html 頁面

import { getExperimentHubManager } from "../sync/experiment-hub-manager.js";
import { SyncEvents } from "../core/sync-events-constants.js";
import { ExperimentExportManager } from "./experiment-export-manager.js";
import {
  toggleTimer,
  formatDuration,
  resetTimer,
  timerLongPressStart,
  timerLongPressEnd,
} from "./experiment-timer-utils.js";
import { loadUnitsFromScenarios } from "../core/data-loader.js";
import { markGesture, goToNextStep } from "./experiment-gesture-utils.js";
import {
  toggleLeftPanel,
  toggleGestureStats,
} from "./experiment-ui-controls.js";

class ExperimentPageManager {
  constructor() {
    // 基礎資料
    this.scenariosData = null;
    this.scriptData = null;
    this.gesturesData = null;

    // 目前狀態
    this.currentUnit = null;
    this.currentStep = 0;
    this.currentCombination = null;
    this.currentUnitOrder = [];

    // 工作階段與實驗控制
    this.sessionId = this.generateSessionId();
    this.experimentRunning = false;
    this.experimentPaused = false;
    this.experimentStartTime = null; // 修復：改為 null，避免顯示 1970-01-01
    this.experimentElapsedTime = 0;
    this.experimentTimerInterval = null;

    // 統計資料
    this.gestureStats = {};

    // 受試者資訊
    this.subjectName = "";
    this.lastSavedSubjectName = "";
    this.pendingExperimentIdUpdate = null;
    this.pendingSubjectNameUpdate = null;

    // Action 管理
    this.actionsMap = new Map();
    this.actionToStepMap = new Map();
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();

    // 時間追蹤
    this.actionTimings = new Map(); // action 執行時間

    // 遠端事件重複排除機制
    this.processedRemoteActions = new Map(); // 已處理的遠端動作
    this.remotActionDedupeWindow = 500; // 重複排除機制時間視窗（毫秒）

    this.pendingExperimentIdUpdate = null; // 等待實驗結束後同步的實驗ID更新

    // 匯出管理器
    this.exportManager = new ExperimentExportManager(this);

    this.init();
  }

  generateSessionId() {
    return "EXP_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  /** 產生新的實驗ID */
  generateNewExperimentId() {
    const result = RandomUtils.generateNewExperimentId();

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.value = result;
    }

    //廣播新的實驗ID到同步工作階段
    this.broadcastExperimentIdUpdate(result);

    return result;
  }

  /** 產生新的實驗ID並註冊到中樞 */
  async generateNewExperimentIdWithHub() {
    const newId = this.generateNewExperimentId();
    Logger.debug(`[ExperimentPageManager] 🆕 產生新的實驗ID: ${newId}`);

    // 只在同步模式下註冊到中樞
    const hubManager = getExperimentHubManager();
    if (hubManager?.isInSyncMode?.()) {
      Logger.debug(`[同步模式] 註冊實驗ID到中樞`);
      await this.registerExperimentIdToHub(newId);
      // 廣播新實驗ID給其他連線裝置
      this.broadcastExperimentIdUpdate(newId);
    } else {
      Logger.debug(`[獨立模式] 實驗ID僅存本機: ${newId}`);
    }

    return newId;
  }

  /** 註冊實驗ID到中樞 */
  async registerExperimentIdToHub(experimentId) {
    try {
      Logger.debug(
        `[ExperimentPageManager] 開始註冊實驗ID到中樞: ${experimentId}`
      );
      const hubManager = getExperimentHubManager();
      const success = await hubManager.registerExperimentId(
        experimentId,
        "experiment_manager"
      );
      if (success) {
        Logger.info(
          `[ExperimentPageManager] 實驗ID已成功註冊到中樞: ${experimentId}`
        );
      } else {
        Logger.warn(`[ExperimentPageManager] 實驗ID註冊失敗: ${experimentId}`);
      }
    } catch (error) {
      Logger.warn(
        `[ExperimentPageManager] 無法連線到實驗中樞: ${error.message}`
      );
    }
  }

  /**
   * 初始化實驗頁面管理器
   */
  async init() {
    await this.loadScript();
    this.renderCombinations();
    this.renderGestureTypesReference();
    await this.renderUnitList();

    const selectAllUnits = document.getElementById("selectAllUnits");
    if (selectAllUnits) {
      selectAllUnits.addEventListener("change", (e) =>
        this.toggleSelectAllUnits(e.target.checked)
      );
    }

    // 初始化實驗ID
    const experimentIdInput = document.getElementById("experimentIdInput");
    const regenerateIdBtn = document.getElementById("regenerateIdButton");

    Logger.debug(`[ExperimentPageManager] 初始化實驗ID...`);

    // 檢查是否處於同步模式（已加入工作階段）
    const hubManager = getExperimentHubManager();
    const isInSyncMode = hubManager.isInSyncMode();

    if (isInSyncMode) {
      Logger.debug(`[ExperimentPageManager] 檢測到同步模式，從中樞讀取實驗ID`);
      // 從實驗中樞讀取或產生新ID
      try {
        const experimentId = await hubManager.getExperimentId();
        if (experimentId) {
          Logger.debug(
            `[ExperimentPageManager] 從中樞取得實驗ID: ${experimentId}`
          );
          experimentIdInput.value = experimentId;
        } else if (!experimentIdInput.value.trim()) {
          Logger.debug(`[ExperimentPageManager] 中樞無ID，產生新ID`);
          await this.generateNewExperimentIdWithHub();
        }
      } catch (error) {
        Logger.warn(
          `[ExperimentPageManager] 無法連線到實驗中樞: ${error.message}，改為本機模式`
        );
        if (!experimentIdInput.value.trim()) {
          this.generateNewExperimentId();
        }
      }
    } else {
      Logger.debug(`[ExperimentPageManager] 不在同步模式，使用本機產生ID`);
      // 本機模式，直接使用本機的ID
      if (!experimentIdInput.value.trim()) {
        this.generateNewExperimentId();
      }
    }

    // 選擇預設組合
    this.selectDefaultCombination();

    // 綁定實驗ID輸入框事件
    experimentIdInput.addEventListener("change", async () => {
      if (!experimentIdInput.value.trim()) {
        await this.generateNewExperimentIdWithHub();
        return;
      }

      const newExperimentId = experimentIdInput.value.trim();
      Logger.debug(
        `[ExperimentPageManager] 用戶手動輸入實驗ID: ${newExperimentId}`
      );

      // 只在同步模式下註冊到中樞
      const hubManager = getExperimentHubManager();
      if (hubManager?.isInSyncMode?.()) {
        Logger.debug(`[同步模式] 註冊手動輸入的實驗ID到中樞`);
        await this.registerExperimentIdToHub(newExperimentId);
      } else {
        Logger.debug(`[獨立模式] 實驗ID僅存本機`);
      }

      if (this.currentCombination) {
        const combination =
          this.scriptData.combinations[
            this.scriptData.combinations.findIndex(
              (c) => c.combination_id === this.currentCombination.combination_id
            )
          ];
        await this.loadScriptForCombination(combination, newExperimentId);
      }

      this.broadcastExperimentIdUpdate(newExperimentId);
    });

    // 綁定重新產生按鈕事件
    if (regenerateIdBtn) {
      regenerateIdBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.generateNewExperimentIdWithHub();
        this.selectDefaultCombination();
      });
    }

    // 綁定受試者名稱變更事件
    this.setupSubjectNameListener();

    // 監聽遠端實驗狀態變化
    this.setupRemoteEventListeners();
  }

  async loadScript() {
    try {
      // 使用資料轉換器載入完整的 units 和 actions 資料
      const convertedData = await loadUnitsFromScenarios();

      this.scenariosData = await fetch("data/scenarios.json").then((r) =>
        r.json()
      );

      // 載入手勢多語言資料
      this.gesturesData = await fetch("data/gestures.json").then((r) =>
        r.json()
      );

      // 儲存 actions 相關資料
      this.actionsMap = convertedData.actions;
      this.actionToStepMap = convertedData.actionToStep;

      // 初始化 scriptData
      this.scriptData = {
        combinations: convertedData.unit_combinations,
        gestures: this.scenariosData.gesture_list,
        sections: this.scenariosData.sections,
        units: convertedData.units,
      };
    } catch (error) {
      Logger.error("載入 scenarios.json 失敗:", error);
    }
  }

  /**
   * 渲染手勢類型參考面板
   */
  renderGestureTypesReference() {
    const leftPanel = document.querySelector(".left-panel");
    if (!leftPanel || !this.scenariosData || !this.scenariosData.gesture_list)
      return;

    // 檢查是否已經存在，避免重複新增
    let refDiv = document.querySelector(".gesture-reference");
    if (refDiv) {
      refDiv.remove();
    }

    const gestureTypes = this.scenariosData.gesture_list;

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
                `
                  )
                  .join("")}
            </div>
        `;

    leftPanel.appendChild(refDiv);
  }

  /**
   * 渲染組合選擇器
   */
  renderCombinations() {
    if (!this.scriptData || !this.scriptData.combinations) return;

    const selector = document.getElementById("combinationSelector");
    selector.innerHTML = "";

    this.scriptData.combinations.forEach((combo, index) => {
      const div = document.createElement("div");
      div.className = "combination-item";
      div.innerHTML = `
                <div class="combo-name">${combo.combination_name}</div>
                <div class="combo-desc">${combo.description}</div>
            `;
      div.onclick = () => this.selectCombination(index);
      selector.appendChild(div);
    });

    // 渲染後重新套用預設選擇的 active 類
    this.applyDefaultCombinationSelection();
  }
  /**
   * 套用預設組合選擇的視覺效果
   */
  applyDefaultCombinationSelection() {
    if (!this.scriptData || !this.scriptData.combinations) return;

    const defaultCombinationId =
      window.CONFIG?.experiment?.defaultCombinationId;
    let defaultIndex = 0;

    // 如果設定中有預設組合ID，查找對應的索引
    if (defaultCombinationId) {
      defaultIndex = this.scriptData.combinations.findIndex(
        (c) => c.combination_id === defaultCombinationId
      );
      // 如果找不到，使用第一個
      if (defaultIndex === -1) {
        defaultIndex = 0;
      }
    }

    // 套用 active 類到對應的卡片
    document.querySelectorAll(".combination-item").forEach((el, i) => {
      el.classList.toggle("active", i === defaultIndex);
    });
  }

  /**
   * 選擇預設組合並載入手勢序列
   * 優先順序：本機快取 > 設定預設 > 第一個
   */
  selectDefaultCombination() {
    if (!this.scriptData || !this.scriptData.combinations) return;

    let selectedIndex = 0;

    // 優先檢查本機快取
    const cachedCombinationId = localStorage.getItem(
      "last_selected_combination_id"
    );
    if (cachedCombinationId) {
      const cachedIndex = this.scriptData.combinations.findIndex(
        (c) => c.combination_id === cachedCombinationId
      );
      if (cachedIndex !== -1) {
        selectedIndex = cachedIndex;
      }
    }

    // 如果沒有快取，使用設定中的預設組合
    if (selectedIndex === 0 && !cachedCombinationId) {
      const defaultCombinationId =
        window.CONFIG?.experiment?.defaultCombinationId;
      if (defaultCombinationId) {
        const defaultIndex = this.scriptData.combinations.findIndex(
          (c) => c.combination_id === defaultCombinationId
        );
        if (defaultIndex !== -1) {
          selectedIndex = defaultIndex;
        }
      }
    }

    // 如果都沒有，使用第一個
    if (
      selectedIndex === 0 &&
      !cachedCombinationId &&
      !window.CONFIG?.experiment?.defaultCombinationId
    ) {
      // 使用列表第一個組合
    }

    // 載入選定的組合
    this.selectCombination(selectedIndex);
  }

  /**
   * 選擇指定的組合
   * @param {number} index - 組合索引
   */
  selectCombination(index) {
    if (!this.scriptData || !this.scriptData.combinations) return;

    const combination = this.scriptData.combinations[index];
    this.currentCombination = combination;

    // 儲存到本機快取
    localStorage.setItem(
      "last_selected_combination_id",
      combination.combination_id
    );

    // 更新 UI 顯示選中狀態
    this.updateCombinationSelection(index);

    // 使用中央 CombinationSelector 進行選擇
    if (window.CombinationSelector) {
      window.CombinationSelector.selectCombination(combination);
    } else {
      Logger.warn("[ExperimentPageManager] CombinationSelector 未載入");
      // 降級方案：使用內部邏輯
      this.updateUnitListForCombination(combination);
    }

    // 取得實驗ID (如果有的話)
    const experimentId = document
      .getElementById("experimentIdInput")
      .value.trim();
    this.loadScriptForCombination(combination, experimentId);
  }

  /**
   * 更新組合卡片的視覺選中狀態
   */
  updateCombinationSelection(selectedIndex) {
    const cards = document.querySelectorAll(".combination-item");
    cards.forEach((card, index) => {
      card.classList.toggle("active", index === selectedIndex);
    });
  }

  /**
   * 更新單元列表以匹配組合要求
   * @param {Object} combination - 組合物件
   */
  updateUnitListForCombination(combination) {
    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    // 取得該組合包含的單元ID，並按正確順序排列
    // 使用統一的 RandomUtils 處理組合邏輯
    const experimentId =
      document.getElementById("experimentIdInput").value.trim() || "default";
    const combinationUnitIds = RandomUtils.getCombinationUnitIds(
      combination,
      experimentId
    );

    // 更新單元選擇狀態
    // 先取消全部選擇
    unitList
      .querySelectorAll('li:not(.power-option-card) input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.checked = false;
      });

    // 然後只選擇該組合中的單元
    unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (combinationUnitIds.includes(li.dataset.unitId)) {
        checkbox.checked = true;
      }
    });

    // 重新排序單元列表以配對組合順序
    const normalItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)")
    );
    const startupCard = unitList.querySelector(".startup-card");
    const shutdownCard = unitList.querySelector(".shutdown-card");

    // 按照 combinationUnitIds 的順序重新排列
    combinationUnitIds.forEach((unitId) => {
      const li = normalItems.find((item) => item.dataset.unitId === unitId);
      if (li) {
        // 移到最後但在關機卡片之前
        if (shutdownCard) {
          unitList.insertBefore(li, shutdownCard);
        } else {
          unitList.appendChild(li);
        }
      }
    });

    // 更新全選狀態和按鈕狀態
    this.updateSelectAllState();
    this.updateUnitButtonStates();
  }

  /**
   * 為組合載入對應的腳本資料
   * @param {Object} combination - 組合物件
   * @param {string} experimentId - 實驗ID
   */
  async loadScriptForCombination(combination, experimentId) {
    try {
      // 確保實驗ID不為空
      if (!experimentId || !experimentId.trim()) {
        experimentId = this.generateNewExperimentId();
      }

      // 建立組合內容
      const script = {
        combination_id: combination.combination_id,
        combination_name: combination.combination_name,
        description: combination.description,
        experiment_id: experimentId,
        units_sequence: [],
        gestures: [],
      };

      // 建立單元序列
      const unitIds = RandomUtils.getCombinationUnitIds(
        combination,
        experimentId
      );

      const confirmGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "confirm"
      );
      const nextGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "next"
      );
      const prevGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "prev"
      );
      const openGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "open"
      );
      const section = this.scenariosData.sections[0];

      if (this.scenariosData && this.scenariosData.sections) {
        // 開機步驟
        if (openGesture) {
          script.gestures.push({
            step: 1,
            gesture: "open",
            name: openGesture.gesture_name,
            description: openGesture.gesture_description,
            reason: "[num1] + [num2] | 開啟教學維護系統，進入章節列表",
            step_id: "SYSTEM_OPEN",
            step_name: "開啟教學維護系統",
            actions: [],
          });
        }

        // 確認進入章節
        if (confirmGesture && section) {
          script.gestures.push({
            step: script.gestures.length + 1,
            gesture: "confirm",
            name: confirmGesture.gesture_name,
            description: confirmGesture.gesture_description,
            reason: `進入章節：${section.section_name}`,
            step_id: "SECTION_ENTER",
            step_name: `確認進入「${section.section_name}」`,
            actions: [],
          });
        }

        // 初始導航至第一個單元
        if (unitIds.length > 0 && section) {
          const firstUnitId = unitIds[0];
          const firstUnit = section.units.find(
            (u) => u.unit_id === firstUnitId
          );
          const firstUnitIndexInJson = section.units.findIndex(
            (u) => u.unit_id === firstUnitId
          );

          if (firstUnitIndexInJson > 0 && nextGesture) {
            script.gestures.push({
              step: script.gestures.length + 1,
              gesture: "next",
              name: nextGesture.gesture_name,
              description: nextGesture.gesture_description,
              reason: `[num6] x${firstUnitIndexInJson} | 導航至「${firstUnit.unit_name}」 | 列表 -> ${firstUnitId}`,
              step_id: `FIRST_UNIT_NAV`,
              step_name: `單元列表導航 ([num6] x${firstUnitIndexInJson})`,
              actions: [],
            });
          }

          // 進入第一個單元的「確認」手勢（包含 SAXX_1 的動作）
          if (confirmGesture && firstUnit?.steps?.length > 0) {
            const step0 = firstUnit.steps[0];
            script.gestures.push({
              step: script.gestures.length + 1,
              gesture: "confirm",
              name: confirmGesture.gesture_name,
              description: confirmGesture.gesture_description,
              unit_name: firstUnit.unit_name,
              reason: `開始單元：${firstUnit.unit_name}`,
              step_id: step0.step_id || `UNIT_ENTER_${firstUnitId}`,
              step_name:
                step0.step_name || `確認進入「${firstUnit.unit_name}」`,
              actions: step0.actions || [],
            });
          }
        }

        // 教學單元迴圈
        unitIds.forEach((unitId, unitIdx) => {
          const unit = section.units.find((u) => u.unit_id === unitId);
          if (!unit) return;

          script.units_sequence.push({
            unit_id: unit.unit_id,
            unit_name: unit.unit_name,
            description: unit.unit_description,
          });

          // SA04 單元特殊處理：在第一步後加入 reload 手勢
          if (unitId === "SA04") {
            const reloadG = this.scenariosData.gesture_list.find(
              (g) => g.gesture_id === "reload"
            );
            if (reloadG) {
              script.gestures.push({
                step: script.gestures.length + 1,
                gesture: "reload",
                name: reloadG.gesture_name,
                description: reloadG.gesture_description,
                unit_name: unit.unit_name,
                reason: "[num5] | 重新開始顯示此次教學步驟提示",
                step_id: "SA04_REVIEW_RELOAD",
                step_name: "重新檢視教學內容",
                actions: [],
              });
            }
          }

          // 渲染單元內的步驟
          if (unit.steps) {
            unit.steps.forEach((step, stepIdx) => {
              // 跳過第一步，已合併在進入單元的 confirm 中
              if (stepIdx === 0) return;

              const gestureId = step.gesture || "next";
              const gesture = this.scenariosData.gesture_list.find(
                (g) => g.gesture_id === gestureId
              );
              if (gesture) {
                script.gestures.push({
                  step: script.gestures.length + 1,
                  gesture: gesture.gesture_id,
                  name: gesture.gesture_name,
                  description: gesture.gesture_description,
                  unit_name: unit.unit_name,
                  reason: step.step_description || null,
                  step_id: step.step_id || null,
                  step_name: step.step_name || null,
                  actions: step.actions || [],
                });
              }
            });
          }

          // 單元完成：加入下一步手勢
          if (nextGesture) {
            script.gestures.push({
              step: script.gestures.length + 1,
              gesture: "next",
              name: nextGesture.gesture_name,
              description: nextGesture.gesture_description,
              unit_name: unit.unit_name,
              reason: `完成「${unit.unit_name}」單元`,
              step_id: `UNIT_COMPLETE_${unitId}`,
              step_name: `完成「${unit.unit_name}」`,
              actions: [],
            });
          }

          // 單元間切換
          if (unitIdx < unitIds.length - 1) {
            const nextUnitId = unitIds[unitIdx + 1];
            const nextUnit = section.units.find(
              (u) => u.unit_id === nextUnitId
            );

            // 第一個單元結束後加入放大手勢
            if (unitIdx === 0) {
              const zoomInG = this.scenariosData.gesture_list.find(
                (g) => g.gesture_id === "zoom_in"
              );
              if (zoomInG) {
                script.gestures.push({
                  step: script.gestures.length + 1,
                  gesture: "zoom_in",
                  name: zoomInG.gesture_name,
                  description: zoomInG.gesture_description,
                  reason: "[num9] x2 | 完成第一個教學單元後，操作放大說明文字",
                  step_id: "FIRST_UNIT_ZOOM_IN",
                  step_name: "文字放大操作",
                  actions: [],
                });
              }
            }

            // 回傳列表
            if (prevGesture) {
              script.gestures.push({
                step: script.gestures.length + 1,
                gesture: "prev",
                name: prevGesture.gesture_name,
                description: prevGesture.gesture_description,
                reason: `完成「${unit.unit_name}」後回傳單元列表`,
                step_id: `UNIT_EXIT_${unitId}`,
                step_name: `回傳單元列表`,
                actions: [],
              });
            }

            // 列表導航
            const currentIdxInJson = section.units.findIndex(
              (u) => u.unit_id === unitId
            );
            const nextIdxInJson = section.units.findIndex(
              (u) => u.unit_id === nextUnitId
            );
            const dist = nextIdxInJson - currentIdxInJson;
            const navG = dist > 0 ? nextGesture : prevGesture;

            if (navG && dist !== 0) {
              script.gestures.push({
                step: script.gestures.length + 1,
                gesture: navG.gesture_id,
                name: navG.gesture_name,
                description: navG.gesture_description,
                reason: `[${dist > 0 ? "num6" : "num4"}] x${Math.abs(
                  dist
                )} | 導航至「${
                  nextUnit.unit_name
                }」 | ${unitId} -> ${nextUnitId}`,
                step_id: `UNIT_NAV_${unitId}_TO_${nextUnitId}`,
                step_name: `單元列表導航 ([${
                  dist > 0 ? "num6" : "num4"
                }] x${Math.abs(dist)})`,
                actions: [],
              });
            }

            // 確認進入下一個單元
            if (confirmGesture && nextUnit?.steps?.length > 0) {
              const nextStep0 = nextUnit.steps[0];
              script.gestures.push({
                step: script.gestures.length + 1,
                gesture: "confirm",
                name: confirmGesture.gesture_name,
                description: confirmGesture.gesture_description,
                unit_name: nextUnit.unit_name,
                reason: `開始單元：${nextUnit.unit_name}`,
                step_id: nextStep0.step_id || `UNIT_ENTER_${nextUnitId}`,
                step_name:
                  nextStep0.step_name || `確認進入「${nextUnit.unit_name}」`,
                actions: nextStep0.actions || [],
              });
            }
          }
        });

        // 結尾手勢
        const zoomOutG = this.scenariosData.gesture_list.find(
          (g) => g.gesture_id === "zoom_out"
        );
        if (zoomOutG) {
          script.gestures.push({
            step: script.gestures.length + 1,
            gesture: "zoom_out",
            name: zoomOutG.gesture_name,
            description: zoomOutG.gesture_description,
            reason: "[num7] x2 | 完成最後一個教學單元後，操作縮小說明文字",
            step_id: "LAST_UNIT_ZOOM_OUT",
            step_name: "文字縮小操作",
            actions: [],
          });
        }

        const captureG = this.scenariosData.gesture_list.find(
          (g) => g.gesture_id === "capture"
        );
        if (captureG) {
          script.gestures.push({
            step: script.gestures.length + 1,
            gesture: "capture",
            name: captureG.gesture_name,
            description: captureG.gesture_description,
            reason: "[num8] | 完成所有教學單元後，拍攝機台最終狀態作為記錄",
            step_id: "FINAL_CAPTURE",
            step_name: "拍攝機台狀態",
            actions: [],
          });
        }

        const closeG = this.scenariosData.gesture_list.find(
          (g) => g.gesture_id === "close"
        );
        if (closeG) {
          script.gestures.push({
            step: script.gestures.length + 1,
            gesture: "close",
            name: closeG.gesture_name,
            description: closeG.gesture_description,
            reason: "[num1] + [num3] | 關閉教學維護系統並回傳正常操作模式",
            step_id: "SYSTEM_CLOSE",
            step_name: "關閉教學維護系統",
            actions: [],
          });
        }
      }

      this.currentCombination = script;
      this.renderUnitDetail();
    } catch (error) {
      Logger.error("載入組合劇本失敗:", error);
    }
  }

  /**
   * 渲染單元詳細內容
   */
  renderUnitDetail() {
    if (!this.currentCombination) return;

    const contentArea = document.getElementById("contentArea");
    const script = this.currentCombination;

    // 轉換顏色標籤的函數
    const convertColorTags = (text) => {
      if (!text) return text;
      return text
        .replace(
          /\[orange\](.*?)\[\/orange\]/g,
          '<span style="color: #ff9800; font-weight: 700;">$1</span>'
        )
        .replace(
          /\[red\](.*?)\[\/red\]/g,
          '<span style="color: #f44336; font-weight: 700;">$1</span>'
        )
        .replace(
          /\[green\](.*?)\[\/green\]/g,
          '<span style="color: #4caf50; font-weight: 700;">$1</span>'
        )
        .replace(
          /\[blue\](.*?)\[\/blue\]/g,
          '<span style="color: #2196f3; font-weight: 700;">$1</span>'
        );
    };

    let html = `<div class="right-section"><h2>實驗手勢序列</h2>`;
    if (script.gestures) {
      html += `<div style="display: grid; grid-template-columns: 1fr; gap: 12px;">`;

      script.gestures.forEach((gesture, idx) => {
        // 判斷手勢類型
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

        // 確定卡片顏色主題
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

        // 取得英文名稱
        let gestureName_en = "";
        if (
          gesture.gesture &&
          this.gesturesData &&
          this.gesturesData[gesture.gesture]
        ) {
          gestureName_en = this.gesturesData[gesture.gesture].en || "";
        }

        html += `
                    <div id="gesture-card-${idx}" class="gesture-card-inactive" style="position: relative; background: white; border: 2px solid ${borderColor}; border-radius: 8px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
                        <!-- 步驟角標 -->
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

                        <!-- 手勢口令區域（可點擊計時） -->
                        <div id="timer-card-${idx}"
                             style="margin-bottom: 15px; padding: 12px; background: ${bgColor}; border: 2px solid ${accentColor}; border-radius: 6px; cursor: pointer; user-select: none; position: relative;"
                             onmousedown="window.timerLongPressStart(${idx})"
                             onmouseup="window.timerLongPressEnd(${idx})"
                             onmouseleave="window.timerLongPressEnd(${idx})"
                             ontouchstart="window.timerLongPressStart(${idx})"
                             ontouchend="window.timerLongPressEnd(${idx})"
                             onclick="window.toggleTimer(${idx})">

                            <!-- 計時顯示（右下角） -->
                            <div id="timer-display-${idx}" style="position: absolute; bottom: 8px; right: 12px; font-family: 'Courier New', monospace; font-size: 14px; font-weight: 700; color: ${accentColor}; background: white; padding: 4px 8px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
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
          gestureName_en ? ` | ${gestureName_en}` : ""
        }</div>
                                    <div style="font-size: 11px; color: #555; margin-top: 2px; word-break: break-word;">${convertColorTags(
                                      gesture.description
                                    )}</div>
                                </div>
                            </div>
                        </div>

                        <!-- 手勢反應按鈕區域 -->
                        <div style="margin-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                            <button onclick="window.markGesture(${idx}, 'correct', '${
          gesture.name
        }')" style="padding: 10px; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <circle cx="12" cy="12" r="8.5" />
                                </svg>
                            </button>
                            <button onclick="window.markGesture(${idx}, 'uncertain', '${
          gesture.name
        }')" style="padding: 10px; background: #ff9800; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12,4.5 20.5,19.5 3.5,19.5" />
                                </svg>
                            </button>
                            <button onclick="window.markGesture(${idx}, 'incorrect', '${
          gesture.name
        }')" style="padding: 10px; background: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
                                    <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
                                </svg>
                            </button>
                        </div>

                        <!-- Section-A 和 Units 步驟 -->
                        ${
                          gesture.reason
                            ? `
                            <div style="margin-bottom: 15px; padding: 10px; background: #fef5f0; border: 2px solid #ff9800; border-radius: 6px; overflow: hidden;">
                                <div style="font-size: 11px; color: #666; margin-bottom: 5px;">對應步驟</div>
                                <div style="font-size: 12px; color: #333; font-weight: 500; word-break: break-word;">${convertColorTags(
                                  gesture.reason
                                )}</div>
                            </div>
                        `
                            : ""
                        }

                        <!-- 合併的步驟說明 + 操作步驟卡片 (非系統手勢才顯示) -->
                        ${
                          !isSystemOpen &&
                          !isSystemClose &&
                          !isCapture &&
                          !isZoomIn &&
                          !isZoomOut &&
                          !isUnitSwitch &&
                          (gesture.step_name ||
                            (gesture.actions && gesture.actions.length > 0))
                            ? `
                            <div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border: 2px solid #999; border-radius: 6px; overflow: hidden;">
                                <!-- 上排：步驟說明 -->
                                ${
                                  gesture.step_name
                                    ? `
                                    <div style="margin-bottom: 10px; flex-shrink: 0; background: white; border: 2px solid #999; border-radius: 6px; padding: 8px; overflow: hidden;">
                                        <div style="font-size: 9px; color: #999; font-weight: 600; margin-bottom: 3px;">${
                                          gesture.step_id || "N/A"
                                        }</div>
                                        <div style="font-size: 11px; color: #333; font-weight: 500; word-break: break-word;">${convertColorTags(
                                          gesture.step_name
                                        )}</div>
                                    </div>
                                `
                                    : ""
                                }

                                <!-- 下排：操作步驟 -->
                                ${
                                  gesture.actions && gesture.actions.length > 0
                                    ? `
                                    <div style="display: flex; gap: 6px; overflow-x: auto; padding: 2px 0;">
                                        ${gesture.actions
                                          .map(
                                            (action, actionIdx) => `
                                            <button
                                              class="action-button"
                                              data-action-id="${
                                                action.action_id
                                              }"
                                              data-gesture-index="${idx}"
                                              data-completed="false"
                                              onclick="window.handleActionClick(this, '${
                                                action.action_id
                                              }', ${idx})"
                                              style="flex-shrink: 0; background: #e8eeff; border: 2px solid #667eea; border-radius: 6px; padding: 8px; white-space: nowrap; cursor: pointer; font-family: inherit; font-size: inherit; transition: all 0.2s; min-width: 0;">
                                                <div style="font-size: 9px; color: #667eea; font-weight: 600; margin-bottom: 2px;">${
                                                  action.action_id
                                                }</div>
                                                <div style="font-size: 12px; color: #2c3e50; font-weight: 500; white-space: nowrap;">${convertColorTags(
                                                  action.action_name
                                                )}</div>
                                            </button>
                                        `
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

                        <!-- 下一步按鈕 -->
                        <button onclick="window.goToNextStep(${idx}, '${
          gesture.name
        }')" style="width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="9,18 15,12 9,6" />
                            </svg>
                        </button>
                    </div>
                `;
      });
      html += `</div></div>`;
    }

    contentArea.innerHTML = html;

    // 更新統計資訊面板
    this.updateExperimentStats();
  }

  updateExperimentStats() {
    const statsPanel = document.getElementById("experimentStats");
    const script = this.currentCombination;

    if (script && script.gestures && script.gestures.length > 0) {
      // 顯示統計面板
      statsPanel.style.display = "block";

      // 更新手勢步驟數量
      document.getElementById(
        "statGestureCount"
      ).textContent = `${script.gestures.length} 步`;

      // 更新涉及單元數量
      const unitCount = script.units_sequence
        ? script.units_sequence.length
        : 0;
      document.getElementById("statUnitCount").textContent = unitCount;

      // 初始化手勢統計（計算每個手勢在序列中出現的次數）
      this.gestureStats = {};
      script.gestures.forEach((g) => {
        const gestureName = g.name || g.gesture;
        if (!this.gestureStats[gestureName]) {
          this.gestureStats[gestureName] = {
            planned: 0, // 規劃數量（序列中出現次數）
            completed: 0, // 實際完成次數（點擊下一步）
            correct: 0, // 正確標記次數
            uncertain: 0, // 不確定標記次數
            incorrect: 0, // 錯誤標記次數
          };
        }
        this.gestureStats[gestureName].planned++;
      });

      // 產生手勢統計列表
      this.renderGestureCountList();

      // 初始化第一個 action 的時間追蹤
      if (this.currentActionSequence && this.currentActionSequence.length > 0) {
        const firstAction = this.currentActionSequence[0];
        if (firstAction) {
          this.startActionTiming(firstAction.action_id);
        }
      }
    } else {
      // 隱藏統計面板
      statsPanel.style.display = "none";
    }
  }

  renderGestureCountList() {
    const listContainer = document.getElementById("gestureCountList");
    if (!listContainer) return;

    let html = "";
    const sortedGestures = Object.entries(this.gestureStats).sort(
      (a, b) => b[1].planned - a[1].planned
    );

    if (sortedGestures.length === 0) {
      html =
        '<div style="color: #999; font-size: 12px; text-align: center; padding: 10px;">尚無手勢統計記錄</div>';
    } else {
      sortedGestures.forEach(([gestureName, stats]) => {
        const completionRate =
          stats.planned > 0
            ? Math.round((stats.completed / stats.planned) * 100)
            : 0;
        const hasActivity =
          stats.completed > 0 ||
          stats.correct > 0 ||
          stats.uncertain > 0 ||
          stats.incorrect > 0;

        html += `
                    <div style="padding: 10px; background: white; border-radius: 6px; border: 2px solid ${
                      hasActivity ? "#667eea" : "#e0e0e0"
                    };">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 13px; color: #2c3e50; font-weight: 600;">${gestureName}</span>
                            <span style="font-size: 11px; color: #999;">規劃 ${
                              stats.planned
                            } 次</span>
                        </div>

                        <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                            <div style="flex: 1; text-align: center; padding: 6px; background: #f0f4ff; border-radius: 4px; border: 1px solid #667eea;">
                                <div style="font-size: 10px; color: #667eea; margin-bottom: 2px;">完成</div>
                                <div style="font-size: 16px; font-weight: 700; color: #667eea;">${
                                  stats.completed
                                }</div>
                            </div>
                            <div style="flex: 1; text-align: center; padding: 6px; background: #f1f8f4; border-radius: 4px; border: 1px solid #4caf50;">
                                <div style="font-size: 10px; color: #4caf50; margin-bottom: 2px;">✓ 正確</div>
                                <div style="font-size: 16px; font-weight: 700; color: #4caf50;">${
                                  stats.correct
                                }</div>
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px;">
                            <div style="flex: 1; text-align: center; padding: 6px; background: #fff8f0; border-radius: 4px; border: 1px solid #ff9800;">
                                <div style="font-size: 10px; color: #ff9800; margin-bottom: 2px;">△ 不確定</div>
                                <div style="font-size: 16px; font-weight: 700; color: #ff9800;">${
                                  stats.uncertain
                                }</div>
                            </div>
                            <div style="flex: 1; text-align: center; padding: 6px; background: #fff5f5; border-radius: 4px; border: 1px solid #f44336;">
                                <div style="font-size: 10px; color: #f44336; margin-bottom: 2px;">× 錯誤</div>
                                <div style="font-size: 16px; font-weight: 700; color: #f44336;">${
                                  stats.incorrect
                                }</div>
                            </div>
                        </div>

                        ${
                          stats.completed > 0
                            ? `
                            <div style="margin-top: 8px; padding: 4px 8px; background: ${
                              completionRate === 100 ? "#e8f5e9" : "#fff3e0"
                            }; border-radius: 4px; text-align: center;">
                                <span style="font-size: 11px; color: ${
                                  completionRate === 100 ? "#2e7d32" : "#f57c00"
                                }; font-weight: 600;">
                                    完成率 ${completionRate}%
                                </span>
                            </div>
                        `
                            : ""
                        }
                    </div>
                `;
      });
    }

    listContainer.innerHTML = html;
  }

  // ========== Action-Based 實驗流程管理 ==========

  /**
   * 初始化指定組合的 action 序列
   * @param {Object} combination - 選定的組合
   * @param {string} experimentId - 實驗ID
   */
  initActionSequenceForCombination(combination, experimentId) {
    try {
      // 取得單元ID序列 - 使用統一的 RandomUtils
      const unitIds = RandomUtils.getCombinationUnitIds(
        combination,
        experimentId
      );
      // 初始化 Action 序列，實驗ID: experimentId, 單元序列: unitIds

      // 使用資料轉換器建立 action 序列
      this.currentActionSequence = buildActionSequenceFromUnits(
        unitIds,
        this.actionsMap,
        this.scriptData.units
      );
      this.currentActionIndex = 0;
      this.completedActions.clear();

      return this.currentActionSequence;
    } catch (error) {
      Logger.error("初始化Action序列失敗:", error);
      return [];
    }
  }

  /**
   * 取得目前 action
   * @returns {Object|null} 目前action物件
   */
  getCurrentAction() {
    if (this.currentActionIndex < this.currentActionSequence.length) {
      return this.currentActionSequence[this.currentActionIndex];
    }
    return null;
  }

  /**
   * 開始追蹤 action 的執行時間
   * @param {string} actionId - Action ID
   */
  startActionTiming(actionId) {
    if (!this.actionTimings.has(actionId)) {
      this.actionTimings.set(actionId, {
        start_time: new Date().toISOString(),
        start_ms: Date.now(),
        end_time: null,
        end_ms: null,
        duration_ms: null,
      });
      // 開始追蹤 Action: actionId
    }
  }

  /**
   * 完成 action 時間追蹤
   * @param {string} actionId - Action ID
   * @returns {Object} 時間資訊
   */
  endActionTiming(actionId) {
    const timing = this.actionTimings.get(actionId);
    if (timing && !timing.end_ms) {
      timing.end_time = new Date().toISOString();
      timing.end_ms = Date.now();
      timing.duration_ms = timing.end_ms - timing.start_ms;
      return timing;
    }
    return null;
  }

  /**
   * 完成目前 action 並移動到下一個
   * @param {string} actionId - 完成的action ID
   */
  completeAction(actionId) {
    const action = this.actionsMap.get(actionId);
    if (!action) {
      Logger.warn("未找到action:", actionId);
      return false;
    }

    // 標記為已完成
    this.completedActions.add(actionId);

    // 結束時間追蹤
    const timingData = this.endActionTiming(actionId);

    // 記錄到日誌（包含時間資訊）
    if (window.logger) {
      const stepInfo = this.actionToStepMap.get(actionId);
      window.logger.logAction(
        `Action完成: ${action.action_name}`,
        "action_completed",
        {
          action_id: actionId,
          step_id: stepInfo?.step_id,
          unit_id: stepInfo?.unit_id,
          duration_ms: timingData?.duration_ms || null,
          start_time: timingData?.start_time || null,
          end_time: timingData?.end_time || null,
        }
      );
    }

    // 通知多螢幕同步
    if (window.syncManager) {
      const stepInfo = this.actionToStepMap.get(actionId);
      window.syncManager.core.syncState({
        type: "action_completed",
        device_id: window.syncManager?.deviceId || "experiment_panel",
        action_id: actionId,
        step_id: stepInfo?.step_id,
        unit_id: stepInfo?.unit_id,
        duration_ms: timingData?.duration_ms || null,
        timestamp: new Date().toISOString(),
      });
    }

    // 移動到下一個action
    this.moveToNextAction();
    return true;
  }

  /**
   * 移動到下一個 action
   */
  moveToNextAction() {
    if (this.currentActionIndex < this.currentActionSequence.length - 1) {
      this.currentActionIndex++;
      const nextAction = this.getCurrentAction();
      // 開始追蹤新 action 的時間
      if (nextAction) {
        this.startActionTiming(nextAction.action_id);
      }
    }
  }

  /**
   * 取得action完成進度
   * @returns {Object} 進度資訊
   */
  getActionProgress() {
    return {
      completed: this.completedActions.size,
      total: this.currentActionSequence.length,
      current_index: this.currentActionIndex,
      completion_rate: Math.round(
        (this.completedActions.size / this.currentActionSequence.length) * 100
      ),
    };
  }

  async renderUnitList() {
    try {
      const response = await fetch("./data/scenarios.json");
      if (!response.ok) {
        throw new Error("scenarios.json 載入失敗: " + response.status);
      }
      const data = await response.json();

      const unitList = document.querySelector("#experimentUnitsList");
      if (!unitList) return;

      // 清空列表
      unitList.innerHTML = "";

      // 首先新增開機卡片到最前面
      this.addStartupCard(unitList);

      // 從 scenarios.json 的 sections[0] 中讀取單元
      if (data && data.sections && data.sections.length > 0) {
        const section = data.sections[0];
        if (section.units && Array.isArray(section.units)) {
          section.units.forEach((unit) => {
            const li = this.createUnitListItem(unit);
            unitList.appendChild(li);
          });

          // 新增關機卡片到底部
          this.addShutdownCard(unitList);

          this.updateSelectAllState();
          this.updateUnitButtonStates();
          //不在這裡調用 onUnitSelectionChanged()
          // 初始化時不應該觸發單元選擇改變，否則會產生 custom 組合覆蓋預設組合
          // 預設組合的載入由 selectDefaultCombination() 負責
        } else {
          throw new Error("scenarios.json 中找不到單元資料");
        }
      } else {
        throw new Error("scenarios.json 格式錯誤或找不到 sections");
      }
    } catch (err) {
      const unitList = document.querySelector("#experimentUnitsList");
      if (unitList) {
        const errorLi = document.createElement("li");
        errorLi.style.color = "red";
        errorLi.textContent = err.message;
        unitList.appendChild(errorLi);
      }
    }
  }

  addStartupCard(unitList) {
    const startupCard = document.createElement("li");
    startupCard.className = "power-option-card startup-card";
    startupCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeStartup" checked>
            </label>
            <div class="unit-sort">
                <div class="unit-title">機器開機</div>
                <div class="unit-subtitle">POWER_ON • 等待使用者手動開機</div>
            </div>
        `;
    unitList.appendChild(startupCard);

    const includeStartup = startupCard.querySelector("#includeStartup");
    if (includeStartup) {
      includeStartup.addEventListener("change", (e) => {
        this.includeStartup = e.target.checked;
      });
    }
  }

  addShutdownCard(unitList) {
    const shutdownCard = document.createElement("li");
    shutdownCard.className = "power-option-card shutdown-card";
    shutdownCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeShutdown" checked>
            </label>
            <div class="unit-sort">
                <div class="unit-title">機器關機</div>
                <div class="unit-subtitle">POWER_OFF • 完成關機才結束實驗</div>
            </div>
        `;
    unitList.appendChild(shutdownCard);

    const includeShutdown = shutdownCard.querySelector("#includeShutdown");
    if (includeShutdown) {
      includeShutdown.addEventListener("change", (e) => {
        this.includeShutdown = e.target.checked;
      });
    }
  }

  createUnitListItem(unit) {
    const li = document.createElement("li");
    li.dataset.unitId = unit.unit_id;
    li.draggable = true;

    // 勾選框
    const label = document.createElement("label");
    label.className = "unit-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      this.updateSelectAllState();
      this.onUnitSelectionChanged();
    });
    label.appendChild(checkbox);
    li.appendChild(label);

    // 單元名稱
    const unitInfo = document.createElement("div");
    unitInfo.className = "unit-sort";
    unitInfo.innerHTML = `
            <div>${unit.unit_name || unit.unit_id}</div>
            <div>${unit.unit_id} • ${
      unit.steps ? unit.steps.length : 0
    } 步驟</div>
        `;
    li.appendChild(unitInfo);

    // 控制按鈕組
    const controlsGroup = document.createElement("div");
    controlsGroup.style.cssText =
      "display: flex; align-items: center; gap: 4px; margin-left: auto;";

    // 上移按鈕
    const upBtn = document.createElement("button");
    upBtn.className = "unit-sort-btn unit-up-btn";
    upBtn.title = "上移";
    upBtn.innerHTML = "▲";
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, -1);
    });
    controlsGroup.appendChild(upBtn);

    // 下移按鈕
    const downBtn = document.createElement("button");
    downBtn.className = "unit-sort-btn unit-down-btn";
    downBtn.title = "下移";
    downBtn.innerHTML = "▼";
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, 1);
    });
    controlsGroup.appendChild(downBtn);

    // 拖曳排序
    const dragHandle = document.createElement("span");
    dragHandle.className = "unit-drag-handle";
    dragHandle.title = "拖曳排序";
    dragHandle.innerHTML = "⋮⋮";
    dragHandle.style.cursor = "grab";
    controlsGroup.appendChild(dragHandle);

    li.appendChild(controlsGroup);

    // 綁定拖曳事件
    li.addEventListener("dragstart", (e) => this.onDragStart(e));
    li.addEventListener("dragover", (e) => this.onDragOver(e));
    li.addEventListener("drop", (e) => this.onDrop(e));
    li.addEventListener("dragend", (e) => this.onDragEnd(e));

    return li;
  }

  updateSelectAllState() {
    const unitList = document.querySelector("#experimentUnitsList");
    const selectAllCheckbox = document.getElementById("selectAllUnits");
    if (!unitList || !selectAllCheckbox) return;

    // 只考慮普通單元項目，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    const checkboxes = Array.from(normalItems)
      .map((li) => li.querySelector('input[type="checkbox"]'))
      .filter((cb) => cb);
    const checkedBoxes = checkboxes.filter((cb) => cb.checked);

    if (checkboxes.length === 0) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    } else if (checkedBoxes.length === checkboxes.length) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = true;
    } else if (checkedBoxes.length > 0) {
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.checked = false;
    } else {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    }
  }

  toggleSelectAllUnits(checked) {
    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    // 只對普通單元項目進行全選操作，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    normalItems.forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.checked = checked;
      }
    });

    // 觸發選擇改變事件
    this.onUnitSelectionChanged();
  }

  onDragStart(e) {
    this.draggedElement = e.target.closest("li:not(.power-option-card)");
    if (this.draggedElement) {
      this.draggedElement.style.opacity = "0.5";
      e.dataTransfer.effectAllowed = "move";
    }
  }

  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const target = e.target.closest("li:not(.power-option-card)");
    if (target && target !== this.draggedElement) {
      target.style.borderTop = "2px solid #667eea";
    }
  }

  onDrop(e) {
    e.preventDefault();

    const target = e.target.closest("li:not(.power-option-card)");
    if (target && target !== this.draggedElement) {
      const unitList = document.querySelector("#experimentUnitsList");
      const allItems = Array.from(
        unitList.querySelectorAll("li:not(.power-option-card)")
      );

      const draggedIndex = allItems.indexOf(this.draggedElement);
      const targetIndex = allItems.indexOf(target);

      if (draggedIndex < targetIndex) {
        target.parentNode.insertBefore(this.draggedElement, target.nextSibling);
      } else {
        target.parentNode.insertBefore(this.draggedElement, target);
      }

      this.onUnitSelectionChanged();
    }
  }

  onDragEnd(e) {
    if (this.draggedElement) {
      this.draggedElement.style.opacity = "1";
    }

    // 清除所有拖曳視覺提示
    document.querySelectorAll("#experimentUnitsList li").forEach((li) => {
      li.style.borderTop = "none";
    });

    this.draggedElement = null;
  }

  moveUnit(li, direction) {
    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    const allItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)")
    );
    const currentIndex = allItems.indexOf(li);
    const newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < allItems.length) {
      if (direction > 0) {
        li.parentNode.insertBefore(allItems[newIndex].nextSibling, li);
      } else {
        li.parentNode.insertBefore(li, allItems[newIndex]);
      }

      this.onUnitSelectionChanged();
    }

    this.updateUnitButtonStates();
  }

  updateUnitButtonStates() {
    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    const allItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)")
    );

    allItems.forEach((li, index) => {
      const upBtn = li.querySelector(".unit-up-btn");
      const downBtn = li.querySelector(".unit-down-btn");

      if (upBtn) {
        upBtn.disabled = index === 0;
        upBtn.classList.toggle("disabled", index === 0);
      }
      if (downBtn) {
        downBtn.disabled = index === allItems.length - 1;
        downBtn.classList.toggle("disabled", index === allItems.length - 1);
      }
    });
  }

  onUnitSelectionChanged() {
    // 更新按鈕狀態
    this.updateUnitButtonStates();

    // 取得目前選擇的單元順序
    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    const selectedUnits = [];
    unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        selectedUnits.push(li.dataset.unitId);
      }
    });

    // 產生新的組合順序
    if (selectedUnits.length > 0) {
      // 建立一個自定義的臨時組合
      const customCombination = {
        combination_id: "custom",
        combination_name: "自訂組合",
        description: "根據選擇和排序產生的自訂組合",
        units: selectedUnits,
        is_randomizable: false,
      };

      // 更新目前組合並重新載入腳本
      const experimentId = document
        .getElementById("experimentIdInput")
        .value.trim();
      this.loadScriptForCombination(customCombination, experimentId);

      // 更新組合選擇面板，標記為 custom（取消所有 active 標記）
      document.querySelectorAll(".combination-item").forEach((el) => {
        el.classList.remove("active");
      });
    }
  }

  startExperiment() {
    // 驗證至少選擇一個教學單元
    const checkedUnits = document.querySelectorAll(
      '.unit-checkbox input[type="checkbox"]:checked'
    );
    const validUnits = Array.from(checkedUnits).filter((cb) => {
      const li = cb.closest("li");
      return (
        li &&
        !li.classList.contains("startup-card") &&
        !li.classList.contains("shutdown-card")
      );
    });

    if (validUnits.length === 0) {
      Logger.warn("無法開始實驗：請至少選擇一個教學單元");
      return;
    }

    // 驗證實驗ID - 優先使用 this.experimentId（可能來自機台面板）
    let experimentId =
      this.experimentId ||
      document.getElementById("experimentIdInput")?.value?.trim() ||
      "";

    if (!experimentId) {
      Logger.warn("請輸入實驗ID");
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) experimentIdInput.focus();
      return;
    }

    // 確認實驗ID已同步到本機
    if (!this.experimentId) {
      this.experimentId = experimentId;
    }

    // 確認是否有載入的實驗腳本
    if (
      !this.currentCombination ||
      !this.currentCombination.gestures ||
      this.currentCombination.gestures.length === 0
    ) {
      Logger.warn("請先選擇實驗組合並載入手勢序列");
      return;
    }

    // 記錄實驗開始
    const subjectName = document.getElementById("subjectName").value.trim();
    const experimentData = {
      experiment_id: experimentId,
      subject_name: subjectName,
      combination_id: this.currentCombination.combination_id,
      combination_name: this.currentCombination.combination_name,
      unit_count: validUnits.length,
      gesture_count: this.currentCombination.gestures.length,
      start_time: new Date().toISOString(),
    };

    // 初始化日誌管理器
    if (window.experimentLogManager) {
      // 如果沒有輸入受試者名稱，使用「受試者_實驗ID」作為預設值
      const defaultSubjectName = subjectName || `受試者_${experimentId}`;
      window.experimentLogManager.initialize(experimentId, defaultSubjectName);
      window.experimentLogManager.logExperimentStart();
    }

    this.logAction("experiment_started", experimentData);

    // 視覺回饋：滾動到第一個手勢步驟並新增浮起效果
    const firstGestureCard = document.getElementById("gesture-card-0");
    if (firstGestureCard) {
      firstGestureCard.scrollIntoView({ behavior: "smooth", block: "start" });

      // 新增浮起效果
      firstGestureCard.classList.remove("gesture-card-inactive");
      firstGestureCard.classList.add("gesture-card-active");

      // 高亮第一個步驟（計時器區域）
      const timerCard = document.getElementById("timer-card-0");
      if (timerCard) {
        timerCard.style.boxShadow = "0 0 0 4px #4caf50";
        setTimeout(() => {
          timerCard.style.boxShadow = "";
        }, 1500);
      }

      //不在這裡記錄第一個步驟開始
      // 第一個步驟開始應該等到使用者點擊計時器開始計時時才記錄
      // 參見 experiment-timer-utils.js 的 toggleTimer 函數
    }

    // 更新實驗狀態
    this.experimentRunning = true;

    // 分發事件供同步管理器使用
    // 準備廣播 experiment_started 事件，手勢數: this.currentCombination.gestures?.length || 0

    document.dispatchEvent(
      new CustomEvent("experiment_started", {
        detail: {
          experimentId: experimentData.experiment_id,
          subjectName: experimentData.subject_name,
          combinationId: experimentData.combination_id,
          combinationName: experimentData.combination_name,
          gestureSequence: this.currentCombination.gestures, // 完整的手勢序列
          unitCount: experimentData.unit_count,
          gestureCount: experimentData.gesture_count,
        },
      })
    );

    this.toggleExperimentUI(true); // 鎖定 UI

    // 註冊實驗狀態到中樞
    this.registerExperimentStateToHub({
      experiment_id: experimentData.experiment_id,
      subject_name: experimentData.subject_name,
      combination_name: experimentData.combination_name,
      combination_id: experimentData.combination_id,
      gesture_count: experimentData.gesture_count,
      is_running: true,
    });

    // 啟動計時器
    resetTimer();
    toggleTimer();

    // 初始化實驗計時器顯示
    this.experimentStartTime = Date.now();
    this.experimentElapsedTime = 0;
    const experimentTimerDisplay = document.getElementById("experimentTimer");
    if (experimentTimerDisplay) {
      experimentTimerDisplay.style.display = "block";
    }

    // 建立實驗計時器間隔器
    this.experimentTimerInterval = setInterval(() => {
      if (!this.experimentPaused && this.experimentRunning) {
        this.experimentElapsedTime = Date.now() - this.experimentStartTime;
        const totalSeconds = Math.floor(this.experimentElapsedTime / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const milliseconds = this.experimentElapsedTime % 1000;
        const timeString = `${String(minutes).padStart(2, "0")}:${String(
          seconds
        ).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;

        if (experimentTimerDisplay) {
          experimentTimerDisplay.textContent = timeString;
        }
      }
    }, 50); // 每 50 毫秒更新一次，以便毫秒顯示更流暢

    // 初始化受試者名稱狀態
    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput) {
      this.subjectName = subjectNameInput.value.trim();
      this.lastSavedSubjectName = this.subjectName;
      // 清除儲存按鈕顯示（因為目前還沒有改動）
      const saveSubjectNameBtn = document.getElementById("saveSubjectNameBtn");
      if (saveSubjectNameBtn) {
        saveSubjectNameBtn.style.display = "none";
      }
    }
  }

  stopExperiment(isManualStop = true) {
    // 檢查是否正在進行實驗
    if (!this.experimentRunning) {
      return;
    }

    // 記錄停止類型
    // 實驗已停止

    // 更新實驗狀態
    this.experimentRunning = false;

    // 處理等待中的更新
    if (this.pendingExperimentIdUpdate) {
      // 套用等待中的實驗ID更新
      this.handleRemoteExperimentIdUpdate(this.pendingExperimentIdUpdate);
      this.pendingExperimentIdUpdate = null;
    }

    if (this.pendingSubjectNameUpdate) {
      // 套用等待中的受試者名稱更新
      this.handleRemoteSubjectNameUpdate(this.pendingSubjectNameUpdate);
      this.pendingSubjectNameUpdate = null;
    }

    // 分發事件供同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_stopped", {
        detail: {
          experimentId:
            document.getElementById("experimentIdInput")?.value || "",
          subjectName: document.getElementById("subjectName")?.value || "",
          combinationName: this.currentCombination?.combination_name || "",
        },
      })
    );

    // 記錄實驗結束
    const experimentData = {
      experiment_id: document.getElementById("experimentIdInput")?.value || "",
      subject_name: document.getElementById("subjectName")?.value || "",
      combination: this.currentCombination?.combination_name || "",
      end_time: new Date().toISOString(),
    };

    if (window.experimentLogManager) {
      window.experimentLogManager.logExperimentEnd();
      // 強制發送所有待發送的日誌
      window.experimentLogManager.flushAll();
      // 顯示下載按鈕
      const logDownloadBtns = document.getElementById("logDownloadBtns");
      if (logDownloadBtns) {
        logDownloadBtns.style.display = "inline";
      }
    }

    this.logAction("experiment_stopped", experimentData);

    // 移除所有卡片的浮起效果
    document.querySelectorAll(".gesture-card-active").forEach((card) => {
      card.classList.remove("gesture-card-active");
      card.classList.add("gesture-card-inactive");
    });

    // 停止所有計時器（不使用 toggleTimer 避免觸發日誌記錄）
    if (window.timerStates) {
      Object.keys(window.timerStates).forEach((idx) => {
        const state = window.timerStates[idx];
        if (state && state.running) {
          // 停止計時器間隔
          if (window.timerIntervals && window.timerIntervals[idx]) {
            clearInterval(window.timerIntervals[idx]);
          }
          state.running = false;
          state.elapsedTime += Date.now() - state.startTime;
        }
      });
    }

    // 清除實驗計時器間隔器
    if (this.experimentTimerInterval) {
      clearInterval(this.experimentTimerInterval);
      this.experimentTimerInterval = null;
    }

    // 隱藏實驗計時器顯示
    const experimentTimerDisplay = document.getElementById("experimentTimer");
    if (experimentTimerDisplay) {
      experimentTimerDisplay.style.display = "none";
    }

    // 隱藏受試者名稱儲存按鈕
    const saveSubjectNameBtn = document.getElementById("saveSubjectNameBtn");
    if (saveSubjectNameBtn) {
      saveSubjectNameBtn.style.display = "none";
    }

    // 解鎖 UI
    this.toggleExperimentUI(false);

    //廣播實驗停止狀態到其他連線裝置（僅人為停止時廣播）
    if (isManualStop) {
      this.broadcastExperimentStop();
    } else {
      // 自動停止時，產生新的實驗ID（會自動廣播到同步工作階段）
      const newId = this.generateNewExperimentId();

      // 更新日誌管理器的實驗ID
      if (window.experimentLogManager) {
        window.experimentLogManager.setExperimentId(newId);
      }

      // 更新受試者名稱為新的預設值
      const subjectNameInput = document.getElementById("subjectName");
      if (subjectNameInput) {
        subjectNameInput.value = `受試者_${newId}`;
        this.subjectName = subjectNameInput.value;
      }
    }

    // 顯示統計面板
    setTimeout(() => {
      this.exportManager.displayStatisticsOnPage();
    }, 500);
  }

  togglePauseExperiment() {
    // 檢查是否正在進行實驗
    if (!this.experimentRunning) {
      return;
    }

    // 切換暫停狀態
    this.experimentPaused = !this.experimentPaused;

    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = this.experimentPaused ? "▶ 繼續" : "⏸ 暫停";
    }

    if (this.experimentPaused) {
      // 暫停實驗
      toggleTimer();
      if (window.logger) {
        window.logger.logExperimentPause();
      }
      // 分發暫停事件
      document.dispatchEvent(
        new CustomEvent("experiment_paused", {
          detail: { isPaused: true },
        })
      );
      //廣播暫停狀態到其他連線裝置
      this.broadcastExperimentPauseState(true);
    } else {
      // 繼續實驗
      toggleTimer();
      if (window.logger) {
        window.logger.logExperimentResume();
      }
      // 分發還原事件
      document.dispatchEvent(
        new CustomEvent("experiment_resumed", {
          detail: { isPaused: false },
        })
      );
      //廣播還原狀態到其他連線裝置
      this.broadcastExperimentPauseState(false);
    }
  }

  toggleExperimentUI(locked) {
    // 實驗 ID 欄位
    const experimentIdInput = document.getElementById("experimentIdInput");
    const regenerateIdBtn = document.getElementById("regenerateIdButton");
    if (experimentIdInput) experimentIdInput.disabled = locked;
    if (regenerateIdBtn) regenerateIdBtn.disabled = locked;

    // 受試者名稱欄位
    const subjectNameInput = document.getElementById("subjectName");
    const saveSubjectNameBtn = document.getElementById("saveSubjectNameBtn");
    if (subjectNameInput) subjectNameInput.disabled = locked;
    if (saveSubjectNameBtn) saveSubjectNameBtn.disabled = locked;

    // 組合選擇按鈕
    document.querySelectorAll(".combination-item").forEach((btn) => {
      btn.style.pointerEvents = locked ? "none" : "auto";
      btn.style.opacity = locked ? "0.5" : "1";
    });

    // 單元勾選框
    document
      .querySelectorAll('.unit-checkbox input[type="checkbox"]')
      .forEach((cb) => {
        cb.disabled = locked;
      });

    // 全選按鈕
    const selectAllBtn = document.getElementById("selectAllUnits");
    if (selectAllBtn) selectAllBtn.disabled = locked;

    // 切換開始/停止按鈕顯示
    const experimentIdRow = document.getElementById("experimentIdRow");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons"
    );

    if (experimentIdRow) {
      experimentIdRow.style.display = locked ? "none" : "flex";
    }
    if (experimentControlButtons) {
      experimentControlButtons.style.display = locked ? "flex" : "none";
    }

    // 實驗中時隱藏計時器按鈕顯示區
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer && locked) {
      experimentTimer.style.display = "inline";
    }
  }

  /** 設定受試者名稱監聽器 */
  setupSubjectNameListener() {
    const subjectNameInput = document.getElementById("subjectName");
    const saveSubjectNameBtn = document.getElementById("saveSubjectNameBtn");

    if (!subjectNameInput) return;

    // 初始化受試者名稱
    this.subjectName = subjectNameInput.value.trim();
    this.lastSavedSubjectName = this.subjectName;

    // 監聽輸入框變更
    subjectNameInput.addEventListener("input", (e) => {
      const newValue = e.target.value.trim();

      // 如果內容改變且實驗正在進行，顯示儲存按鈕
      if (this.experimentRunning && newValue !== this.lastSavedSubjectName) {
        if (saveSubjectNameBtn) {
          saveSubjectNameBtn.style.display = "block";
        }
      } else if (saveSubjectNameBtn) {
        saveSubjectNameBtn.style.display = "none";
      }
    });

    // 監聽儲存按鈕點擊
    if (saveSubjectNameBtn) {
      saveSubjectNameBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.saveAndBroadcastSubjectName();
      });
    }

    // 監聽 Enter 鍵儲存
    subjectNameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (
          this.experimentRunning &&
          saveSubjectNameBtn &&
          saveSubjectNameBtn.style.display !== "none"
        ) {
          this.saveAndBroadcastSubjectName();
        }
      }
    });
  }

  /** 儲存並廣播受試者名稱變更 */
  saveAndBroadcastSubjectName() {
    const subjectNameInput = document.getElementById("subjectName");
    const saveSubjectNameBtn = document.getElementById("saveSubjectNameBtn");

    if (!subjectNameInput) return;

    const newValue = subjectNameInput.value.trim();

    // 更新內部狀態
    this.subjectName = newValue;
    this.lastSavedSubjectName = newValue;

    // 隱藏儲存按鈕
    if (saveSubjectNameBtn) {
      saveSubjectNameBtn.style.display = "none";
    }

    // 廣播受試者名稱變更到其他裝置
    this.broadcastSubjectNameChange(newValue);

    // 記錄日誌
    this.logAction("subject_name_updated", {
      subject_name: newValue,
      timestamp: new Date().toISOString(),
    });

    // 受試者名稱已儲存
  }

  /** 監聽遠端實驗狀態變化 */
  setupRemoteEventListeners() {
    // 監聽來自 index.html 的按鈕動作廣播
    document.addEventListener("experimentStateChange", (event) => {
      const data = event.detail;
      // 收到遠端事件

      if (!data || !data.type) return;

      switch (data.type) {
        // 注意：button_action 不在此處理
        // 它已通過 remote_button_action 事件（來自同步系統）處理
        // 避免重複處理來自本機 Panel 的原始事件
        case "experimentInitialize":
          this.handleRemoteExperimentInit(data);
          break;
        case "experimentPaused":
          this.handleRemoteExperimentPaused(data);
          break;
        case "experimentResumed":
          this.handleRemoteExperimentResumed(data);
          break;
        case "experiment_started":
          this.handleRemoteExperimentStarted(data);
          break;
        case "experiment_stopped":
        case "experimentStopped":
          this.handleRemoteExperimentStopped(data);
          break;
        default:
          Logger.warn("未知的遠端事件類型:", data.type);
      }
    });

    // 監聽同步狀態更新（用於接收面板同步操作者的 action）
    window.addEventListener("sync_state_update", (event) => {
      const state = event.detail;
      if (!state) return;

      // 通過 sync_state_update 接收狀態更新

      // 處理面板廣播的實驗初始化
      if (state.type === "experimentInitialize" && state.source === "panel") {
        // 接收到機台面板的實驗開始訊號
        this.handleRemoteExperimentInit(state);
      }
      // 處理面板的按鈕動作（button_action）
      else if (state.type === "button_action") {
        // 通過 sync_state_update 接收 button_action
        this.handleRemoteButtonAction(state);
      }
      // 處理面板的實驗狀態更新
      else if (
        state.type === "panel_experiment_state_update" &&
        state.source === "panel"
      ) {
        this.handlePanelExperimentStateUpdate(state);
      }
      // 處理面板的 action 完成
      else if (state.type === "action_completed" && state.source === "panel") {
        this.handleRemoteActionCompleted(state);
      }
      // 注意：已移除 panel_action 處理，面板按鈕動作統一使用 button_action
      else if (
        state.type === "experiment_started" &&
        state.source === "panel"
      ) {
        // 如果是面板啟動的實驗
        // 接收面板實驗啟動訊號
        this.logAction("panel_experiment_started", {
          device_id: state.device_id,
          timestamp: state.timestamp,
        });
      }
      //處理面板的暫停訊號
      else if (state.type === "experiment_paused" && state.source === "panel") {
        // 接收到機台面板的暫停訊號
        if (!this.experimentPaused) {
          this.togglePauseExperiment();
        }
      }
      //處理面板的還原訊號
      else if (
        state.type === "experiment_resumed" &&
        state.source === "panel"
      ) {
        // 接收到機台面板的還原訊號
        if (this.experimentPaused) {
          this.togglePauseExperiment();
        }
      }
      //處理面板的停止訊號
      else if (
        state.type === "experiment_stopped" &&
        state.source === "panel"
      ) {
        // 接收到機台面板的停止訊號
        if (this.experimentRunning || this.experimentPaused) {
          //響應遠端停止訊號時不廣播（false = 不廣播）
          this.stopExperiment(false);
        }
      }
    });

    // 監聽來自其他 experiment.html 裝置的實驗狀態變化
    window.addEventListener("remote_experiment_started", (event) => {
      this.handleRemoteExperimentStarted(event.detail);
    });

    window.addEventListener("remote_experiment_paused", (event) => {
      this.handleRemoteExperimentPaused(event.detail);
    });

    window.addEventListener("remote_experiment_resumed", (event) => {
      this.handleRemoteExperimentResumed(event.detail);
    });

    window.addEventListener("remote_experiment_stopped", (event) => {
      this.handleRemoteExperimentStopped(event.detail);
    });

    // 監聽來自實驗中樞的實驗ID廣播更新
    window.addEventListener("experiment_id_broadcasted", (event) => {
      const { experimentId, device_id } = event.detail;
      const hubManager = getExperimentHubManager();

      // 避免自己廣播的回音
      if (device_id === hubManager.hubClient.clientId) {
        return;
      }

      Logger.debug(
        `[ExperimentPageManager] 收到遠程實驗ID廣播: ${experimentId}`
      );

      // 更新本機UI
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput && experimentIdInput.value !== experimentId) {
        experimentIdInput.value = experimentId;
        Logger.info(
          `[ExperimentPageManager] 已同步實驗ID到UI: ${experimentId}`
        );
      }
    });

    // 監聽組合選擇事件
    document.addEventListener("combination_selected", (event) => {
      const { combination } = event.detail;
      if (combination) {
        // 更新目前組合
        this.currentCombination = combination;

        // 載入對應的腳本
        const experimentId = document
          .getElementById("experimentIdInput")
          .value.trim();
        this.loadScriptForCombination(combination, experimentId);
      }
    });

    //新增：監聽遠端按鈕動作
    window.addEventListener("remote_button_action", (event) => {
      this.handleRemoteButtonAction(event.detail);
    });
  }

  /**
   * 處理來自面板的實驗狀態更新
   * 更新experiment.html頁面上顯示的面板狀態
   */
  handlePanelExperimentStateUpdate(syncData) {
    const { data } = syncData;
    if (!data) return;

    // 接收面板實驗狀態更新

    // 在experiment.html中觸發事件，更新虛擬面板的狀態顯示
    const event = new CustomEvent("remote_panel_state_update", {
      detail: data,
    });
    document.dispatchEvent(event);
  }

  /**
   * 處理來自面板的 action 完成同步
   * 若實驗管理中的手勢序列對應的步驟中有相同的 action，則更新狀態
   */
  handleRemoteActionCompleted(syncData) {
    const { action_id, source, device_id, timestamp } = syncData;

    // 接收遠端 action 完成

    // 記錄到日誌
    this.logAction("remote_action_completed", {
      action_id: action_id,
      source: source,
      device_id: device_id,
      timestamp: timestamp,
    });

    // 在實驗進行中時，檢查是否有對應的步驟
    if (this.experimentRunning && this.currentCombination) {
      // 取得對應 action 的步驟資訊
      const stepInfo = this.actionToStepMap?.get(action_id);

      if (stepInfo) {
        // 如果 action 對應的步驟在目前或已完成的步驟中，可以進行狀態同步
        // 例如：自動推進到下一步、更新進度等
        const stepIndex = this.currentCombination.steps?.findIndex(
          (s) => s.step_id === stepInfo.step_id
        );

        if (stepIndex !== undefined && stepIndex >= 0) {
          // 這裡可以新增額外的狀態同步邏輯
          // 例如自動推進到下一步或更新 UI
        }
      } else {
      }
    }
  }

  /**
   * [已移除] handleSyncPanelAction - 改用 handleRemoteButtonAction
   * [已移除] displayPanelActionFeedback - 視覺回饋已整合至 handleRemoteButtonAction
   *
   * 面板按鈕動作已統一使用 button_action 事件處理，功能已整合至 handleRemoteButtonAction()
   */

  /** 處理遠端按鈕動作 */
  handleRemoteButtonAction(data) {
    const {
      experiment_id,
      experimentId,
      button,
      button_id,
      action_id,
      function: buttonFunction,
      button_function,
      remote_device_id,
      deviceId,
      timestamp,
    } = data;

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value || "";
    const expId = experiment_id || experimentId;
    const btn = button || button_id;
    const func = buttonFunction || button_function;
    const deviceInfo = remote_device_id || deviceId;
    const actionId = action_id; // 取得 action_id

    // 去重檢查：避免同個 action 在時間視窗內被重複處理
    if (actionId) {
      const now = Date.now();
      const lastProcessTime = this.processedRemoteActions.get(actionId);

      if (
        lastProcessTime &&
        now - lastProcessTime < this.remotActionDedupeWindow
      ) {
        return;
      }

      // 記錄此 action 的處理時間
      this.processedRemoteActions.set(actionId, now);
    }

    //記錄到日誌系統
    if (window.experimentLogManager) {
      window.experimentLogManager.logRemoteButtonAction(btn, func, deviceInfo);
    }

    // 如果目前實驗ID相符，執行相應的 UI 更新
    if (expId === currentExperimentId && this.experimentRunning) {
      // 使用 action_id 標記對應的卡片
      this.showRemoteActionFeedback(
        actionId,
        { button: btn, function: func },
        timestamp
      );
    }
  }

  /** 處理遠端實驗初始化 */
  handleRemoteExperimentInit(data) {
    const { experimentId, currentCombination, subjectName, loadedUnits } = data;

    // 設置實驗ID
    if (experimentId) {
      this.experimentId = experimentId;
      Logger.info(`[接收] 從機台面板同步的實驗ID: ${experimentId}`);

      // 更新輸入框
      const experimentIdInput = document.getElementById("experimentId");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }
    }

    // 如果實驗正在執行，同步受試者名稱
    if (subjectName) {
      const subjectNameInput = document.getElementById("subjectName");
      if (subjectNameInput && subjectNameInput.value.trim() !== subjectName) {
        subjectNameInput.value = subjectName;
        this.subjectName = subjectName;
        this.lastSavedSubjectName = subjectName;
      }
    }

    //接收到機台面板的實驗開始訊號，立即自動開始實驗
    if (!this.experimentRunning) {
      // 確保有必要的設定
      if (currentCombination) {
        this.currentCombination = currentCombination;
      }
      if (loadedUnits) {
        this.loadedUnits = loadedUnits;
      }

      // 自動開始實驗（不管機台是否還在等待開機）
      this.startExperiment();
    }
  }

  /** 處理遠端受試者名稱更新 */
  handleRemoteSubjectNameUpdate(data) {
    // 如果目前實驗正在進行中，等待實驗結束後再同步新的受試者名稱
    if (this.experimentRunning) {
      // 將更新請求加入隊列，等待實驗結束
      this.pendingSubjectNameUpdate = data;
      return;
    }

    const { subjectName } = data;

    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput && subjectNameInput.value.trim() !== subjectName) {
      subjectNameInput.value = subjectName;
      this.subjectName = subjectName;
      this.lastSavedSubjectName = subjectName;
    }
  }

  handleRemoteExperimentIdUpdate(data) {
    // 如果目前實驗正在進行中，等待實驗結束後再同步新的實驗ID
    if (this.experimentRunning) {
      // 將更新請求加入隊列，等待實驗結束
      this.pendingExperimentIdUpdate = data;
      return;
    }

    const { experimentId } = data;

    const experimentIdInput = document.getElementById("experimentId");
    if (experimentIdInput && experimentIdInput.value.trim() !== experimentId) {
      experimentIdInput.value = experimentId;
      this.experimentId = experimentId;
    }
  }

  /** 顯示遠端按鈕動作的視覺回饋 */
  /** 初始化動作卡片顯示區域 */
  initializeActionCardsDisplay() {
    const contentArea = document.getElementById("contentArea");
    if (!contentArea) return;

    // 清空現有內容
    contentArea.innerHTML = "";

    // 建立手勢卡片容器
    const cardsContainer = document.createElement("div");
    cardsContainer.className = "gestures-cards-container";
    cardsContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 8px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    `;

    // 如果沒有載入手勢序列，顯示提示
    if (
      !this.currentCombination ||
      !this.currentCombination.gestures ||
      this.currentCombination.gestures.length === 0
    ) {
      cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #999;">
          <p>尚無手勢序列</p>
        </div>
      `;
      contentArea.appendChild(cardsContainer);
      return;
    }

    // 為每個手勢建立卡片
    this.currentCombination.gestures.forEach((gestureObj, index) => {
      const card = document.createElement("div");
      card.id = `gesture-card-${index}`;
      card.className = "gesture-card gesture-card-inactive";
      card.setAttribute("data-gesture-id", gestureObj.gesture || "");
      card.setAttribute("data-gesture-index", index);
      card.style.cssText = `
        background: white;
        border: 2px solid #ddd;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        cursor: default;
        transition: all 0.3s ease;
        min-height: 100px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-size: 12px;
      `;

      // 從手勢對象直接取得名稱 (loadScriptForCombination 已經設置了)
      const gestureName = gestureObj.name || gestureObj.gesture || "未知手勢";

      const title = document.createElement("div");
      title.style.cssText =
        "font-weight: 700; color: #333; margin-bottom: 6px; word-break: break-word;";
      title.textContent = gestureName;

      const desc = document.createElement("div");
      desc.style.cssText = "font-size: 11px; color: #666;";
      desc.textContent = `步驟 ${index + 1}`;

      card.appendChild(title);
      card.appendChild(desc);

      cardsContainer.appendChild(card);
    });

    contentArea.appendChild(cardsContainer);
  }

  /** 顯示遠端按鈕動作的視覺回饋 - 使用 action_id 直接定位卡片 */
  showRemoteActionFeedback(actionId, buttonData, timestamp) {
    const actionCards = document.querySelectorAll(".action-button");
    if (actionCards.length === 0) {
      Logger.warn("找不到動作卡片");
      return;
    }

    // 如果提供了 action_id，直接使用；否則使用目前 action
    let targetActionId = actionId;
    if (!targetActionId) {
      const currentAction = window.actionManager?.getCurrentAction();
      if (!currentAction) {
        Logger.warn("無法取得目前 action");
        return;
      }
      targetActionId = currentAction.action_id;
    }

    // 用 data-action-id 屬性找到配對的卡片
    let highlightedCard = null;
    let gestureIndex = null;

    actionCards.forEach((card) => {
      const cardAction = card.getAttribute("data-action-id");
      const cardGestureIdx = card.getAttribute("data-gesture-index");

      if (cardAction === targetActionId) {
        highlightedCard = card;
        gestureIndex = cardGestureIdx;

        // 使用 markActionCompleted 標記為已完成（綠色 + 記錄日誌）
        if (window.markActionCompleted) {
          window.markActionCompleted(
            card,
            targetActionId,
            gestureIndex,
            true // isRemote = true，表示來自遠端
          );
        }

        // 新增臨時高亮效果（視覺回饋）
        card.classList.add("remote-action-completed");

        // 2秒後移除臨時高亮（保留綠色完成狀態）
        setTimeout(() => {
          card.classList.remove("remote-action-completed");
        }, 2000);
      }
    });

    if (!highlightedCard) {
      Logger.warn(`找不到對應的卡片 (action_id: ${targetActionId})`);
    }
  }

  highlightMatchingAction(currentGesture, buttonData, remoteDeviceId = null) {
    const buttonName = buttonData.button || "";
    let matchedActionId = null;

    if (currentGesture.actions && currentGesture.actions.length > 0) {
      matchedActionId = currentGesture.actions.find(
        (action) =>
          action.action_name.includes(buttonName) ||
          action.action_id.includes(buttonName)
      )?.action_id;

      if (!matchedActionId) {
        return;
      }
      const matchedCard = document.querySelector(
        `.action-button[data-action-id="${matchedActionId}"]`
      );

      if (matchedCard) {
        matchedCard.style.background = "#4caf50";
        matchedCard.style.boxShadow = "0 0 12px rgba(76, 175, 80, 0.6)";
        matchedCard.style.transition = "all 0.3s ease";

        if (window.experimentLogManager) {
          window.experimentLogManager.logAction(
            matchedActionId,
            this.currentStep,
            null,
            remoteDeviceId
          );
        }
        setTimeout(() => {
          matchedCard.style.background = "#a0a0a0";
          matchedCard.style.boxShadow = "";
          matchedCard.classList.add("action-card-pressed");
        }, 3000);
      } else {
        Logger.warn(`找不到對應的卡片 (action_id: ${matchedActionId})`);
      }
    }
  }

  /** 廣播受試者名稱變更 */
  broadcastSubjectNameChange(subjectName) {
    // 檢查是否存在同步工作階段
    if (!window.syncManager?.core?.isConnected()) {
      return;
    }

    const updateData = {
      type: "subjectNameUpdate",
      device_id: window.syncManager?.deviceId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      subjectName: subjectName,
      timestamp: new Date().toISOString(),
    };

    // 同步到伺服器
    window.syncManager.core.syncState(updateData).catch((error) => {
      Logger.warn("同步受試者名稱更新失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      })
    );
  }

  /** 註冊實驗狀態到中樞 */
  async registerExperimentStateToHub(stateData) {
    try {
      const params = new URLSearchParams({
        action: "register",
        experiment_id: stateData.experiment_id || "",
        subject_name: stateData.subject_name || "",
        combination_name: stateData.combination_name || "",
        combination_id: stateData.combination_id || "",
        gesture_count: stateData.gesture_count || 0,
        gesture_sequence: JSON.stringify(stateData.gesture_sequence || []),
        current_step: stateData.current_step || 0,
        is_running: stateData.is_running ? "true" : "false",
        source: "experiment_manager",
      });

      // 移除 PHP 調用
      // 狀態管理由 ExperimentStateManager 和 WebSocket 處理
      Logger.debug("[ExperimentPageManager] 跳過 PHP API 調用");
    } catch (error) {
      Logger.warn("註冊實驗狀態失敗:", error);
    }
  }

  /** 廣播實驗ID更新到其他連線裝置 */
  broadcastExperimentIdUpdate(experimentId) {
    // 檢查是否存在同步工作階段
    const hubManager = getExperimentHubManager();
    if (!hubManager.isConnected()) {
      return;
    }

    const updateData = {
      type: "experimentIdUpdate",
      device_id: hubManager.hubClient.clientId,
      experimentId: experimentId,
      timestamp: new Date().toISOString(),
    };

    // 使用新的hub manager廣播
    hubManager
      .broadcastUpdate("experiment_id_update", updateData, "fast")
      .catch((error) => {
        Logger.warn("廣播實驗ID更新失敗:", error);
      });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      })
    );
  }

  /** 廣播暫停/還原狀態到其他連線裝置 */
  broadcastExperimentPauseState(isPaused) {
    // 檢查是否存在同步工作階段
    if (!window.syncManager?.core?.isConnected()) {
      return;
    }

    const updateData = {
      type: isPaused ? "experimentPaused" : "experimentResumed",
      device_id: window.syncManager?.deviceId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      isPaused: isPaused,
      timestamp: new Date().toISOString(),
    };

    // 同步到伺服器
    window.syncManager.core.syncState(updateData).catch((error) => {
      Logger.warn("同步實驗暫停狀態失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      })
    );
  }

  /** 廣播實驗停止狀態到其他連線裝置 */
  broadcastExperimentStop() {
    // 檢查是否存在同步工作階段
    if (!window.syncManager?.core?.isConnected()) {
      return;
    }

    const updateData = {
      type: "experimentStopped",
      device_id: window.syncManager?.deviceId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      timestamp: new Date().toISOString(),
    };

    // 同步到伺服器
    window.syncManager.core.syncState(updateData).catch((error) => {
      Logger.warn("同步實驗停止狀態失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      })
    );
  }

  /** 處理遠端實驗開始 */
  handleRemoteExperimentStarted(detail) {
    // 如果本機已在進行實驗，忽略
    if (this.experimentRunning) {
      return;
    }

    // 記錄日誌
    this.logAction("remote_experiment_started_received", {
      remote_device_id: detail.remote_device_id,
      experiment_id: detail.experiment_id,
    });

    // 檢查本機的實驗 ID 是否配對
    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value.trim() || "";
    if (currentExperimentId !== detail.experiment_id) {
      // 更新本機實驗 ID
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) {
        experimentIdInput.value = detail.experiment_id;
      }
    }

    // 檢查受試者名稱是否需要更新
    if (detail.subject_name) {
      const subjectNameInput = document.getElementById("subjectName");
      if (subjectNameInput && !subjectNameInput.value.trim()) {
        subjectNameInput.value = detail.subject_name;
      }
    }

    // 同步單元組合設定
    if (detail.combination_id) {
      const combinationSelect = document.getElementById(
        "unitCombinationSelect"
      );
      if (combinationSelect) {
        combinationSelect.value = detail.combination_id;
        // 觸發組合變更事件以重新載入手勢序列
        combinationSelect.dispatchEvent(new Event("change"));
      }
    }

    // 記錄同步完成
    this.logAction("remote_experiment_started", {
      remote_device_id: detail.remote_device_id,
      experiment_id: detail.experiment_id,
      combination_id: detail.combination_id,
      combination_name: detail.combination_name,
    });
  }

  /** 處理遠端實驗暫停 */
  handleRemoteExperimentPaused(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 如果已經暫停，忽略
    if (this.experimentPaused) {
      return;
    }

    // 同步暫停狀態

    this.experimentPaused = true;

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "▶ 繼續";
    }

    // 停止計時器
    toggleTimer();

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("遠端暫停實驗", null, null, false, false);
    }

    this.logAction("remote_experiment_paused", {
      remote_device_id: detail.remote_device_id,
    });
  }

  /** 處理遠端實驗還原 */
  handleRemoteExperimentResumed(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 如果未暫停，忽略
    if (!this.experimentPaused) {
      return;
    }

    // 同步還原狀態

    this.experimentPaused = false;

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
    }

    // 繼續計時器
    toggleTimer();

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("遠端繼續實驗", null, null, false, false);
    }

    this.logAction("remote_experiment_resumed", {
      remote_device_id: detail.remote_device_id,
    });
  }

  /** 處理遠端實驗停止（僅當使用者手動按下按鈕時同步，自動結束不同步） */
  handleRemoteExperimentStopped(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 記錄日誌
    this.logAction("remote_experiment_stopped_started", {
      remote_device_id: detail.remote_device_id,
    });

    //響應遠端停止訊號時不廣播（false = 不廣播）
    this.stopExperiment(false);

    // 記錄停止完成
    this.logAction("remote_experiment_stopped_completed", {
      remote_device_id: detail.remote_device_id,
    });
  }

  logAction(action, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      action: action,
      data: data,
    };

    if (window.logger) {
      window.logger.logAction(action, "experiment_manager", data);
    }
  }
}

// 建立全域 app 實例
// 匯出實驗頁面管理器單例（實驗頁面專用）
window.experimentPageManager = new ExperimentPageManager();

// 為實驗頁面提供相容性
window.app = window.experimentPageManager;
const app = window.app; // 為了向後相容

// 暴露工具函式到全域作用域供 HTML 使用
window.toggleTimer = toggleTimer;
window.formatDuration = formatDuration;
window.resetTimer = resetTimer;
window.timerLongPressStart = timerLongPressStart;
window.timerLongPressEnd = timerLongPressEnd;

/**
 * 處理 action 按鈕點擊（供 HTML onclick 使用）
 * 支援：點擊標記完成、雙擊取消完成
 * @param {HTMLElement} buttonElement - 按鈕元素
 * @param {string} actionId - 動作ID
 * @param {number} gestureIndex - 手勢索引
 */
window.handleActionClick = function (buttonElement, actionId, gestureIndex) {
  const isCompleted = buttonElement.getAttribute("data-completed") === "true";
  const now = Date.now();
  const lastClickTime = parseInt(
    buttonElement.getAttribute("data-last-click") || "0"
  );
  const clickDelay = now - lastClickTime;

  // 更新最後點擊時間
  buttonElement.setAttribute("data-last-click", now);

  // 判斷是否為雙擊（300ms 內的第二次點擊）
  const isDoubleClick = clickDelay < 300;

  if (isDoubleClick && isCompleted) {
    // 雙擊已完成的按鈕 -> 取消完成
    window.cancelActionCompletion(buttonElement, actionId, gestureIndex);
  } else if (!isCompleted) {
    // 單擊未完成的按鈕 -> 標記完成
    window.markActionCompleted(buttonElement, actionId, gestureIndex, false);
  }
};

/**
 * 標記 action 為已完成
 * @param {HTMLElement} buttonElement - 按鈕元素
 * @param {string} actionId - 動作ID
 * @param {number} gestureIndex - 手勢索引
 * @param {boolean} isRemote - 是否為遠端同步觸發
 */
window.markActionCompleted = function (
  buttonElement,
  actionId,
  gestureIndex,
  isRemote = false
) {
  // 取得裝置 ID
  let deviceId = null;
  if (window.syncClient) {
    deviceId = window.syncClient.clientId;
  }

  // 更新按鈕狀態
  buttonElement.setAttribute("data-completed", "true");
  buttonElement.style.background = "#c8e6c9";
  buttonElement.style.borderColor = "#4caf50";
  buttonElement.style.boxShadow = "0 0 8px rgba(76, 175, 80, 0.3)";

  // 記錄到實驗日誌（只有非遠端同步時才記錄，避免重複）
  if (!isRemote && window.experimentLogManager) {
    window.experimentLogManager.logAction(
      actionId,
      gestureIndex,
      null,
      deviceId
    );
  }

  // 如果是本機操作（非遠端同步），則廣播到其他裝置
  if (!isRemote && window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: "action_completed",
        action_id: actionId,
        gesture_index: gestureIndex,
        device_id: deviceId,
        timestamp: new Date().toISOString(),
      })
      .catch((error) => {
        Logger.warn("同步動作完成狀態失敗:", error);
      });
  }
};

/**
 * 取消 action 的完成狀態
 * @param {HTMLElement} buttonElement - 按鈕元素
 * @param {string} actionId - 動作ID
 * @param {number} gestureIndex - 手勢索引
 */
window.cancelActionCompletion = function (
  buttonElement,
  actionId,
  gestureIndex
) {
  // 取得裝置 ID
  let deviceId = null;
  if (window.syncClient) {
    deviceId = window.syncClient.clientId;
  }

  // 還原按鈕狀態
  buttonElement.setAttribute("data-completed", "false");
  buttonElement.style.background = "#e8eeff";
  buttonElement.style.borderColor = "#667eea";
  buttonElement.style.boxShadow = "";

  // 記錄取消操作到實驗日誌
  if (window.experimentLogManager) {
    window.experimentLogManager.logAction(
      `${actionId}_CANCELLED`,
      gestureIndex,
      null,
      deviceId
    );
  }

  // 廣播取消狀態到其他裝置
  if (window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: "action_cancelled",
        action_id: actionId,
        gesture_index: gestureIndex,
        device_id: deviceId,
        timestamp: new Date().toISOString(),
      })
      .catch((error) => {
        Logger.warn("同步動作取消狀態失敗:", error);
      });
  }
};
window.markGesture = markGesture;
window.goToNextStep = goToNextStep;
window.toggleLeftPanel = toggleLeftPanel;
window.toggleGestureStats = toggleGestureStats;
