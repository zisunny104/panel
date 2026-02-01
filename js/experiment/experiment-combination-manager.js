/**
 * ExperimentCombinationManager - 實驗組合管理器
 * 負責組合載入、隨機化、快取和同步功能
 */

class ExperimentCombinationManager {
  static EVENT = {
    COMBINATION_LOADED: "combination:loaded",
    COMBINATION_SELECTED: "combination:selected",
    COMBINATION_CHANGED: "combination:changed",
    UNITS_RANDOMIZED: "combination:units_randomized",
    ERROR: "combination:error",
  };

  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath || "data/scenarios.json",
      defaultCombinationId:
        config.defaultCombinationId ||
        window.CONFIG?.experiment?.defaultCombinationId,
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

    this.initialize();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      await this.loadScriptData();

      if (this.config.cacheEnabled) {
        await this.restoreFromCache();
      }

      if (!this.currentCombination) {
        await this.applyDefaultCombination();
      }

      this.isInitialized = true;
      Logger.debug("ExperimentCombinationManager 初始化完成");
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

    const oldCombination = this.currentCombination;
    this.currentCombination = combination;
    this.loadedUnits = this.getCombinationUnitIds(combination, experimentId);

    if (this.config.cacheEnabled && !options.skipCache) {
      this.saveToCache(combination);
    }

    if (!options.silent) {
      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_SELECTED, {
        combination,
        unitIds: this.loadedUnits,
        experimentId,
      });

      if (oldCombination?.combinationId !== combination.combinationId) {
        this.emit(ExperimentCombinationManager.EVENT.COMBINATION_CHANGED, {
          oldCombination,
          newCombination: combination,
        });
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
    return this.scriptData?.unit_combinations || [];
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

  /**
   * 產生隨機組合
   */
  generateRandomCombination(seed = null) {
    const combinations = this.getAvailableCombinations();
    if (combinations.length === 0) return null;

    if (!seed) {
      // 無種子時使用原生隨機
      const randomIndex = Math.floor(Math.random() * combinations.length);
      return combinations[randomIndex];
    }

    // 有種子時必須使用 RandomUtils 確保可重現性
    if (!window.RandomUtils || !window.RandomUtils.createSeededRandom) {
      throw new Error(
        "RandomUtils 不可用：無法產生可重現的隨機組合。請確保 random-utils.js 已正確載入。",
      );
    }

    const seededRandom = window.RandomUtils.createSeededRandom(seed);
    const randomIndex = Math.floor(seededRandom() * combinations.length);
    return combinations[randomIndex];
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
    if (this.scriptData?.unit_combinations) {
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
    const experimentId =
      window.experimentHubManager?.getExperimentId?.() || null;

    if (defaultCombo) {
      return this.setCombination(defaultCombo, experimentId);
    }

    // 備案：使用第一個可用組合
    const combinations = this.getAvailableCombinations();
    if (combinations.length > 0) {
      return this.setCombination(combinations[0], experimentId);
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
   * 使用種子洗牌陣列（依賴統一的 RandomUtils）
   */
  shuffleWithSeed(array, seed) {
    if (
      !window.RandomUtils ||
      !window.RandomUtils.shuffleArray ||
      !window.RandomUtils.createSeededRandom
    ) {
      throw new Error(
        "RandomUtils 不可用：無法進行隨機化操作。請確保 random-utils.js 已正確載入。",
      );
    }

    const seededRandom = window.RandomUtils.createSeededRandom(seed);
    return window.RandomUtils.shuffleArray([...array], seededRandom);
  }

  // ==================== 同步功能 ====================

  /**
   * 廣播組合選擇
   */
  broadcastCombinationSelection(combination = null) {
    const targetCombination = combination || this.currentCombination;
    if (!targetCombination || !this.isInSyncSession()) return false;

    if (window.syncClient?.syncState) {
      window.syncClient.syncState({
        type: "combination_selected",
        combination: targetCombination,
        timestamp: new Date().toISOString(),
      });
      Logger.debug("組合選擇已廣播", targetCombination.combinationName);
      return true;
    }

    return false;
  }

  /**
   * 處理遠端組合選擇
   */
  handleRemoteCombinationSelection(combination, experimentId = null) {
    if (!this.isInSyncSession()) return;
    Logger.debug("收到遠端組合選擇", combination.combinationName);
    this.setCombination(combination, experimentId, { skipCache: false });
  }

  /**
   * 檢查是否在同步工作階段中
   */
  isInSyncSession() {
    return window.syncManager?.isInSession?.() || false;
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

    return this.setCombination(combination, null, {
      silent: true,
      skipCache: true,
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
    this.clearCache();
    Logger.debug("ExperimentCombinationManager 已重置");
  }

  /**
   * 處理實驗ID改變事件
   */
  handleExperimentIdChanged(newExperimentId) {
    Logger.debug("ExperimentCombinationManager: 實驗ID已改變", newExperimentId);
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
        try {
          callback(data);
        } catch (error) {
          Logger.error(`事件處理器錯誤 (${eventType})`, error);
        }
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
}

// 導出到全域
if (typeof window !== "undefined") {
  window.ExperimentCombinationManager = ExperimentCombinationManager;
}
