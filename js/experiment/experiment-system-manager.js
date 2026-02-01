/**
 * ExperimentSystemManager - 實驗系統統一管理器
 * - 統一管理所有實驗相關UI組件
 * - 協調 ExperimentCombinationManager 和 ExperimentUIManager
 * - 提供統一的事件處理和狀態管理
 * - 確保不同頁面的行為一致性
 */

class ExperimentSystemManager {
  /**
   * 建構函式
   * @param {Object} config - 配置選項
   */
  constructor(config = {}) {
    // 依賴注入
    this.combinationManager = config.combinationManager;
    this.uiManager = config.uiManager;
    this.hubManager = config.hubManager;
    this.flowManager = config.flowManager;

    // UI 狀態
    this.state = {
      initialized: false,
      containers: {
        combinationSelector: null,
        unitPanel: null,
        experimentControls: null,
      },
      currentCombination: null,
      currentUnitIds: [],
    };

    // 事件監聽器集合
    this.listeners = new Map();

    this._log("ExperimentSystemManager 已建立");
  }

  /**
   * 初始化系統管理器
   */
  async initialize() {
    if (this.state.initialized) {
      this._warn("系統管理器已經初始化");
      return;
    }

    try {
      // 確保依賴項存在
      if (!this.combinationManager) {
        throw new Error("ExperimentCombinationManager 為必填依賴項");
      }
      if (!this.uiManager) {
        throw new Error("ExperimentUIManager 為必填依賴項");
      }

      // 初始化 ActionHandler 並注入到 FlowManager
      this._initializeActionHandler();

      // 設置事件監聽器
      this._setupEventListeners();

      // 應用預設組合
      await this._applyDefaultCombination();

      this.state.initialized = true;
      this._log("系統管理器初始化完成");
    } catch (error) {
      this._error("系統管理器初始化失敗:", error);
      throw error;
    }
  }

  /**
   * 初始化動作處理器
   * @private
   */
  _initializeActionHandler() {
    try {
      // 檢查 ExperimentActionHandler 是否可用
      if (typeof ExperimentActionHandler === "undefined") {
        this._warn("ExperimentActionHandler 不可用");
        return;
      }

      // 創建 ActionHandler 實例
      if (!window.experimentActionHandler) {
        window.experimentActionHandler = new ExperimentActionHandler({
          enableRemoteSync: true,
          enableAutoProgress: true,
          autoProgressDelay: 3000,
          enableGestureValidation: true,
        });

        // 如果 FlowManager 存在，將 ActionHandler 注入
        if (this.flowManager && this.flowManager.injectActionHandler) {
          this.flowManager.injectActionHandler(window.experimentActionHandler);
          this._log("ActionHandler 已建立並注入到 FlowManager");
        } else {
          this._log("ActionHandler 已建立，但 FlowManager 不可用");
        }
      } else {
        this._log("ActionHandler 已存在，使用現有實例");
        // 確保已注入到 FlowManager
        if (this.flowManager && this.flowManager.injectActionHandler) {
          this.flowManager.injectActionHandler(window.experimentActionHandler);
        }
      }
    } catch (error) {
      this._error("初始化 ActionHandler 失敗:", error);
    }
  }

  /**
   * 初始化UI組件
   * @param {Object} containers - 容器元素選擇器
   * @param {Object} scriptData - 腳本數據
   */
  async initializeUI(containers = {}, scriptData = null) {
    if (!this.state.initialized) {
      throw new Error("系統管理器尚未初始化，請先調用 initialize()");
    }

    try {
      // 儲存容器引用和腳本數據
      this.state.containers = { ...containers };
      this.state.scriptData = scriptData;

      // 初始化組合選擇器
      if (containers.combinationSelector) {
        await this._initializeCombinationSelector(
          containers.combinationSelector,
        );
      }

      // 初始化單元面板
      if (containers.unitPanel && scriptData?.units) {
        await this._initializeUnitPanel(containers.unitPanel, scriptData.units);
      }

      // 初始化實驗控制面板
      if (containers.experimentControls) {
        await this._initializeExperimentControls(containers.experimentControls);
      }

      this._log("UI組件初始化完成");
    } catch (error) {
      this._error("UI組件初始化失敗:", error);
      throw error;
    }
  }

  /**
   * 初始化組合選擇器
   * @private
   */
  async _initializeCombinationSelector(container) {
    const combinations = this.combinationManager.getAvailableCombinations();

    if (combinations.length === 0) {
      this._warn("沒有可用的組合");
      return;
    }

    // 將組合資料標準化為 UI 所預期的格式
    const combosForUI = combinations.map((c) => ({
      id: c.combinationId,
      name: c.combinationName,
      description: c.description || "",
    }));

    const currentCombo = this.combinationManager.getCurrentCombination();
    const activeId = currentCombo?.combinationId || currentCombo?.id || null;

    this.uiManager.renderCombinationSelector(container, combosForUI, {
      activeId,
      showTitle: true,
      title: "單元組合",
      onSelect: async (combinationId) => {
        if (!combinationId) {
          this._warn("未收到有效的組合ID，忽略選擇事件");
          return;
        }
        await this.selectCombination(combinationId);
      },
    });

    this._log("組合選擇器已初始化");
  }

  /**
   * 初始化單元面板
   * @private
   * @param {string} container - 容器選擇器
   * @param {Array} units - 單元數據
   */
  async _initializeUnitPanel(container, units) {
    // 準備單元數據
    const preparedUnits = units.map((unit) => ({
      id: unit.unit_id,
      title: unit.unit_name || unit.unit_id,
      stepCount: unit.steps ? unit.steps.length : 0,
      checked: this.state.currentUnitIds.includes(unit.unit_id),
    }));

    this.uiManager.renderUnitsPanel(
      container,
      preparedUnits,
      this.state.currentUnitIds,
      {
        showHeader: true,
        headerTitle: "教學單元",
        showSelectAll: true,
        showPowerOptions: true,
        includeStartup: true,
        includeShutdown: true,
        enableSorting: true,
        onUnitToggle: (event) => {
          this._handleUnitToggle(event);
        },
        onReorder: (fromIndex, toIndex) => {
          this._handleUnitReorder(fromIndex, toIndex);
        },
      },
    );

    this._log("單元面板已初始化");
  }

  /**
   * 初始化實驗控制面板
   * @private
   */
  async _initializeExperimentControls(container) {
    const experimentId = this.hubManager?.getExperimentId() || "";

    this.uiManager.renderExperimentControls(container, {
      showExperimentId: true,
      showParticipantName: true,
      showTimer: true,
      experimentId: experimentId,
      onStart: () => this._handleExperimentStart(),
      onPause: () => this._handleExperimentPause(),
      onStop: () => this._handleExperimentStop(),
      onRegenerateId: () => this._handleRegenerateId(),
    });

    this._log("實驗控制面板已初始化");
  }

  /**
   * 選擇組合
   * @param {string} combinationId - 組合ID
   */
  async selectCombination(combinationId) {
    try {
      const combination =
        this.combinationManager.getCombinationById(combinationId);
      if (!combination) {
        throw new Error(`找不到組合: ${combinationId}`);
      }

      const experimentId = this.hubManager?.getExperimentId?.() || null;
      const success = await this.combinationManager.setCombination(
        combination,
        experimentId,
      );

      if (success) {
        this._log(`組合已切換: ${combination.combinationName}`);
      } else {
        this._error(`組合切換失敗: ${combinationId}`);
      }

      return success;
    } catch (error) {
      this._error("選擇組合失敗:", error);
      return false;
    }
  }

  /**
   * 設置事件監聽器
   * @private
   */
  _setupEventListeners() {
    // 監聽組合選擇事件
    this.combinationManager.on("combination:selected", (data) => {
      this._handleCombinationSelected(data);
    });

    // 監聽組合載入事件
    this.combinationManager.on("combination:loaded", (data) => {
      this._handleCombinationLoaded(data);
    });
  }

  /**
   * 處理組合選擇事件
   * @private
   */
  _handleCombinationSelected(data) {
    const { combination, unitIds } = data;

    // 更新狀態
    this.state.currentCombination = combination;
    this.state.currentUnitIds = unitIds || [];

    // 更新UI
    this._updateUIForCombination(combination, unitIds);

    this._log("組合選擇事件已處理:", combination.combinationName);
  }

  /**
   * 處理組合載入事件
   * @private
   */
  _handleCombinationLoaded(data) {
    this._log("組合載入事件已處理:", data);
  }

  /**
   * 應用預設組合
   * @private
   */
  async _applyDefaultCombination() {
    try {
      const success = await this.combinationManager.applyDefaultCombination();
      if (success) {
        const currentCombo = this.combinationManager.getCurrentCombination();
        this.state.currentCombination = currentCombo;
        this.state.currentUnitIds =
          this.combinationManager.getCombinationUnitIds(currentCombo) || [];
        this._log("預設組合已應用:", currentCombo?.combinationName);

        // 如果UI已經初始化，立即更新UI
        if (this.state.containers?.combinationSelector) {
          this._updateUIForCombination(currentCombo, this.state.currentUnitIds);
        }
      }
      return success;
    } catch (error) {
      this._error("應用預設組合失敗:", error);
      return false;
    }
  }

  /**
   * 更新UI以匹配組合
   * @private
   */
  _updateUIForCombination(combination, unitIds) {
    // 更新組合選擇器的選中狀態
    if (this.state.containers.combinationSelector) {
      this.uiManager.updateCombinationSelection(
        this.state.containers.combinationSelector,
        combination.combinationId,
      );
    }

    // 更新單元面板
    if (this.state.containers.unitPanel) {
      this._updateUnitPanelForCombination(combination, unitIds);
    }
  }

  /**
   * 更新單元面板以匹配組合
   * @private
   */
  _updateUnitPanelForCombination(combination, unitIds) {
    const unitList = document.querySelector(
      `${this.state.containers.unitPanel} .experiment-units-list`,
    );

    if (!unitList) return;

    // 取消全部選擇
    unitList
      .querySelectorAll('li:not(.power-option-card) input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.checked = false;
      });

    // 選擇組合中的單元
    unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (unitIds.includes(li.dataset.unitId)) {
        checkbox.checked = true;
      }
    });

    // 重新排序
    this._reorderUnitsForCombination(unitList, unitIds);
  }

  /**
   * 重新排序單元以匹配組合順序
   * @private
   */
  _reorderUnitsForCombination(unitList, unitIds) {
    const normalItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)"),
    );
    const startupCard = unitList.querySelector(".startup-card");
    const shutdownCard = unitList.querySelector(".shutdown-card");

    // 按照 unitIds 順序重新排列
    unitIds.forEach((unitId) => {
      const li = normalItems.find((item) => item.dataset.unitId === unitId);
      if (li) {
        if (shutdownCard && shutdownCard.parentNode === unitList) {
          unitList.insertBefore(li, shutdownCard);
        } else if (startupCard && startupCard.parentNode === unitList) {
          unitList.insertBefore(li, startupCard);
        } else {
          unitList.appendChild(li);
        }
      }
    });
  }

  /**
   * 處理單元切換事件
   * @private
   */
  _handleUnitToggle(event) {
    this._log("單元切換事件:", event);
  }

  /**
   * 處理單元重新排序事件
   * @private
   */
  _handleUnitReorder(fromIndex, toIndex) {
    this._log("單元重新排序:", { fromIndex, toIndex });
  }

  /**
   * 處理實驗開始事件
   * @private
   */
  _handleExperimentStart() {
    if (this.flowManager) {
      this.flowManager.startExperiment();
      this._log("實驗開始 - 使用 ExperimentFlowManager");
    } else {
      this._log("實驗開始 - ExperimentFlowManager 不可用");
    }
  }

  /**
   * 處理實驗暫停事件
   * @private
   */
  _handleExperimentPause() {
    if (this.flowManager) {
      this.flowManager.pauseExperiment();
      this._log("實驗暫停 - 使用 ExperimentFlowManager");
    } else {
      this._log("實驗暫停 - ExperimentFlowManager 不可用");
    }
  }

  /**
   * 處理實驗停止事件
   * @private
   */
  _handleExperimentStop() {
    if (this.flowManager) {
      this.flowManager.stopExperiment();
      this._log("實驗停止 - 使用 ExperimentFlowManager");
    } else {
      this._log("實驗停止 - ExperimentFlowManager 不可用");
    }
  }

  /**
   * 處理重新產生ID事件
   * @private
   */
  _handleRegenerateId() {
    this._log("重新產生實驗ID");
    // 這裡可以觸發重新產生ID邏輯
  }

  // ==========================================
  // 日誌方法
  // ==========================================

  _log(message, ...args) {
    Logger.debug(`[ExperimentSystemManager] ${message}`, ...args);
  }

  _warn(message, ...args) {
    Logger.warn(`[ExperimentSystemManager] ${message}`, ...args);
  }

  _error(message, ...args) {
    Logger.error(`[ExperimentSystemManager] ${message}`, ...args);
  }
}

// 導出到全域
window.ExperimentSystemManager = ExperimentSystemManager;
