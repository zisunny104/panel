/**
 * ExperimentCombinationManager - 實驗組合管理器
 * Phase 2 - P0 核心模組
 *
 * 職責：
 * 1. 組合載入與管理
 * 2. 隨機化邏輯
 * 3. 預設組合處理
 * 4. 組合同步廣播
 *
 * 提取來源：
 * - panel-experiment-units.js (組合載入與管理)
 * - combination-selector.js (隨機化邏輯)
 * - random-utils.js (隨機工具)
 */

class ExperimentCombinationManager {
  /**
   * 事件類型常數
   */
  static EVENT = {
    COMBINATION_LOADED: 'combination:loaded',
    COMBINATION_SELECTED: 'combination:selected',
    COMBINATION_CHANGED: 'combination:changed',
    UNITS_RANDOMIZED: 'combination:units_randomized',
    ERROR: 'combination:error'
  };

  constructor(config = {}) {
    // 配置
    this.config = {
      dataPath: config.dataPath || 'data/scenarios.json',
      defaultCombinationId: config.defaultCombinationId || window.CONFIG?.experiment?.defaultCombinationId,
      enableRandomization: config.enableRandomization !== false,
      cacheEnabled: config.cacheEnabled !== false,
      ...config
    };

    // 狀態
    this.scriptData = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isInitialized = false;

    // 事件監聽器
    this.eventListeners = new Map();

    // 初始化
    this.initialize();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    try {
      // 載入 script 資料
      await this.loadScriptData();

      // 從快取恢復組合（如果有）
      if (this.config.cacheEnabled) {
        await this.restoreFromCache();
      }

      // 如果沒有恢復到組合，套用預設組合
      if (!this.currentCombination) {
        await this.applyDefaultCombination();
      }

      this.isInitialized = true;
      Logger.debug('ExperimentCombinationManager 初始化完成', {
        currentCombination: this.currentCombination?.name
      });
    } catch (error) {
      Logger.error('ExperimentCombinationManager 初始化失敗', error);
      this.emit(ExperimentCombinationManager.EVENT.ERROR, {
        type: 'initialization_failed',
        error
      });
    }
  }

  // ==================== 組合載入 ====================

  /**
   * 載入 script 資料
   */
  async loadScriptData() {
    if (this.scriptData) {
      return this.scriptData;
    }

    try {
      const response = await fetch(this.config.dataPath);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      this.scriptData = await response.json();
      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_LOADED, {
        data: this.scriptData
      });

      Logger.debug('script 資料載入完成', {
        combinations: this.scriptData.unit_combinations?.length || 0
      });

      return this.scriptData;
    } catch (error) {
      Logger.error('載入 script 資料失敗', error);
      this.emit(ExperimentCombinationManager.EVENT.ERROR, {
        type: 'load_failed',
        error
      });
      return null;
    }
  }

  /**
   * 取得所有可用組合
   */
  getAvailableCombinations() {
    if (!this.scriptData) {
      Logger.warn('script 資料尚未載入');
      return [];
    }
    return this.scriptData.unit_combinations || [];
  }

  /**
   * 根據 ID 取得組合
   */
  getCombinationById(combinationId) {
    const combinations = this.getAvailableCombinations();
    return combinations.find(c => c.combination_id === combinationId);
  }

  /**
   * 取得當前組合
   */
  getCurrentCombination() {
    return this.currentCombination;
  }

  /**
   * 設定組合
   */
  async setCombination(combination, experimentId = null, options = {}) {
    if (!combination) {
      Logger.warn('setCombination: 組合為空');
      return false;
    }

    const oldCombination = this.currentCombination;
    this.currentCombination = combination;

    // 取得單元 ID 列表（包含隨機化處理）
    const unitIds = this.getCombinationUnitIds(combination, experimentId);
    this.loadedUnits = unitIds;

    // 儲存到快取
    if (this.config.cacheEnabled && !options.skipCache) {
      this.saveToCache(combination);
    }

    // 觸發事件
    if (!options.silent) {
      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_SELECTED, {
        combination,
        unitIds,
        experimentId
      });

      if (oldCombination && oldCombination.combination_id !== combination.combination_id) {
        this.emit(ExperimentCombinationManager.EVENT.COMBINATION_CHANGED, {
          oldCombination,
          newCombination: combination
        });
      }
    }

    Logger.debug('組合已設定', {
      name: combination.name,
      unitCount: unitIds.length,
      isRandomized: combination.is_randomizable
    });

    return true;
  }

  /**
   * 驗證組合有效性
   */
  validateCombination(combination) {
    if (!combination) {
      return { valid: false, error: '組合不能為空' };
    }

    if (!combination.combination_id) {
      return { valid: false, error: '組合缺少 combination_id' };
    }

    if (!combination.name) {
      return { valid: false, error: '組合缺少 name' };
    }

    if (!combination.units) {
      return { valid: false, error: '組合缺少 units' };
    }

    return { valid: true };
  }

  // ==================== 隨機化邏輯 ====================

  /**
   * 處理組合單元的隨機化邏輯
   * @param {Object} combination - 組合物件
   * @param {string} experimentId - 實驗ID（用作種子）
   * @returns {Array} 排序後的單元ID列表
   */
  getCombinationUnitIds(combination, experimentId = null) {
    let unitIds = [];

    if (Array.isArray(combination.units)) {
      // 簡單陣列格式
      unitIds = combination.units;
    } else if (combination.units && typeof combination.units === 'object') {
      // 複雜格式（隨機化）
      if (this.config.enableRandomization && 
          combination.is_randomizable && 
          combination.units.randomizable) {
        
        const seed = experimentId || 'default';
        unitIds = this.shuffleWithSeed(combination.units.randomizable, seed);
        
        this.emit(ExperimentCombinationManager.EVENT.UNITS_RANDOMIZED, {
          combination,
          seed,
          unitIds
        });
      } else if (combination.units.randomizable) {
        // 非隨機化，直接使用 randomizable 的順序
        unitIds = [...combination.units.randomizable];
      }

      // 處理 fixed 單元
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

    fixedUnits.forEach(fixed => {
      if (fixed.position === 'first') {
        fixedFirst.push(fixed.unit_id);
      } else if (fixed.position === 'last') {
        fixedLast.push(fixed.unit_id);
      } else {
        fixedOther.push(fixed.unit_id);
      }
    });

    return [...fixedFirst, ...unitIds, ...fixedOther, ...fixedLast];
  }

  /**
   * 使用種子洗牌陣列
   */
  shuffleWithSeed(array, seed) {
    const seededRandom = this.createSeededRandom(seed);
    return this.shuffleArray([...array], seededRandom);
  }

  /**
   * 基於種子建立可重現的隨機數產生器
   * @param {string|number} seed - 種子值
   * @returns {Function} 隨機數產生函數（0-1 之間）
   */
  createSeededRandom(seed) {
    let numericSeed = 0;
    
    if (typeof seed === 'string') {
      for (let i = 0; i < seed.length; i++) {
        numericSeed = ((numericSeed << 5) - numericSeed + seed.charCodeAt(i)) & 0xffffffff;
      }
    } else {
      numericSeed = seed || 0;
    }

    // 使用線性同餘產生器 (LCG)
    return function() {
      numericSeed = (numericSeed * 1664525 + 1013904223) & 0xffffffff;
      return (numericSeed >>> 0) / 4294967296;
    };
  }

  /**
   * 使用 Fisher-Yates 演算法洗牌陣列
   * @param {Array} array - 要洗牌的陣列
   * @param {Function} randomFunc - 隨機數產生函數
   * @returns {Array} 洗牌後的新陣列
   */
  shuffleArray(array, randomFunc) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(randomFunc() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * 生成隨機組合（從可用組合中隨機選擇）
   */
  generateRandomCombination(seed = null) {
    const combinations = this.getAvailableCombinations();
    
    if (combinations.length === 0) {
      Logger.warn('沒有可用組合');
      return null;
    }

    if (!seed) {
      // 真隨機
      const randomIndex = Math.floor(Math.random() * combinations.length);
      return combinations[randomIndex];
    } else {
      // 基於種子的可重現隨機
      const seededRandom = this.createSeededRandom(seed);
      const randomIndex = Math.floor(seededRandom() * combinations.length);
      return combinations[randomIndex];
    }
  }

  /**
   * 設定隨機種子（用於測試）
   */
  setRandomSeed(seed) {
    this._testSeed = seed;
    Logger.debug('隨機種子已設定', seed);
  }

  /**
   * 取得隨機種子（用於測試）
   */
  getRandomSeed() {
    return this._testSeed;
  }

  // ==================== 預設處理 ====================

  /**
   * 套用預設組合
   */
  async applyDefaultCombination(experimentId = null) {
    // 確保資料已載入
    if (!this.scriptData) {
      await this.loadScriptData();
    }

    if (!this.scriptData) {
      Logger.error('無法載入 script 資料');
      return false;
    }

    // 1. 嘗試使用設定的預設組合
    if (this.config.defaultCombinationId) {
      const defaultCombination = this.getCombinationById(this.config.defaultCombinationId);
      
      if (defaultCombination) {
        await this.setCombination(defaultCombination, experimentId);
        Logger.debug('已套用預設組合', defaultCombination.name);
        return true;
      } else {
        Logger.warn('預設組合不存在', this.config.defaultCombinationId);
      }
    }

    // 2. 備選方案：使用第一個可用組合
    const combinations = this.getAvailableCombinations();
    if (combinations.length > 0) {
      await this.setCombination(combinations[0], experimentId);
      Logger.debug('已套用第一個可用組合', combinations[0].name);
      return true;
    }

    Logger.error('沒有任何可用組合');
    return false;
  }

  /**
   * 取得預設組合
   */
  getDefaultCombination() {
    if (this.config.defaultCombinationId) {
      return this.getCombinationById(this.config.defaultCombinationId);
    }

    const combinations = this.getAvailableCombinations();
    return combinations[0] || null;
  }

  // ==================== 同步廣播 ====================

  /**
   * 廣播組合選擇（透過 SyncClient）
   */
  broadcastCombinationSelection(combination = null) {
    const targetCombination = combination || this.currentCombination;
    
    if (!targetCombination) {
      Logger.warn('沒有組合可廣播');
      return false;
    }

    // 檢查是否在同步會話中
    if (!this.isInSyncSession()) {
      Logger.debug('不在同步會話中，跳過廣播');
      return false;
    }

    // 使用 SyncClient 廣播
    if (window.syncClient && typeof window.syncClient.syncState === 'function') {
      const updateData = {
        type: 'combination_selected',
        combination: targetCombination,
        timestamp: new Date().toISOString()
      };

      window.syncClient.syncState(updateData);
      Logger.debug('組合選擇已廣播', targetCombination.name);
      return true;
    }

    Logger.warn('SyncClient 不可用');
    return false;
  }

  /**
   * 處理遠端組合選擇
   */
  handleRemoteCombinationSelection(combination, experimentId = null) {
    if (!this.isInSyncSession()) {
      return;
    }

    Logger.debug('收到遠端組合選擇', combination.name);
    this.setCombination(combination, experimentId, { skipCache: false });
  }

  /**
   * 檢查是否在同步會話中
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
    
    if (!targetCombination) {
      return;
    }

    try {
      const cacheData = {
        combination_id: targetCombination.combination_id,
        name: targetCombination.name,
        timestamp: Date.now()
      };

      localStorage.setItem('experiment_current_combination', JSON.stringify(cacheData));
      Logger.debug('組合已儲存到快取', targetCombination.name);
    } catch (error) {
      Logger.error('儲存組合到快取失敗', error);
    }
  }

  /**
   * 從快取恢復組合
   */
  async restoreFromCache() {
    try {
      const cached = localStorage.getItem('experiment_current_combination');
      
      if (!cached) {
        return false;
      }

      const cacheData = JSON.parse(cached);
      const combination = this.getCombinationById(cacheData.combination_id);

      if (combination) {
        await this.setCombination(combination, null, { silent: true, skipCache: true });
        Logger.debug('已從快取恢復組合', combination.name);
        return true;
      }

      Logger.warn('快取的組合不存在', cacheData.combination_id);
      return false;
    } catch (error) {
      Logger.error('從快取恢復組合失敗', error);
      return false;
    }
  }

  /**
   * 清除快取
   */
  clearCache() {
    try {
      localStorage.removeItem('experiment_current_combination');
      Logger.debug('組合快取已清除');
    } catch (error) {
      Logger.error('清除快取失敗', error);
    }
  }

  // ==================== 事件通知 ====================

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
    if (!this.eventListeners.has(eventType)) return;
    
    const listeners = this.eventListeners.get(eventType);
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        Logger.error(`事件處理器錯誤 (${eventType})`, error);
      }
    });
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

  // ==================== 工具方法 ====================

  /**
   * 取得管理器狀態
   */
  getState() {
    return {
      currentCombination: this.currentCombination,
      loadedUnits: [...this.loadedUnits],
      isInitialized: this.isInitialized,
      config: { ...this.config }
    };
  }

  /**
   * 取得單元列表
   */
  getLoadedUnits() {
    return [...this.loadedUnits];
  }

  /**
   * 重置管理器
   */
  reset() {
    this.currentCombination = null;
    this.loadedUnits = [];
    this.clearCache();
    Logger.debug('ExperimentCombinationManager 已重置');
  }

  /**
   * 銷毀管理器
   */
  destroy() {
    this.reset();
    this.clearListeners();
    this.scriptData = null;
    this.isInitialized = false;
    Logger.debug('ExperimentCombinationManager 已銷毀');
  }
}

// 導出到全域（用於向後相容）
if (typeof window !== 'undefined') {
  window.ExperimentCombinationManager = ExperimentCombinationManager;
}

// 支援模組導出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExperimentCombinationManager;
}
