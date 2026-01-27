/**
 * 實驗組合選擇器 - 中央管理器
 * 負責在機台面板和實驗頁面中統一管理實驗組合的選擇
 * 支援同步狀態下的廣播
 */

import { RandomUtils } from "./random-utils.js";
import { SyncEvents } from "./sync-events-constants.js";

class CombinationSelector {
  constructor() {
    this.currentCombination = null;
    this.scriptData = null;
    this.isInitialized = false;
    this.initialize();
  }

  /**
   * 初始化組合選擇器
   */
  async initialize() {
    // 監聽實驗開始事件
    window.addEventListener("experiment_started", (e) => {
      this.handleExperimentStart(e.detail);
    });

    // 監聽實驗ID更新
    window.addEventListener("experiment_id_changed", (e) => {
      // 當實驗ID更新時，如果已有組合，需要重新套用以更新隨機順序
      if (this.currentCombination) {
        this.selectCombination(this.currentCombination, e.detail?.experimentId);
      } else {
        this.checkAndApplyDefaultCombination(e.detail?.experimentId);
      }
    });

    // 監聽同步連線變化
    window.addEventListener(SyncEvents.SESSION_JOINED, () => {
      this.onSyncConnected();
    });

    // 監聽遠端同步狀態更新 - 接收遠端的組合選擇廣播
    window.addEventListener(SyncEvents.STATE_UPDATE, (e) => {
      const state = e.detail;
      if (state?.type === "combination_selected" && state?.combination) {
        this.handleRemoteCombinationSelected(state.combination);
      }
    });

    this.isInitialized = true;

    // 立即檢查並套用預設組合（頁面載入時）
    await this.checkAndApplyDefaultCombination();
  }

  /**
   * 載入 script 資料並取得所有可用組合
   */
  async loadScriptData() {
    if (this.scriptData) return this.scriptData;

    try {
      const response = await fetch("data/scenarios.json");
      if (!response.ok) throw new Error("Failed to load scenarios.json");
      this.scriptData = await response.json();
      return this.scriptData;
    } catch (error) {
      Logger.error("載入 scenarios.json 失敗:", error);
      return null;
    }
  }

  /**
   * 取得所有可用組合
   */
  async getAvailableCombinations() {
    const scriptData = await this.loadScriptData();
    if (!scriptData) return [];

    return scriptData.combinations || [];
  }

  /**
   * 選擇並套用組合
   */
  async selectCombination(combination, experimentId = null) {
    if (!combination) return;

    // 如果沒有提供 experimentId，嘗試取得目前的
    if (!experimentId || !experimentId.trim()) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      experimentId = experimentIdInput ? experimentIdInput.value.trim() : null;
      // 如果仍然為空，使用預設種子以避免隨機化
      if (!experimentId) {
        experimentId = "default";
      }
    }

    this.currentCombination = combination;

    // 1. 儲存到本機快取以便離線時還原
    this.saveCombination(combination);

    // 2. 更新視覺上的組合卡片選擇
    this.updateCombinationCardSelection(combination);

    // 3. 更新實驗面板的單元列表
    this.updateUnitListForCombination(combination, experimentId);

    // 4. 如果在同步中且線上，廣播此選擇
    if (this.isInSyncSession() && this.isOnline()) {
      this.broadcastCombinationSelection(combination);
    }

    // 5. 廣播本機事件
    this.dispatchCombinationSelectedEvent(combination);
  }

  /**
   * 處理遠端組合選擇
   * 當收到同步狀態更新時調用
   */
  handleRemoteCombinationSelected(combination) {
    // 必須線上才能接收遠端組合選擇
    if (!this.isOnline()) {
      return;
    }

    // 確保 scenarios 資料已載入
    this.loadScriptData().then(() => {
      // 使用 selectCombination 來套用遠端選擇
      this.selectCombination(combination);
    });
  }

  /**
   * 檢查並套用預設組合
   */
  async checkAndApplyDefaultCombination(experimentId = null) {
    // 如果沒有提供 experimentId，嘗試取得目前的
    if (!experimentId) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      experimentId = experimentIdInput ? experimentIdInput.value.trim() : null;
      // 如果仍然為空，使用預設種子
      if (!experimentId) {
        experimentId = "default";
      }
    }

    // 確保 script 資料已載入
    await this.loadScriptData();
    if (!this.scriptData) {
      Logger.error("scriptData 載入失敗");
      return;
    }

    // 如果已有目前組合，不需要套用預設
    if (this.currentCombination) {
      return;
    }

    // 1. 優先嘗試還原本機快取的組合（記憶使用者上次的選擇）
    const savedCombination = this.getSavedCombination();
    if (savedCombination) {
      // 從 scriptData 中找到完整的組合資料
      const fullCombination = this.scriptData.unit_combinations?.find(
        (c) => c.combination_id === savedCombination.combination_id
      );
      if (fullCombination) {
        this.selectCombination(fullCombination, experimentId);
      } else {
        Logger.warn("本機快取的組合找不到:", savedCombination.combination_id);
      }
      return;
    }

    // 2. 如果無本機快取，嘗試使用設定的預設組合
    const defaultCombinationId =
      window.CONFIG?.experiment?.defaultCombinationId;
    if (defaultCombinationId) {
      const defaultCombination = this.scriptData.unit_combinations?.find(
        (c) => c.combination_id === defaultCombinationId
      );

      if (defaultCombination) {
        this.selectCombination(defaultCombination, experimentId);
        return;
      } else {
        Logger.warn("設定的預設組合找不到:", defaultCombinationId);
      }
    }

    // 3. 備選方案：使用第一個可用的組合以避免未選擇狀態
    const firstCombination = this.scriptData.unit_combinations?.[0];
    if (firstCombination) {
      this.selectCombination(firstCombination, experimentId);
      return;
    }

    Logger.error("沒有任何可用的組合");
  }

  /**
   * 更新組合卡片的視覺狀態
   */
  updateCombinationCardSelection(combination) {
    // 機台面板側的預設組合按鈕
    const panelButtons = document.querySelectorAll(".default-combo-btn");
    panelButtons.forEach((btn) => {
      const isSelected =
        btn.dataset.combinationId === combination.combination_id;
      btn.classList.toggle("active", isSelected);
    });

    // 實驗頁面側的組合卡片
    const experimentCards = document.querySelectorAll(".combination-item");
    experimentCards.forEach((card, index) => {
      const cardCombination = this.scriptData?.unit_combinations?.[index];
      const isSelected =
        cardCombination?.combination_id === combination.combination_id;
      card.classList.toggle("active", isSelected);
    });
  }

  /**
   * 更新單元列表以反映組合內容
   */
  updateUnitListForCombination(combination, experimentId = null) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 取得該組合包含的單元 ID
    let combinationUnitIds = this.getCombinationUnitIds(
      combination,
      experimentId
    );

    // 更新單元選擇狀態
    const allCheckboxes = unitList.querySelectorAll("input[type=\"checkbox\"]");
    allCheckboxes.forEach((checkbox) => {
      const li = checkbox.closest("li");
      const unitId = li.dataset.unitId;

      // 特殊處理開機/關機卡片
      if (
        li.classList.contains("startup-card") ||
        li.classList.contains("shutdown-card")
      ) {
        checkbox.checked = true;
      } else if (unitId) {
        checkbox.checked = combinationUnitIds.includes(unitId);
      }
    });

    // 重新排列單元順序以符合組合要求
    this.reorderUnitList(unitList, combinationUnitIds);
  }

  /**
   * 取得組合中的單元 ID 列表（使用統一的 RandomUtils）
   */
  getCombinationUnitIds(combination, experimentId = null) {
    // 使用統一的隨機化工具
    return RandomUtils.getCombinationUnitIds(combination, experimentId);
  }

  /**
   * 重新排列單元列表
   */
  reorderUnitList(unitList, unitIds) {
    const allItems = Array.from(unitList.children);
    const startupCard = allItems.find((li) =>
      li.classList.contains("startup-card")
    );
    const shutdownCard = allItems.find((li) =>
      li.classList.contains("shutdown-card")
    );
    const normalItems = allItems.filter(
      (li) => !li.classList.contains("power-option-card")
    );

    const orderedItems = [];

    // 1. 開機卡片
    if (startupCard) orderedItems.push(startupCard);

    // 2. 按順序新增選中的單元
    unitIds.forEach((unitId) => {
      const item = normalItems.find((li) => li.dataset.unitId === unitId);
      if (item) orderedItems.push(item);
    });

    // 3. 新增未選中的單元
    normalItems.forEach((item) => {
      if (!unitIds.includes(item.dataset.unitId)) {
        orderedItems.push(item);
      }
    });

    // 4. 關機卡片
    if (shutdownCard) orderedItems.push(shutdownCard);

    // 更新 DOM
    unitList.innerHTML = "";
    orderedItems.forEach((item) => unitList.appendChild(item));
  }

  /**
   * 廣播組合選擇到同步網絡
   * 在離線狀態下不進行廣播
   */
  broadcastCombinationSelection(combination) {
    // 離線狀態下不廣播
    if (!this.isOnline()) {
      Logger.info("離線狀態，不進行同步廣播");
      return;
    }

    if (
      window.SyncManager &&
      typeof window.SyncManager.syncState === "function"
    ) {
      window.SyncManager.syncState({
        type: window.SyncDataTypes.COMBINATION_SELECTED,
        clientId:
          window.syncManager?.core?.syncClient?.clientId ||
          "combination_selector",
        combination: {
          combination_id: combination.combination_id,
          combination_name: combination.combination_name,
          units: combination.units,
          is_randomizable: combination.is_randomizable,
          description: combination.description
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 分派本機事件
   */
  dispatchCombinationSelectedEvent(combination) {
    const event = new CustomEvent("combination_selected", {
      detail: {
        combinationId: combination.combination_id,
        combinationName: combination.combination_name,
        combination: combination
      }
    });
    document.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  /**
   * 處理實驗開始事件
   */
  handleExperimentStart(detail) {
    const experimentId = detail?.experimentId;
    this.checkAndApplyDefaultCombination(experimentId);
  }

  /**
   * 當同步連線時，檢查是否需要套用預設組合
   */
  onSyncConnected() {
    this.checkAndApplyDefaultCombination();
  }

  /**
   * 檢查是否在同步工作階段中
   */
  isInSyncSession() {
    // 可以通過檢查同步管理器的狀態
    return window.SyncManager?.isConnected?.() || false;
  }

  /**
   * 檢查是否線上（有網絡連線）
   */
  isOnline() {
    return navigator.onLine;
  }

  /**
   * 儲存組合選擇到本機快取
   */
  saveCombination(combination) {
    try {
      localStorage.setItem(
        "selectedCombination",
        JSON.stringify({
          combination_id: combination.combination_id,
          combination_name: combination.combination_name,
          units: combination.units,
          is_randomizable: combination.is_randomizable,
          description: combination.description,
          savedAt: Date.now()
        })
      );
    } catch (error) {
      Logger.warn("無法儲存到本機快取");
    }
  }

  /**
   * 從本機快取還原組合選擇
   */
  getSavedCombination() {
    try {
      const saved = localStorage.getItem("selectedCombination");
      if (saved) {
        const combination = JSON.parse(saved);
        return combination;
      }
    } catch (error) {
      Logger.warn("無法讀取本機快取");
    }
    return null;
  }

  /**
   * 清除本機快取的組合
   */
  clearSavedCombination() {
    try {
      localStorage.removeItem("selectedCombination");
    } catch (error) {
      Logger.warn("無法清除本機快取");
    }
  }

  /**
   * 取得當前選擇的組合
   */
  getCurrentCombination() {
    return this.currentCombination;
  }
}

// 建立全域實例
window.CombinationSelector = new CombinationSelector();
