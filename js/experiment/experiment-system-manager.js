/**
 * ExperimentSystemManager - 統一協調實驗系統
 *
 * 整合並協調 UI、組合、流程、Hub 等管理器，處理管理器間的
 * 事件串接與狀態同步，確保各模組正確互動與資料一致性。
 */

class ExperimentSystemManager {
  /**
   * 建構函式
   * @param {Object} config - 配置選項
   */
  constructor(config = {}) {
    this.combinationManager = config.combinationManager;
    this.uiManager = config.uiManager;
    this.hubManager = config.hubManager;
    this.flowManager = config.flowManager;

    this.state = {
      initialized: false,
      containers: {
        combinationSelector: null,
        unitPanel: null,
        experimentControls: null,
      },
      currentCombination: null,
      currentUnitIds: [],
      defaultCombinationApplied: false,
    };

    this.listeners = new Map();

    Logger.debug("ExperimentSystemManager 已建立");
  }

  /**
   * 初始化系統管理器
   */
  async initialize() {
    if (this.state.initialized) {
      Logger.warn("系統管理器已經初始化");
      return;
    }

    try {
      if (!this.combinationManager) {
        throw new Error("ExperimentCombinationManager 為必填依賴項");
      }
      if (!this.uiManager) {
        throw new Error("ExperimentUIManager 為必填依賴項");
      }

      this._initializeActionHandler();
      this._setupEventListeners();

      // CombinationManager 不再在 constructor 中自動初始化，
      // combination:selected 事件在此處發出後會被上面的監聽器捕捉
      await this.combinationManager.ready();
      const currentCombo = this.combinationManager.getCurrentCombination();
      if (currentCombo && !this.state.currentCombination) {
        this.state.currentCombination = currentCombo;
        this.state.currentUnitIds =
          this.combinationManager.getCombinationUnitIds(currentCombo) || [];
        this.state.defaultCombinationApplied = true;
        Logger.debug("初始化同步預設組合狀態:", currentCombo.combinationName);
      }

      this.state.initialized = true;
      Logger.debug("系統管理器初始化完成");
    } catch (error) {
      Logger.error("系統管理器初始化失敗:", error);
      throw error;
    }
  }

  /**
   * 初始化動作處理器
   * @private
   */
  _initializeActionHandler() {
    try {
      if (typeof ExperimentActionHandler === "undefined") {
        Logger.warn("ExperimentActionHandler 不可用");
        return;
      }

      if (!window.experimentActionHandler) {
        window.experimentActionHandler = new ExperimentActionHandler({
          enableRemoteSync: true,
          enableAutoProgress: true,
          autoProgressDelay: 3000,
          enableGestureValidation: true,
        });

        if (this.flowManager && this.flowManager.injectActionHandler) {
          this.flowManager.injectActionHandler(window.experimentActionHandler);
          Logger.debug("ActionHandler 已建立並注入到 FlowManager");
        } else {
          Logger.debug("ActionHandler 已建立，但 FlowManager 不可用");
        }
        // 反向注入：將 FlowManager 注入 ActionHandler，使步驟轉換得以執行
        if (
          this.flowManager &&
          window.experimentActionHandler.injectFlowManager
        ) {
          window.experimentActionHandler.injectFlowManager(this.flowManager);
          Logger.debug("FlowManager 已注入到 ActionHandler");
        }
      } else {
        Logger.debug("ActionHandler 已存在，使用現有實例");
        if (this.flowManager && this.flowManager.injectActionHandler) {
          this.flowManager.injectActionHandler(window.experimentActionHandler);
        }
        // 確保反向注入也更新
        if (
          this.flowManager &&
          window.experimentActionHandler.injectFlowManager
        ) {
          window.experimentActionHandler.injectFlowManager(this.flowManager);
        }
      }
    } catch (error) {
      Logger.error("初始化 ActionHandler 失敗:", error);
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
      this.state.containers = { ...containers };
      this.state.scriptData = scriptData;

      if (containers.combinationSelector) {
        await this._initializeCombinationSelector(
          containers.combinationSelector,
        );
      }

      if (containers.unitPanel && scriptData?.units) {
        await this._initializeUnitPanel(containers.unitPanel, scriptData.units);
      }

      if (containers.experimentControls) {
        await this._initializeExperimentControls(containers.experimentControls);
      }

      // 套用目前組合的選擇狀態與排序
      if (
        this.state.currentCombination &&
        this.state.currentUnitIds.length > 0
      ) {
        Logger.debug(
          `【排序追蹤】initializeUI 自動初始化 [組合: ${this.state.currentCombination.combinationName}] [順序: ${this.state.currentUnitIds.join("→")}]`,
          {
            來源: "initializeUI",
            combinationId: this.state.currentCombination.combinationId,
            combinationName: this.state.currentCombination.combinationName,
            unitIds: [...this.state.currentUnitIds],
          },
        );
        this._updateUIForCombination(
          this.state.currentCombination,
          this.state.currentUnitIds,
        );
        Logger.debug(
          "已套用目前組合到UI:",
          this.state.currentCombination.combinationName,
        );
      }

      await this._initializeExperimentId();

      Logger.debug("UI組件初始化完成");
    } catch (error) {
      Logger.error("UI組件初始化失敗:", error);
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
      Logger.warn("沒有可用的組合");
      return;
    }

    const combosForUI = combinations.map((c) => ({
      id: c.combinationId,
      name: c.combinationName,
      description: c.description || "",
    }));

    const currentCombo = this.combinationManager.getCurrentCombination();
    const activeId = currentCombo?.combinationId ?? null;

    Logger.debug("初始化組合選擇器", {
      currentCombo: currentCombo?.combinationName,
      activeId,
      combinations: combinations.length,
    });

    this.uiManager.renderCombinationSelector(container, combosForUI, {
      activeId,
      showTitle: true,
      title: "單元組合",
      onSelect: async (combinationId) => {
        if (!combinationId) {
          Logger.warn("未收到有效的組合ID，忽略選擇事件");
          return;
        }
        await this.selectCombination(combinationId);
      },
    });

    Logger.debug("組合選擇器已初始化");
  }

  /**
   * 初始化單元面板
   * @private
   * @param {string} container - 容器選擇器
   * @param {Array} units - 單元數據
   */
  async _initializeUnitPanel(container, units) {
    const preparedUnits = units.map((unit) => {
      // 計算動作數量：遍歷 step.actions[].interactions
      let actionCount = 0;
      if (unit.steps && Array.isArray(unit.steps)) {
        unit.steps.forEach((step) => {
          if (step.actions && Array.isArray(step.actions)) {
            step.actions.forEach((action) => {
              if (
                action.interactions &&
                typeof action.interactions === "object"
              ) {
                actionCount += Object.keys(action.interactions).length;
              }
            });
          }
        });
      }

      const prepared = {
        id: unit.unit_id,
        title: unit.unit_name || unit.unit_id,
        stepCount: unit.steps ? unit.steps.length : 0,
        actionCount: actionCount,
        checked: this.state.currentUnitIds.includes(unit.unit_id),
      };

      Logger.debug(`準備單元數據: ${prepared.id}`, prepared);
      return prepared;
    });

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

    setTimeout(() => this._tryCallPageManager("updateSelectAllState"), 100);

    Logger.debug("單元面板已初始化");
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
      onResume: () => this._handleExperimentResume(),
      onStop: () => this._handleExperimentStop(),
      onRegenerateId: () => this._handleRegenerateId(),
    });

    Logger.debug("實驗控制面板已初始化");
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
        Logger.debug(`組合已切換: ${combination.combinationName}`);
        // 事件由 _handleCombinationSelected 統一分發，此處不重複 dispatch
      } else {
        Logger.error(`組合切換失敗: ${combinationId}`);
      }

      return success;
    } catch (error) {
      Logger.error("選擇組合失敗:", error);
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

    // 監聽 ExperimentFlowManager 事件
    if (this.flowManager) {
      this.flowManager.on(ExperimentFlowManager.EVENT.STARTED, (data) => {
        this._handleFlowStarted(data);
      });

      this.flowManager.on(ExperimentFlowManager.EVENT.PAUSED, (data) => {
        this._handleFlowPaused(data);
      });

      this.flowManager.on(ExperimentFlowManager.EVENT.RESUMED, (data) => {
        this._handleFlowResumed(data);
      });

      this.flowManager.on(ExperimentFlowManager.EVENT.STOPPED, (data) => {
        this._handleFlowStopped(data);
      });

      this.flowManager.on(ExperimentFlowManager.EVENT.LOCKED, (data) => {
        this._handleFlowLocked(data);
      });

      this.flowManager.on(ExperimentFlowManager.EVENT.UNLOCKED, (data) => {
        this._handleFlowUnlocked(data);
      });
    }

    // 監聽 Hub Manager 的實驗 ID 變化事件（來自其他客戶端）
    // 當實驗 ID 改變時，重新加載該實驗所需的組合信息
    if (this.hubManager) {
      this.hubManager.on(ExperimentHubManager.EVENT.ID_CHANGED, (data) => {
        this._handleHubIdChanged(data);
      });
    }

    // 監聽 UIManager 的實驗控制面板渲染完成事件（處理 Panel 延遲渲染）
    if (this.uiManager) {
      this.uiManager.on("experiment-controls-rendered", () => {
        this._bindExperimentIdInputListener();
      });
      this.uiManager.on("experiment-controls-rendered-delayed", () => {
        this._bindExperimentIdInputListener();
      });
    }
  }

  /**
   * 處理 Hub Manager 實驗 ID 變化事件
   * 當其他客戶端改變實驗 ID 時觸發
   * @private
   */
  _handleHubIdChanged(data) {
    const { type, newValue, source } = data;

    if (type !== "experiment") {
      Logger.debug("Hub ID 變化但不是實驗 ID，忽略:", type);
      return;
    }

    // 檢查是否正在進行實驗
    const isExperimentRunning = this.flowManager?.state?.status === "RUNNING";

    if (isExperimentRunning) {
      Logger.debug(
        "實驗進行中，實驗 ID 變化被忽略 (來自:",
        source,
        ", 新 ID:",
        newValue,
        ")",
      );
      return;
    }

    Logger.debug("【ID 變化】實驗 ID 已從遠端改變，更新 UI 並等待面板打開", {
      source,
      newValue,
    });

    // 更新 UI 中的實驗 ID 顯示
    this._updateExperimentIdUI(newValue);

    // 如果實驗面板已經初始化（即組合選擇器已渲染），需要重新加載組合信息
    if (this.state.containers.combinationSelector) {
      const container = document.querySelector(
        this.state.containers.combinationSelector,
      );
      if (container) {
        Logger.debug("實驗面板已渲染，重新加載新實驗 ID 的組合信息");
        // 重新初始化組合選擇器（使用新的實驗 ID）
        this._reinitializeCombinationForNewExperimentId(newValue);
      }
    }

    // 觸發組合刷新事件，讓 UI 更新（可選）
    window.dispatchEvent(
      new CustomEvent("experimentSystem:experimentIdChanged", {
        detail: { experimentId: newValue, source },
      }),
    );
  }

  /**
   * 當實驗 ID 變化時重新初始化組合信息
   * @private
   */
  async _reinitializeCombinationForNewExperimentId(experimentId) {
    try {
      // 取消全選
      const unitList = document.querySelector(this.state.containers.unitPanel);
      if (unitList) {
        unitList
          .querySelectorAll('input[type="checkbox"]')
          .forEach((checkbox) => {
            checkbox.checked = false;
          });
        Logger.debug("已清除所有單元選擇");
      }

      // 這樣當用戶再次選擇組合時，會使用新的實驗 ID
      // 如果需要自動應用預設組合，可以在這裡調用
      Logger.debug("準備使用新實驗 ID 加載組合信息:", experimentId);

      // 觸發面板重新刷新的事件
      window.dispatchEvent(
        new CustomEvent("experimentSystem:shouldRefreshPanel", {
          detail: { experimentId },
        }),
      );
    } catch (error) {
      Logger.warn("重新初始化組合信息失敗:", error);
    }
  }

  /**
   * 更新 UI 中的實驗 ID 顯示
   * @private
   */
  _updateExperimentIdUI(experimentId) {
    try {
      const idInput = document.getElementById("experimentIdInput");
      if (idInput && idInput.value !== experimentId) {
        idInput.value = experimentId;
        Logger.debug("實驗 ID 已更新到 UI:", experimentId);
      }
    } catch (error) {
      Logger.warn("更新實驗 ID UI 失敗:", error);
    }
  }

  /**
   * 綁定實驗ID輸入框監聽器（可重入，避免重複綁定）
   * @private
   */
  _bindExperimentIdInputListener() {
    const idInput = document.getElementById("experimentIdInput");
    if (idInput && !idInput._experimentSystemBound) {
      // 同步目前實驗ID到 UI（延遲渲染場景）
      const currentId = this.hubManager?.ids?.experiment;
      if (currentId && (!idInput.value || idInput.value === "載入中...")) {
        idInput.value = currentId;
        Logger.debug(`延遲渲染後同步實驗ID到UI: ${currentId}`);
      }

      this._setupExperimentIdInputListener(idInput);
      Logger.debug("實驗ID輸入框事件已綁定（延遲渲染後）");
    }
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

    Logger.debug(
      `【排序追蹤】組合選擇 [組合: ${combination?.combinationName}] [順序: ${(unitIds || []).join("→")}]`,
      {
        來源: "combination:selected 事件",
        combinationId: combination?.combinationId,
        combinationName: combination?.combinationName,
        unitIds: [...(unitIds || [])],
      },
    );

    // 更新UI
    this._updateUIForCombination(combination, unitIds);

    // 統一分發高階事件，讓頁面管理器處理特定邏輯（如腳本載入）
    const experimentId = this.getExperimentId();
    window.dispatchEvent(
      new CustomEvent("experimentSystem:combinationSelected", {
        detail: { combination, experimentId },
      }),
    );

    Logger.debug("組合選擇事件已處理:", combination.combinationName);
  }

  _handleCombinationLoaded(data) {
    Logger.debug("組合載入事件已處理:", data);
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
        Logger.debug("預設組合已應用:", currentCombo?.combinationName);
        Logger.debug(
          `【排序追蹤】預設組合自動套用 [組合: ${currentCombo?.combinationName}] [順序: ${this.state.currentUnitIds.join("→")}]`,
          {
            來源: "_applyDefaultCombination",
            combinationId: currentCombo?.combinationId,
            combinationName: currentCombo?.combinationName,
            unitIds: [...this.state.currentUnitIds],
          },
        );
        if (this.state.containers?.combinationSelector) {
          this._updateUIForCombination(currentCombo, this.state.currentUnitIds);
        }
        this.state.defaultCombinationApplied = true;
      }
      return success;
    } catch (error) {
      Logger.error("應用預設組合失敗:", error);
      return false;
    }
  }

  /**
   * 更新UI以符合組合
   * @private
   */
  _updateUIForCombination(combination, unitIds) {
    Logger.debug(
      `【排序追蹤】_updateUIForCombination [組合: ${combination?.combinationName}] [順序: ${(unitIds || []).join("→")}]`,
      {
        combinationId: combination?.combinationId,
        combinationName: combination?.combinationName,
        unitIds: [...(unitIds || [])],
      },
    );
    if (this.state.containers.combinationSelector) {
      this.uiManager.updateCombinationSelection(
        this.state.containers.combinationSelector,
        combination.combinationId,
      );
    }
    if (this.state.containers.unitPanel) {
      this._updateUnitPanelForCombination(combination, unitIds);
    }
  }

  _updateUnitPanelForCombination(combination, unitIds) {
    const updateUI = () => {
      const unitList = document.querySelector(
        `${this.state.containers.unitPanel} .experiment-units-list`,
      );

      if (!unitList) {
        // 判斷目前頁面類型
        const isPanel =
          window.location.pathname.includes("index.html") ||
          typeof window.panelPageManager !== "undefined";

        if (isPanel) {
          // Panel 頁面的實驗組件是延遲渲染，元素不存在是正常的
          // 設置 MO 等待面板可見後，再套用組合排序（確保在 renderNow() 之後執行）
          Logger.debug(
            `【排序追蹤】DOM未渲染登記MO [組合: ${combination?.combinationName}] [待套用: ${(unitIds || []).join("→")}]`,
            {
              container: this.state.containers.unitPanel,
              combinationName: combination?.combinationName,
              combinationId: combination?.combinationId,
              pendingUnitIds: [...(unitIds || [])],
            },
          );
          const panelAncestor = document
            .querySelector(this.state.containers.unitPanel)
            ?.closest(".experiment-panel");
          if (panelAncestor) {
            const mo = new MutationObserver((mutations, obs) => {
              if (window.getComputedStyle(panelAncestor).display !== "none") {
                obs.disconnect();
                Logger.debug(
                  `【排序追蹤】MO觸發面板展開 [組合: ${combination?.combinationName}] [即將套用: ${(unitIds || []).join("→")}]`,
                  {
                    combinationName: combination?.combinationName,
                    combinationId: combination?.combinationId,
                    unitIds: [...(unitIds || [])],
                  },
                );
                // setTimeout(0) 確保在 renderNow() 之後執行
                setTimeout(() => updateUI(), 0);
              }
            });
            mo.observe(panelAncestor, {
              attributes: true,
              attributeFilter: ["style", "class"],
            });
          }
        } else {
          // Board 頁面應該要有元素，視為警告
          Logger.warn("找不到單元列表元素，無法更新單元面板", {
            container: this.state.containers.unitPanel,
            combination: combination?.combinationName,
            unitIds,
          });
        }
        return false;
      }

      // 取消全部選擇
      unitList
        .querySelectorAll('li:not(.power-option-card) input[type="checkbox"]')
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
        const checkbox = li.querySelector('input[type="checkbox"]');
        if (unitIds.includes(li.dataset.unitId)) {
          checkbox.checked = true;
        }
      });

      // 重新排序
      const domOrderBefore = Array.from(
        unitList.querySelectorAll("li[data-unit-id]"),
      ).map((li) => li.dataset.unitId);
      const needsReorder =
        JSON.stringify(domOrderBefore) !== JSON.stringify(unitIds);
      Logger.debug(
        `【排序追蹤】排序前 DOM[${domOrderBefore.join("→")}] 目標[${unitIds.join("→")}] ${needsReorder ? "⚠需調整" : "✓相同"}`,
        {
          combinationName: combination?.combinationName,
          combinationId: combination?.combinationId,
          目標unitIds: [...unitIds],
          目前DOM順序: domOrderBefore,
          需要調整: needsReorder,
        },
      );
      this._reorderUnitsForCombination(unitList, unitIds);
      const domOrderAfter = Array.from(
        unitList.querySelectorAll("li[data-unit-id]"),
      ).map((li) => li.dataset.unitId);
      Logger.debug(`【排序追蹤】排序完成 DOM[${domOrderAfter.join("→")}]`, {
        排序後DOM順序: domOrderAfter,
      });

      // 更新全選狀態（嘗試呼叫頁面管理器，若不存在則靜默跳過）
      this._tryCallPageManager("updateSelectAllState");

      return true;
    };

    // 先嘗試更新UI
    if (!updateUI()) {
      // 判斷是否為 Panel 頁面
      const isPanel =
        window.location.pathname.includes("index.html") ||
        typeof window.panelPageManager !== "undefined";

      if (isPanel) {
        // Panel 頁面不需要重試，UI 會在面板展開時自動渲染
        return;
      }

      // Board 頁面重試一次
      setTimeout(() => {
        if (!updateUI()) {
          Logger.warn("重試後仍然找不到單元列表元素");
        }
      }, 100);
    }
  }

  /**
   * 重新排序單元以符合組合順序
   * 保留所有單元（被選中和未選中），只改變順序和選中狀態
   * @private
   */
  _reorderUnitsForCombination(unitList, unitIds) {
    const normalItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)"),
    );
    const startupCard = unitList.querySelector(".startup-card");
    const shutdownCard = unitList.querySelector(".shutdown-card");

    const selectedItems = [];
    const unselectedItems = [];

    normalItems.forEach((item) => {
      if (unitIds.includes(item.dataset.unitId)) {
        selectedItems.push(item);
      } else {
        unselectedItems.push(item);
      }
    });

    const sortedSelectedItems = [];
    unitIds.forEach((unitId) => {
      const item = selectedItems.find((li) => li.dataset.unitId === unitId);
      if (item) {
        sortedSelectedItems.push(item);
      }
    });

    const fragment = document.createDocumentFragment();

    if (startupCard) {
      fragment.appendChild(startupCard);
    }

    // 新增排序後的選中單元
    sortedSelectedItems.forEach((item) => {
      fragment.appendChild(item);
    });
    unselectedItems.forEach((item) => {
      fragment.appendChild(item);
    });

    if (shutdownCard) {
      fragment.appendChild(shutdownCard);
    }
    unitList.innerHTML = "";
    unitList.appendChild(fragment);

    const sortedOrder = sortedSelectedItems.map((li) => li.dataset.unitId);
    const unselectOrder = unselectedItems.map((li) => li.dataset.unitId);
    Logger.debug(
      `【排序追蹤】reorder完成 選中[${sortedOrder.join("→")}]${unselectOrder.length ? ` 未選[${unselectOrder.join(",")}]` : ""}`,
      {
        選中並排序: sortedOrder,
        "未選中（排後面）": unselectOrder,
        目標順序: [...unitIds],
      },
    );

    // 重新排序後更新按鈕禁用狀態，確保第一個項目的▲被禁用、最後一個的▼被禁用
    setTimeout(() => this._tryCallPageManager("updateUnitButtonStates"), 0);
  }

  /**
   * 處理單元切換事件
   * @private
   */
  _handleUnitToggle(event) {
    if (event.type === "select-all") {
      this.state.currentUnitIds =
        event.checked && event.unitIds ? event.unitIds : [];
    } else if (event.type === "unit") {
      if (event.checked) {
        if (!this.state.currentUnitIds.includes(event.unitId)) {
          this.state.currentUnitIds.push(event.unitId);
        }
      } else {
        const index = this.state.currentUnitIds.indexOf(event.unitId);
        if (index > -1) {
          this.state.currentUnitIds.splice(index, 1);
        }
      }
    }
    setTimeout(() => this._tryCallPageManager("updateSelectAllState"), 10);
  }

  /**
   * 處理單元重新排序事件
   * @private
   */
  _handleUnitReorder(fromIndex, toIndex) {
    Logger.debug("單元重新排序:", { fromIndex, toIndex });
    // 將排序事件轉發到頁面管理器，觸發按鈕狀態更新與手勢序列重新產生
    this._tryCallPageManager("handleUnitReorder", fromIndex, toIndex);
  }

  /**
   * 處理實驗開始事件
   * @private
   */
  _handleExperimentStart() {
    if (this.flowManager) {
      this.flowManager.startExperiment();
      Logger.debug("實驗開始 - 使用 ExperimentFlowManager");
    } else {
      throw new Error("ExperimentFlowManager 不可用，無法開始實驗");
    }

    // 通知 UI 管理器處理實驗開始（關閉所有面板等）
    if (this.uiManager) {
      this.uiManager._handleExperimentStart();
    }
  }

  /**
   * 處理實驗暫停事件
   * @private
   */
  _handleExperimentPause() {
    if (this.flowManager) {
      this.flowManager.pauseExperiment();
      Logger.debug("實驗暫停 - 使用 ExperimentFlowManager");
    } else {
      Logger.debug("實驗暫停 - ExperimentFlowManager 不可用");
    }
  }

  /**
   * 處理實驗繼續事件
   * @private
   */
  _handleExperimentResume() {
    if (this.flowManager) {
      this.flowManager.resumeExperiment();
      Logger.debug("實驗繼續 - 使用 ExperimentFlowManager");
    } else {
      Logger.debug("實驗繼續 - ExperimentFlowManager 不可用");
    }
  }

  /**
   * 處理實驗停止事件
   * @private
   */
  _handleExperimentStop() {
    // boardPageManager.stopExperiment() 內部會呼叫 flowManager.stopExperiment()
    // 並執行 board 端特定清理（卡片重設、計時器清除、統計顯示等）
    if (window.boardPageManager) {
      window.boardPageManager.stopExperiment(true);
      Logger.debug("實驗停止 - 委派給 boardPageManager");
    } else if (this.flowManager) {
      this.flowManager.stopExperiment();
      Logger.debug("實驗停止 - 使用 ExperimentFlowManager");
    }
  }

  /**
   * 處理重新產生ID事件（由 UI 按鈕回呼觸發）
   * @private
   */
  async _handleRegenerateId() {
    await this.regenerateExperimentId();
  }

  /**
   * 以目前實驗ID重新計算組合的單元排序並更新UI
   * @private
   */
  async _reapplyCombinationWithCurrentId() {
    const combo =
      this.state.currentCombination ||
      this.combinationManager.getCurrentCombination();
    if (!combo) {
      Logger.warn("沒有目前組合，跳過重新套用");
      return;
    }

    const experimentId =
      this.hubManager?.getExperimentId?.() ||
      document.getElementById("experimentIdInput")?.value?.trim() ||
      null;

    // 以新 experimentId 重新取得單元 ID（含隨機排序）
    const newUnitIds =
      this.combinationManager.getCombinationUnitIds(combo, experimentId) || [];

    this.state.currentUnitIds = newUnitIds;
    Logger.debug("以新實驗ID重新計算單元排序:", {
      experimentId,
      unitIds: newUnitIds,
    });

    // 更新 CombinationManager 的 loadedUnits 以保持一致
    this.combinationManager.loadedUnits = newUnitIds;

    // 更新 UI
    this._updateUIForCombination(combo, newUnitIds);

    // 發出事件
    window.dispatchEvent(
      new CustomEvent("experimentSystem:combinationSelected", {
        detail: { combination: combo, experimentId },
      }),
    );
  }

  // ==========================================
  // 實驗ID 生命週期管理（統一入口）
  // ==========================================

  /**
   * 取得目前實驗ID
   * @returns {string|null}
   */
  getExperimentId() {
    return (
      this.hubManager?.getExperimentId?.() ||
      document.getElementById("experimentIdInput")?.value?.trim() ||
      null
    );
  }

  /**
   * 設定實驗ID並更新 UI、中樞、廣播
   * @param {string} newId - 新的實驗ID
   * @param {Object} options - 選項
   * @param {boolean} options.registerToHub - 是否註冊到中樞（預設依同步模式決定）
   * @param {boolean} options.broadcast - 是否廣播（預設 true）
   * @param {boolean} options.reapplyCombination - 是否重新套用組合排序（預設 true）
   */
  async setExperimentId(newId, options = {}) {
    const {
      registerToHub = undefined,
      broadcast = true,
      reapplyCombination = true,
    } = options;

    if (!newId || typeof newId !== "string" || !newId.trim()) {
      Logger.warn("setExperimentId: 無效的實驗ID");
      return;
    }

    newId = newId.trim();
    Logger.debug("設定實驗ID:", newId);

    // 儲存到 HubManager（更新內部狀態並儲存到 localStorage）
    if (this.hubManager) {
      // 直接更新內部狀態
      this.hubManager.ids.experiment = newId;
      // 手動儲存到 localStorage
      this.hubManager.saveIds();
      Logger.debug("實驗ID已儲存到快取");
    }

    // 更新 UI input
    const idInput = document.getElementById("experimentIdInput");
    if (idInput) {
      idInput.value = newId;
    }

    // 同步模式下註冊到中樞
    const isSync = this.hubManager?.isInSyncMode?.() || false;
    const shouldRegister = registerToHub ?? isSync;
    if (
      shouldRegister &&
      window.experimentSyncManager?.registerExperimentIdToHub
    ) {
      try {
        await window.experimentSyncManager.registerExperimentIdToHub(newId);
        Logger.debug("實驗ID已註冊到中樞");
      } catch (error) {
        Logger.warn("註冊實驗ID到中樞失敗:", error);
      }
    }

    // 廣播
    if (
      broadcast &&
      window.experimentSyncManager?.broadcastExperimentIdUpdate
    ) {
      window.experimentSyncManager.broadcastExperimentIdUpdate(newId);
    } else if (broadcast && window.experimentHubManager?.isInSyncMode?.()) {
      // 備援：面板頁面無 experimentSyncManager，直接透過 syncManager 廣播
      window.syncManager.core?.syncState({
        type: window.SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE,
        clientId: window.syncClient?.clientId,
        experimentId: newId,
        timestamp: new Date().toISOString(),
      });
    }

    // 通知日誌管理器
    if (window.experimentLogManager?.setExperimentId) {
      window.experimentLogManager.setExperimentId(newId);
    }

    // 重新計算組合排序
    if (reapplyCombination) {
      await this._reapplyCombinationWithCurrentId();
    }

    // 發出事件
    window.dispatchEvent(
      new CustomEvent("experimentSystem:experimentIdChanged", {
        detail: { experimentId: newId },
      }),
    );
  }

  /**
   * 產生新的實驗ID（自動處理同步/廣播/組合排序）
   * @returns {string} 新產生的實驗ID
   */
  async regenerateExperimentId() {
    Logger.debug("重新產生實驗ID");

    // 如果在同步模式，先檢查中樞是否有不同的ID
    const hubManager = this.hubManager;
    const isSync = hubManager?.isInSyncMode?.() || false;

    if (isSync) {
      try {
        const hubId = await hubManager.getExperimentId();
        const currentId = this.getExperimentId();
        if (hubId && currentId && hubId !== currentId) {
          // 中樞有不同ID，同步到中樞的ID
          Logger.debug(`同步到中樞ID: ${hubId}`);
          await this.setExperimentId(hubId);
          return hubId;
        }
      } catch (error) {
        Logger.warn("取得中樞ID失敗，產生新ID:", error);
      }
    }

    // 產生新 ID
    const newId = RandomUtils.generateExperimentId();
    await this.setExperimentId(newId);
    Logger.debug("新實驗ID已產生:", newId);
    return newId;
  }

  /**
   * 初始化實驗ID：4步優先順序解析 + 事件綁定
   * 優先順序：中樞同步 > localStorage快取 > 已有輸入值 > 產生新ID
   * @private
   */
  async _initializeExperimentId() {
    let experimentId = null;
    const isSync = this.hubManager?.isInSyncMode?.() || false;

    // 第1步：同步模式下從中樞取得
    if (isSync) {
      try {
        experimentId = await this.hubManager.getExperimentId();
        if (experimentId) {
          Logger.debug(`實驗ID來源：中樞 (${experimentId})`);
        }
      } catch (error) {
        Logger.warn("中樞讀取失敗:", error.message);
      }
    }

    // 第2步：localStorage 快取（從 HubManager 讀取）
    if (!experimentId && this.hubManager) {
      const cachedId = this.hubManager.getExperimentId();
      if (cachedId) {
        experimentId = cachedId;
        Logger.debug(`實驗ID來源：localStorage 快取 (${experimentId})`);
      }
    }

    // 第3步：檢查 UI input（如果存在）
    const idInput = document.getElementById("experimentIdInput");
    if (!experimentId && idInput) {
      const inputVal = idInput.value.trim();
      if (inputVal && inputVal !== "載入中...") {
        experimentId = inputVal;
        Logger.debug(`實驗ID來源：輸入框 (${experimentId})`);
      }
    }

    // 第4步：產生新ID
    if (!experimentId) {
      experimentId = RandomUtils.generateExperimentId();
      Logger.debug(`實驗ID來源：新產生 (${experimentId})`);
    }

    // 套用（不重複廣播，避免初始化時的雜訊）
    await this.setExperimentId(experimentId, {
      broadcast: isSync,
      reapplyCombination: false, // initializeUI 已處理
    });

    // 綁定輸入框 change 事件（如果元素存在）
    if (idInput) {
      this._setupExperimentIdInputListener(idInput);
    } else {
      Logger.debug(
        "experimentIdInput 元素不存在，跳過事件綁定（可能在 Panel 延遲渲染中）",
      );
    }
  }

  _setupExperimentIdInputListener(idInput) {
    if (!idInput || idInput._experimentSystemBound) return;
    idInput._experimentSystemBound = true;

    idInput.addEventListener("change", async () => {
      const newVal = idInput.value.trim();
      if (!newVal) {
        await this.regenerateExperimentId();
        return;
      }
      Logger.debug("使用者手動變更實驗ID:", newVal);
      await this.setExperimentId(newVal);
    });
  }

  _handleFlowStarted(data) {
    this._updateExperimentControlsForStarted();
    window.experimentTimerManager.startExperimentTimer();
    Logger.debug("響應實驗開始事件，UI已更新");
  }

  _handleFlowPaused(data) {
    this._updateExperimentControlsForPaused();
    window.experimentTimerManager.pauseExperimentTimer();
    Logger.debug("響應實驗暫停事件，UI和計時器已更新");
  }

  _handleFlowResumed(data) {
    this._updateExperimentControlsForResumed();
    window.experimentTimerManager.resumeExperimentTimer();
    Logger.debug("響應實驗繼續事件，UI和計時器已更新");
  }

  _handleFlowStopped(data) {
    this._updateExperimentControlsForStopped();
    this.uiManager.stopExperimentTimer();
    window.dispatchEvent(
      new CustomEvent("experimentSystem:flowStopped", {
        detail: {
          reason: data.reason,
          completedUnits: data.completedUnits,
          timestamp: data.timestamp,
        },
      }),
    );
    Logger.debug("響應實驗停止事件，UI已更新並發出通知");
  }

  _handleFlowLocked(data) {
    this._lockUIElements();
    Logger.debug("響應鎖定事件，UI元素已鎖定");
  }

  _handleFlowUnlocked(data) {
    this._unlockUIElements();
    Logger.debug("響應解鎖事件，UI元素已解鎖");
  }

  _updateExperimentControlsForStarted() {
    if (this.state.containers?.experimentControls) {
      const container = document.querySelector(
        this.state.containers.experimentControls,
      );
      if (container) {
        const startRow = container.querySelector("#experimentIdRow");
        const controlBtns = container.querySelector(
          "#experimentControlButtons",
        );
        if (startRow) startRow.style.display = "none";
        if (controlBtns) controlBtns.style.display = "flex";
        // 重設暫停按鈕狀態（避免上次暫停的殘留）
        const pauseBtn = container.querySelector("#pauseExperimentBtn");
        if (pauseBtn) {
          pauseBtn.textContent = "⏸ 暫停";
          pauseBtn.classList.remove("btn-secondary");
          pauseBtn.classList.add("btn-primary");
          pauseBtn.dataset.isPaused = "false";
        }
      }
    }
  }

  _updateExperimentControlsForPaused() {
    if (this.state.containers?.experimentControls) {
      const container = document.querySelector(
        this.state.containers.experimentControls,
      );
      if (container) {
        const pauseBtn = container.querySelector("#pauseExperimentBtn");
        if (pauseBtn) {
          pauseBtn.textContent = "⏯ 繼續";
          pauseBtn.classList.remove("btn-primary");
          pauseBtn.classList.add("btn-secondary");
          pauseBtn.dataset.isPaused = "true";
        }
      }
    }
  }

  _updateExperimentControlsForResumed() {
    if (this.state.containers?.experimentControls) {
      const container = document.querySelector(
        this.state.containers.experimentControls,
      );
      if (container) {
        const pauseBtn = container.querySelector("#pauseExperimentBtn");
        if (pauseBtn) {
          pauseBtn.textContent = "⏸ 暫停";
          pauseBtn.classList.remove("btn-secondary");
          pauseBtn.classList.add("btn-primary");
          pauseBtn.dataset.isPaused = "false";
        }
      }
    }
  }

  _updateExperimentControlsForStopped() {
    if (this.state.containers?.experimentControls) {
      const container = document.querySelector(
        this.state.containers.experimentControls,
      );
      if (container) {
        const startRow = container.querySelector("#experimentIdRow");
        const controlBtns = container.querySelector(
          "#experimentControlButtons",
        );
        if (startRow) startRow.style.display = "block";
        if (controlBtns) controlBtns.style.display = "none";
      }
    }
  }

  _lockUIElements() {
    this._setUILocked(true);
  }

  _unlockUIElements() {
    this._setUILocked(false);
  }

  _setUILocked(locked) {
    if (this.state.containers?.combinationSelector) {
      const container = document.querySelector(
        this.state.containers.combinationSelector,
      );
      if (container) {
        container.style.pointerEvents = locked ? "none" : "";
        container.style.opacity = locked ? "0.6" : "";
      }
    }

    document.querySelectorAll(".combination-item").forEach((btn) => {
      btn.style.pointerEvents = locked ? "none" : "";
      btn.style.opacity = locked ? "0.5" : "";
    });

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) experimentIdInput.disabled = locked;

    const regenerateIdBtn = document.getElementById("regenerateIdButton");
    if (regenerateIdBtn) regenerateIdBtn.disabled = locked;

    // 注意：participantInput 的 disabled 狀態由 FlowManager 的 PARTICIPANT_EDIT 事件控制
    // 不在此處直接設定，避免與 _handleParticipantEditAllowed 衝突

    document
      .querySelectorAll('.unit-checkbox input[type="checkbox"]')
      .forEach((cb) => {
        cb.disabled = locked;
      });

    const selectAllBtn = document.getElementById("selectAllUnits");
    if (selectAllBtn) selectAllBtn.disabled = locked;

    // 鎖定排序按鈕與拖曳把手
    document.querySelectorAll(".unit-sort-btn").forEach((btn) => {
      btn.disabled = locked;
      btn.style.pointerEvents = locked ? "none" : "";
      btn.style.opacity = locked ? "0.4" : "";
    });
    document.querySelectorAll(".unit-drag-handle").forEach((handle) => {
      handle.style.pointerEvents = locked ? "none" : "";
      handle.style.cursor = locked ? "default" : "";
      handle.style.opacity = locked ? "0.3" : "";
    });

    const experimentIdRow = document.getElementById("experimentIdRow");
    const controlBtns = document.getElementById("experimentControlButtons");
    if (experimentIdRow) {
      experimentIdRow.classList.toggle("is-hidden", locked);
    }
    if (controlBtns) {
      controlBtns.classList.toggle("is-hidden", !locked);
    }

    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer && locked) {
      experimentTimer.classList.remove("is-hidden");
    }

    Logger.debug(locked ? "UI 已鎖定" : "UI 已解鎖");
  }

  _tryCallPageManager(methodName, ...args) {
    const mgr = window.boardPageManager || window.panelPageManager;
    if (mgr && typeof mgr[methodName] === "function") {
      return mgr[methodName](...args);
    }
  }
}

// 導出到全域
window.ExperimentSystemManager = ExperimentSystemManager;
