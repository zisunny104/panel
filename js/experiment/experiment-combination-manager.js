/**
* ExperimentCombinationManager - 實驗組合管理器
*
* 負責組合載入、隨機化、快取與同步處理。
*/

import { SYNC_DATA_TYPES } from "../constants/index.js";
import { getSharedConfig } from "../core/config.js";
import { createSeededRandom, shuffleArray } from "../core/random-utils.js";

export const ExperimentCombinationManager = class ExperimentCombinationManager {
  static activeInstance = null;
  static EVENT = {
    COMBINATION_LOADED: "combination:loaded",
    COMBINATION_SELECTED: "combination:selected",
    COMBINATION_CHANGED: "combination:changed",
    UNITS_RANDOMIZED: "combination:units_randomized",
    ERROR: "combination:error",
  };

  /**
   * 取得目前的組合（靜態便捷方法）
   */
  static getActiveCombination() {
    return ExperimentCombinationManager.activeInstance?.getCurrentCombination?.() || null;
  }

  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath || "data/scenarios.json",
      defaultCombinationId:
        config.defaultCombinationId ||
        getSharedConfig()?.experiment?.defaultCombinationId,
      enableRandomization: config.enableRandomization !== false,
      cacheEnabled: config.cacheEnabled !== false,
      ...config,
    };

    this.scriptData = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isInitialized = false;
    this.readyPromise = null; // Promise to wait for initialization
    this.eventListeners = new Map();
    this._selectionSignature = null;
    this.dependencies = {
      hubManager: null,
      syncManager: null,
      syncClient: null,
      experimentSyncCore: null,
    };

    ExperimentCombinationManager.activeInstance = this;

    // 不在 constructor 中自動初始化，由外部明確呼叫 initialize() 或 ready()
    // 這樣可以確保事件監聽器在初始化前就已設置好
  }

  updateDependencies(deps = {}) {
    Object.assign(this.dependencies, deps);
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      try {
        Logger.debug("開始載入腳本資料...");
        await this.loadScriptData();
        Logger.debug("腳本資料載入完成");

        if (this.config.cacheEnabled) {
          Logger.debug("開始從快取還原...");
          await this.restoreFromCache();
          Logger.debug("快取還原完成");
        }

        if (!this.currentCombination) {
          Logger.debug("開始套用預設組合...");
          await this.applyDefaultCombination();
          Logger.debug("預設組合套用完成");
        }

        this.isInitialized = true;
        Logger.debug("ExperimentCombinationManager 初始化完成");
      } catch (error) {
        Logger.error(
          "ExperimentCombinationManager 初始化失敗:",
          error instanceof Error ? error.message : String(error),
        );
        if (error instanceof Error) {
          Logger.error("堆棧:", error.stack);
        }
        throw error;
      }
    })();

    return this.readyPromise;
  }

  // ==================== 公開 API ====================

  /**
   * 設定組合
   * @param {Object} combination - 組合物件
   * @param {string} experimentId - 實驗ID
   * @param {Object} options - 選項
   */
  async setCombination(combination, experimentId = null, options = {}) {
    if (!combination || !this.validateCombination(combination).valid) {
      Logger.error("無效的組合", combination);
      return false;
    }

    const normalizedExperimentId = experimentId || "";
    const nextUnits = this.getCombinationUnitIds(combination, experimentId);
    const nextSignature = JSON.stringify({
      experimentId: normalizedExperimentId,
      combinationId: combination.combinationId || "",
      unitIds: nextUnits,
      powerOptions: combination.powerOptions || null,
    });
    if (this._selectionSignature === nextSignature) {
      this.currentCombination = combination;
      this.loadedUnits = nextUnits;
      Logger.debug("組合狀態未變更，略過重複設定", {
        combinationName: combination.combinationName,
        experimentId: normalizedExperimentId,
      });
      return true;
    }

    const oldCombination = this.currentCombination;
    this.currentCombination = combination;
    this.loadedUnits = nextUnits;
    this._selectionSignature = nextSignature;

    if (this.config.cacheEnabled && !options.skipCache) {
      this.saveToCache(combination);
    }

    if (!options.silent) {
      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_SELECTED, {
        combination,
        unitIds: this.loadedUnits,
        experimentId,
      });

      if (oldCombination && oldCombination.combinationId !== combination.combinationId) {
        this.emit(ExperimentCombinationManager.EVENT.COMBINATION_CHANGED, {
          oldCombination,
          newCombination: combination,
        });
      }

      // 廣播組合選擇到其他裝置（除非明確跳過）
      if (!options.skipBroadcast) {
        this._broadcastCombinationSelection(combination);
      }
    }

    Logger.debug("組合已設定", combination.combinationName);
    return true;
  }

  /**
   * 取得目前組合
   */
  getCurrentCombination() {
    return this.currentCombination;
  }

  /**
   * 取得所有可用組合
   */
  getAvailableCombinations() {
    if (!this.scriptData) {
      throw new Error("尚未載入組合資料");
    }
    return this.scriptData.unit_combinations;
  }

  /**
   * 根據 ID 取得組合
   */
  getCombinationById(combinationId) {
    return this.getAvailableCombinations().find(
      (c) => c.combinationId === combinationId,
    );
  }

  /**
   * 取得載入的單元列表
   */
  getLoadedUnits() {
    return [...this.loadedUnits];
  }

  // ==================== 資料載入 ====================

  /**
   * 等待初始化完成
   */
  async ready() {
    return this.readyPromise || this.initialize();
  }

  /**
   * 載入 script 資料
   */
  async loadScriptData() {
    if (this.scriptData) return this.scriptData;

    const response = await fetch(this.config.dataPath);
    if (!response.ok) {
      throw new Error(`載入失敗: ${response.status}`);
    }

    this.scriptData = await response.json();

    // 轉換欄位名稱為駝峰式
    if (this.scriptData.unit_combinations) {
      this.scriptData.unit_combinations = this.scriptData.unit_combinations.map(
        (c) => ({
          ...c,
          combinationId: c.combination_id,
          combinationName: c.combination_name,
        }),
      );
    }

    this.emit(ExperimentCombinationManager.EVENT.COMBINATION_LOADED, {
      data: this.scriptData,
    });

    return this.scriptData;
  }

  // ==================== 預設組合 ====================

  /**
   * 套用預設組合
   */
  async applyDefaultCombination() {
    if (this.currentCombination) return true;

    if (!this.scriptData) {
      await this.loadScriptData();
    }

    const defaultCombo = this.getDefaultCombination();
    const experimentId = this.dependencies.hubManager?.getExperimentId?.() || null;

    if (defaultCombo) {
      return this.setCombination(defaultCombo, experimentId, {
        skipBroadcast: true,
      });
    }

    // 備案：使用第一個可用組合
    const combinations = this.getAvailableCombinations();
    if (combinations.length > 0) {
      return this.setCombination(combinations[0], experimentId, {
        skipBroadcast: true,
      });
    }

    return false;
  }

  /**
   * 取得預設組合
   */
  getDefaultCombination() {
    if (this.config.defaultCombinationId) {
      return this.getCombinationById(this.config.defaultCombinationId);
    }
    return this.getAvailableCombinations()[0] || null;
  }

  // ==================== 隨機化邏輯 ====================

  /**
   * 處理組合單元的隨機化邏輯
   */
  getCombinationUnitIds(combination, experimentId = null) {
    let unitIds = [];

    if (Array.isArray(combination.units)) {
      unitIds = combination.units;
    } else if (combination.units) {
      if (
        this.config.enableRandomization &&
        combination.is_randomizable &&
        combination.units.randomizable
      ) {
        const seed = experimentId || "default";
        unitIds = this.shuffleWithSeed(combination.units.randomizable, seed);
        this.emit(ExperimentCombinationManager.EVENT.UNITS_RANDOMIZED, {
          combination,
          seed,
          unitIds,
        });
      } else if (combination.units.randomizable) {
        unitIds = [...combination.units.randomizable];
      }

      if (combination.units.fixed) {
        unitIds = this.insertFixedUnits(unitIds, combination.units.fixed);
      }
    }

    return unitIds;
  }

  /**
   * 插入固定位置的單元
   */
  insertFixedUnits(unitIds, fixedUnits) {
    const fixedFirst = [];
    const fixedLast = [];
    const fixedOther = [];

    fixedUnits.forEach((fixed) => {
      if (fixed.position === "first") {
        fixedFirst.push(fixed.unit_id);
      } else if (fixed.position === "last") {
        fixedLast.push(fixed.unit_id);
      } else {
        fixedOther.push(fixed.unit_id);
      }
    });

    return [...fixedFirst, ...unitIds, ...fixedOther, ...fixedLast];
  }

  /**
  * 使用種子洗牌陣列（依賴 random-utils）
   */
  shuffleWithSeed(array, seed) {
    const seededRandom = createSeededRandom(seed);
    return shuffleArray([...array], seededRandom);
  }

  // ==================== 同步功能 ====================

  /**
   * 廣播組合選擇
   * Schema: {type, clientId, timestamp, combination}
   */
  _broadcastCombinationSelection(combination = null) {
    const targetCombination = combination || this.currentCombination;
    if (!targetCombination || !this.isInSyncSession()) return false;

    const experimentSyncCore = this.dependencies.experimentSyncCore;
    const syncClient =
      this.dependencies.syncClient || this.dependencies.syncManager?.core?.syncClient;
    const role = syncClient?.getRole?.() || syncClient?.role;
    if (role && role !== "operator") return false;

    const experimentId = this.dependencies.hubManager?.getExperimentId?.() || null;
    const unitIds = Array.isArray(this.loadedUnits) ? [...this.loadedUnits] : [];

    if (!experimentSyncCore?.safeBroadcast) {
      Logger.warn("同步組合選擇失敗: experimentSyncCore 不可用");
      return false;
    }

    experimentSyncCore.safeBroadcast({
      type: SYNC_DATA_TYPES.COMBINATION_SELECTED,
      clientId: syncClient?.clientId,
      timestamp: Date.now(),
      experimentId,
      unitIds,
      combination: targetCombination,
    }).catch((error) => {
      Logger.warn("同步組合選擇失敗:", error);
    });
    Logger.debug("組合選擇已廣播", targetCombination.combinationName);
    return true;
  }

  /**
   * 檢查是否在同步工作階段中
   */
  isInSyncSession() {
    return (
      this.dependencies.hubManager?.isInSyncMode?.() ||
      this.dependencies.syncManager?.isSyncMode === true
    );
  }

  // ==================== 快取管理 ====================

  /**
   * 儲存組合到快取
   */
  saveToCache(combination = null) {
    const targetCombination = combination || this.currentCombination;
    if (!targetCombination) return;

    const cacheData = {
      combinationId: targetCombination.combinationId,
      combinationName: targetCombination.combinationName,
      timestamp: Date.now(),
    };

    localStorage.setItem(
      "experimentCurrentCombination",
      JSON.stringify(cacheData),
    );
    Logger.debug("組合已儲存到快取", targetCombination.combinationName);
  }

  /**
   * 從快取恢復組合
   */
  async restoreFromCache() {
    const raw = localStorage.getItem("experimentCurrentCombination");
    if (!raw) return false;

    const cacheData = JSON.parse(raw);
    const combination = this.getCombinationById(cacheData.combinationId);

    if (!combination) {
      this.clearCache();
      return false;
    }

    // 從快取恢復時不再使用 silent: true
    // 統一透過 setCombination 發送事件，確保 UI 正確初始化
    // 恢復時同樣使用目前實驗ID作為種子，確保隨機排序與手動選擇一致
    const experimentId = this.dependencies.hubManager?.getExperimentId?.() || null;
    return this.setCombination(combination, experimentId, {
      skipCache: true,
      skipBroadcast: true,
    });
  }

  /**
   * 清除快取
   */
  clearCache() {
    localStorage.removeItem("experimentCurrentCombination");
    Logger.debug("組合快取已清除");
  }

  // ==================== 驗證與工具 ====================

  /**
   * 驗證組合有效性
   */
  validateCombination(combination) {
    if (!combination) {
      return { valid: false, error: "組合不能為空" };
    }

    if (!combination.combinationId) {
      return { valid: false, error: "組合缺少 combinationId" };
    }

    if (!combination.combinationName) {
      return { valid: false, error: "組合缺少 combinationName" };
    }

    if (!combination.units) {
      return { valid: false, error: "組合缺少 units" };
    }

    return { valid: true };
  }

  /**
   * 取得管理器狀態
   */
  getState() {
    return {
      currentCombination: this.currentCombination,
      loadedUnits: [...this.loadedUnits],
      isInitialized: this.isInitialized,
      config: { ...this.config },
    };
  }

  /**
   * 重置管理器
   */
  reset() {
    this.currentCombination = null;
    this.loadedUnits = [];
    this._selectionSignature = null;
    this.clearCache();
    Logger.debug("ExperimentCombinationManager 已重置");
  }

  /**
   * 處理實驗ID改變事件
   */
  handleExperimentIdChanged(newExperimentId) {
    Logger.debug("ExperimentCombinationManager: 實驗ID已改變", newExperimentId);

    // 如果有目前組合，以新 experimentId 為種子重新計算單元排序
    if (this.currentCombination) {
      this.loadedUnits = this.getCombinationUnitIds(
        this.currentCombination,
        newExperimentId,
      );
      this._selectionSignature = JSON.stringify({
        experimentId: newExperimentId || "",
        combinationId: this.currentCombination.combinationId || "",
        unitIds: this.loadedUnits,
        powerOptions: this.currentCombination.powerOptions || null,
      });

      // 觸發組合重新選擇事件，讓 UI 更新排序
      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_SELECTED, {
        combination: this.currentCombination,
        unitIds: this.loadedUnits,
        experimentId: newExperimentId,
      });

      // 廣播重新排序的組合到其他裝置
      this._broadcastCombinationSelection(this.currentCombination);

      Logger.debug("組合單元已根據新實驗ID重新排序", {
        combinationName: this.currentCombination.combinationName,
        unitIds: this.loadedUnits,
      });
    }
  }

  // ==================== 事件系統 ====================

  /**
   * 註冊事件監聽器
   */
  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  /**
   * 移除事件監聽器
   */
  off(eventType, callback) {
    if (!this.eventListeners.has(eventType)) return;

    const listeners = this.eventListeners.get(eventType);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 觸發事件
   */
  emit(eventType, data) {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType).forEach((callback) => {
        callback(data);
      });
    }

    const customEvent = new CustomEvent(eventType, {
      detail: data,
      bubbles: true,
    });
    document.dispatchEvent(customEvent);
  }

  /**
   * 清除所有事件監聽器
   */
  clearListeners(eventType = null) {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }
};

