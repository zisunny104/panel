/**
 * ExperimentCombinationManager - 實驗組合管理器
 *
 * 負責組合載入、隨機化、快取與同步處理。
 */

import {
  SYNC_DATA_TYPES,
  SYNC_ROLE_CONFIG,
  EXPERIMENT_COMBINATION_EVENTS,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { EventEmitter } from "../core/event-emitter.js";
import { getSharedConfig } from "../core/config.js";
import { createSeededRandom, shuffleArray } from "../core/random-utils.js";

export class ExperimentCombinationManager extends EventEmitter {
  static activeInstance = null;
  static EVENT = EXPERIMENT_COMBINATION_EVENTS;

  /**
   * 取得目前的組合（靜態便捷方法）
   */
  static getActiveCombination() {
    return ExperimentCombinationManager.activeInstance?.getCurrentCombination?.() || null;
  }

  constructor(config = {}) {
    super();
    this.config = {
      ...config,
      dataPath: config.dataPath || "data/scenarios.json",
      defaultCombinationId:
        config.defaultCombinationId ||
        getSharedConfig()?.experiment?.defaultCombinationId,
      enableRandomization: config.enableRandomization !== false,
      cacheEnabled: config.cacheEnabled !== false,
    };

    this.scriptData = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isInitialized = false;
    this.readyPromise = null;
    this._selectionSignature = null;
    this._comboSignatureCache = null;
    this.dependencies = {
      hubManager: null,
      syncManager: null,
      syncClient: null,
      experimentSyncCore: null,
    };

    ExperimentCombinationManager.activeInstance = this;

    // 不在 constructor 中自動初始化，由外部明確呼叫 initialize() 或 ready()
    // 這樣可以確保事件監聽器在初始化前就已設定好
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
    const nextSignature = this._buildSelectionSignature(combination, normalizedExperimentId, nextUnits);
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
   * 使用種子洗牌陣列（使用 random-utils）
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
    if (role && role !== SYNC_ROLE_CONFIG.OPERATOR) return false;

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

  broadcastCurrentCombination() {
    return this._broadcastCombinationSelection(this.currentCombination);
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

    let cacheData;
    try {
      cacheData = JSON.parse(raw);
    } catch {
      this.clearCache();
      return false;
    }
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

  // ==================== 組合比對與自訂選擇 ====================

  /** 取得目前載入的單元 ID 陣列（複本） */
  getCurrentUnitIds() {
    return [...this.loadedUnits];
  }

  /** 標準化電源選項（缺省值 true） */
  normalizePowerOptions(options = {}) {
    return {
      includeStartup: options.includeStartup ?? true,
      includeShutdown: options.includeShutdown ?? true,
    };
  }

  isSamePowerOptions(a = {}, b = {}) {
    return a.includeStartup === b.includeStartup && a.includeShutdown === b.includeShutdown;
  }

  isSameUnitOrder(a = [], b = []) {
    if (a.length !== b.length) return false;
    return a.every((id, i) => id === b[i]);
  }

  getUnitSignature(unitIds = []) {
    return Array.isArray(unitIds) ? unitIds.join("|") : "";
  }

  /** 建立 signature → combination 快取 Map（按 experimentId 失效） */
  getComboSignatureMap(experimentId) {
    const combos = this.getAvailableCombinations();
    const comboKey = combos.map((c) => c.combinationId).join("|");
    if (
      this._comboSignatureCache?.experimentId === experimentId &&
      this._comboSignatureCache?.comboKey === comboKey
    ) {
      return this._comboSignatureCache.map;
    }

    const map = new Map();
    combos.forEach((combo) => {
      const ids = this.getCombinationUnitIds(combo, experimentId) || [];
      if (ids.length) map.set(this.getUnitSignature(ids), combo);
    });
    this._comboSignatureCache = { experimentId, comboKey, map };
    return map;
  }

  /** 根據單元 ID 序列找出匹配的預設組合，找不到回傳 null */
  findMatchingCombination(unitIds = [], experimentId = null) {
    const sig = this.getUnitSignature(unitIds);
    if (!sig) return null;
    return this.getComboSignatureMap(experimentId).get(sig) || null;
  }

  /** 建立自訂組合物件（不修改任何狀態） */
  buildCustomCombination(unitIds, baseCombination = null, powerOptions = null) {
    return {
      combinationId: "custom",
      combinationName: "自訂組合",
      description: "根據選擇和排序產生的自訂組合",
      units: [...unitIds],
      is_randomizable: false,
      baseCombinationId: baseCombination?.combinationId || null,
      baseCombinationName: baseCombination?.combinationName || null,
      powerOptions: this.normalizePowerOptions(powerOptions || {}),
      source: "custom_order",
    };
  }

  /**
   * 根據使用者選取的單元 ID 陣列設定組合（比對預設組合或建立自訂組合）。
   * @param {string[]} unitIds - 已選取且排序後的單元 ID
   * @param {Object} options
   * @param {string}  options.experimentId    - 目前實驗 ID（供隨機化種子使用）
   * @param {Object}  options.powerOptions    - 電源選項（可選，缺省從 currentCombination 讀取）
   * @param {boolean} options.forceBroadcast  - 即使順序未變也強制廣播
   * @param {boolean} options.skipBroadcast   - 跳過廣播
   * @returns {boolean}
   */
  applyCustomSelection(unitIds = [], options = {}) {
    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      Logger.warn("忽略空白單元選擇，保留目前單元列表");
      return false;
    }

    const powerOptions = this.normalizePowerOptions(options.powerOptions || {});
    const currentPowerOptions = this.normalizePowerOptions(this.currentCombination?.powerOptions);
    const baseComboId = this.currentCombination?.baseCombinationId || this.currentCombination?.combinationId;
    const baseCombo = baseComboId ? this.getCombinationById(baseComboId) : null;

    const orderUnchanged = this.isSameUnitOrder(unitIds, this.loadedUnits);
    const powerOptionsChanged = !this.isSamePowerOptions(powerOptions, currentPowerOptions);
    if (orderUnchanged && !powerOptionsChanged && !options.forceBroadcast) return false;

    const experimentId = options.experimentId || null;
    const matched = this.findMatchingCombination(unitIds, experimentId);
    if (matched) {
      return this.setCombination(
        { ...matched, powerOptions },
        experimentId,
        { skipCache: false, skipBroadcast: options.skipBroadcast === true },
      );
    }

    return this.setCombination(
      this.buildCustomCombination(unitIds, baseCombo || this.currentCombination, powerOptions),
      experimentId,
      { skipCache: true, skipBroadcast: options.skipBroadcast === true },
    );
  }

  // ==================== 驗證與工具 ====================

  _buildSelectionSignature(combination, experimentId, unitIds) {
    return JSON.stringify({
      experimentId: experimentId || "",
      combinationId: combination.combinationId || "",
      unitIds,
      powerOptions: combination.powerOptions || null,
    });
  }

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
  handleExperimentIdChanged(newExperimentId, { skipBroadcast = false } = {}) {
    Logger.debug("ExperimentCombinationManager: 實驗ID已改變", newExperimentId);

    if (this.currentCombination) {
      this.loadedUnits = this.getCombinationUnitIds(
        this.currentCombination,
        newExperimentId,
      );
      this._selectionSignature = this._buildSelectionSignature(
        this.currentCombination,
        newExperimentId || "",
        this.loadedUnits,
      );

      this.emit(ExperimentCombinationManager.EVENT.COMBINATION_SELECTED, {
        combination: this.currentCombination,
        unitIds: this.loadedUnits,
        experimentId: newExperimentId,
      });

      if (!skipBroadcast) {
        this._broadcastCombinationSelection(this.currentCombination);
      }

      Logger.debug("組合單元已根據新實驗ID重新排序", {
        combinationName: this.currentCombination.combinationName,
        unitIds: this.loadedUnits,
      });
    }
  }
}
