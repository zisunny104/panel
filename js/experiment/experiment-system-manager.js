/**
 * ExperimentSystemManager - 統一協調實驗系統
 *
 * 整合並協調 UI、組合、流程、Hub 等管理器，處理管理器間的
 * 事件串接與狀態同步，確保各模組正確互動與資料一致性。
 */

import { LOG_SOURCES, SYNC_EVENTS } from "../constants/index.js";
import { experimentSyncManager } from "../board/board-sync-manager.js";
import { generateExperimentId } from "../core/random-utils.js";
import ExperimentActionHandler from "./experiment-action-handler.js";
import ExperimentFlowManager from "./experiment-flow-manager.js";
import ExperimentHubManager from "./experiment-hub-manager.js";

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
    this.timerManager = config.timerManager;
    this.pageManager = config.pageManager || null;
    this.actionHandler = config.actionHandler || null;
    this.experimentLogManager = config.experimentLogManager || null;

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
      uiInitialized: {
        combinationSelector: false,
        unitPanel: false,
        experimentControls: false,
      },
      pendingUi: {
        experimentId: null,
        participantName: null,
      },
    };

    this.listeners = new Map();
    this._comboSignatureCache = null;

    Logger.debug("ExperimentSystemManager 已建立");
  }

  /**
   * 初始化系統管理器
   */
  async initialize() {
    if (this.state.initialized) {
      return;
    }

    const initStart = performance.now();

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
      const duration = performance.now() - initStart;
      Logger.debug(
        `系統管理器初始化完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error(
        "系統管理器初始化失敗:",
        error instanceof Error ? error.message : String(error),
      );
      if (error instanceof Error) {
        Logger.error("堆棧:", error.stack);
      }
      throw error;
    }
  }

  /**
   * 初始化動作處理器
   * @private
   */
  _initializeActionHandler() {
    let actionHandler = this.actionHandler;
    if (!actionHandler) {
      actionHandler = new ExperimentActionHandler({
        enableRemoteSync: true,
        enableAutoProgress: true,
        autoProgressDelay: 3000,
        enableGestureValidation: true,
      });
    }

    this.flowManager.injectActionHandler(actionHandler);
    actionHandler.injectFlowManager(this.flowManager);
    actionHandler.updateDependencies({
      experimentSystemManager: this,
      syncClient: this.pageManager?.syncManager?.core?.syncClient || null,
    });
    this.actionHandler = actionHandler;
  }

  /**
  * 初始化 UI 元件
   * @param {Object} containers - 容器元素選擇器
   * @param {Object} scriptData - 腳本數據
   */
  async initializeUI(containers = {}, scriptData = null) {
    if (!this.state.initialized) {
      throw new Error("系統管理器尚未初始化，請先呼叫 initialize()");
    }
    this.state.containers = { ...containers };
    this.state.scriptData = scriptData;

    if (containers.combinationSelector) {
      await this._initializeCombinationSelector(containers.combinationSelector);
    }

    if (containers.unitPanel && scriptData?.units) {
      await this._initializeUnitPanel(containers.unitPanel, scriptData.units);
    }

    if (containers.experimentControls) {
      await this._initializeExperimentControls(containers.experimentControls);
    }

    if (this.state.currentCombination && this.state.currentUnitIds.length > 0) {
      Logger.debug(
        `【<cyan>排序追蹤</cyan>】<blue>initializeUI</blue> 自動初始化 [組合: ${this.state.currentCombination.combinationName}] [順序: ${this.state.currentUnitIds.join("→")}]`,
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

    Logger.debug("UI 元件初始化完成");
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

    const rendered = this.uiManager.renderCombinationSelector(container, combosForUI, {
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
    if (rendered) {
      this.state.uiInitialized.combinationSelector = true;
    }
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

    const rendered = this.uiManager.renderUnitsPanel(
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

    this._applyPowerOptionsToUi(
      this._normalizePowerOptions(this.state.currentCombination?.powerOptions),
    );
    this._bindPowerOptionListeners();

    setTimeout(() => this._tryCallPageManager("updateSelectAllState"), 100);

    Logger.debug("單元面板已初始化");
    if (rendered) {
      this.state.uiInitialized.unitPanel = true;
    }
  }

  /**
   * 初始化實驗控制面板
   * @private
   */
  async _initializeExperimentControls(container) {
    const experimentId = this.hubManager.getExperimentId();

    const rendered = this.uiManager.renderExperimentControls(container, {
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
    if (rendered) {
      this.state.uiInitialized.experimentControls = true;
    }
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

      const experimentId = this.hubManager.getExperimentId();
      const combinationWithOptions = {
        ...combination,
        powerOptions: this._getPowerOptionsFromUi(),
      };
      const success = await this.combinationManager.setCombination(
        combinationWithOptions,
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
  * 設定事件監聽器
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

    this.flowManager.on(ExperimentFlowManager.EVENT.COMPLETED, (data) => {
      this._handleFlowStopped({
        reason: data?.reason || "completed",
        completedUnits: data?.completedUnits,
        timestamp: data?.timestamp,
      });
    });

    window.addEventListener("panel:experiment:opened", () => {
      this.refreshPanelUi();
    });

    this.hubManager.on(ExperimentHubManager.EVENT.ID_CHANGED, (data) => {
      this._handleHubIdChanged(data);
    });

    this.uiManager.on("experiment-controls-rendered", () => {
      this._bindExperimentIdInputListener();
    });
    this.uiManager.on("experiment-controls-rendered-delayed", () => {
      this._bindExperimentIdInputListener();
    });

    window.addEventListener(SYNC_EVENTS.COMBINATION_SELECTED, (event) => {
      this._handleRemoteCombinationSelected(event?.detail);
    });
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
    const isExperimentRunning = this.flowManager.state.status === "RUNNING";

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

    // 如果實驗面板已經初始化（即組合選擇器已渲染），需要重新載入組合信息
    if (this.state.containers.combinationSelector) {
      const container = document.querySelector(
        this.state.containers.combinationSelector,
      );
      if (container) {
        Logger.debug("實驗面板已渲染，重新載入新實驗 ID 的組合信息");
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
   * 當實驗 ID 變化時重新初始化組合資訊
   * @private
   */
  async _reinitializeCombinationForNewExperimentId(experimentId) {
    try {
      const currentCombo =
        this.state.currentCombination ||
        this.combinationManager.getCurrentCombination?.() ||
        null;
      const currentUnitIds =
        this.combinationManager.getCombinationUnitIds(
          currentCombo,
          experimentId,
        ) || [];

      if (!currentCombo) {
        Logger.debug("沒有目前組合，僅更新實驗ID後略過組合重繪");
        return;
      }

      this.state.currentCombination = {
        ...currentCombo,
        powerOptions: this._normalizePowerOptions(currentCombo.powerOptions),
      };
      this.state.currentUnitIds = [...currentUnitIds];

      Logger.debug("準備使用新實驗 ID 重繪組合資訊:", {
        experimentId,
        combinationId: currentCombo.combinationId,
        unitIds: currentUnitIds,
      });

      // 直接重新套回 UI，避免先清空造成接收端短暫空白或漏選
      this._updateUIForCombination(currentCombo, currentUnitIds);

      // 保留事件，讓面板層可視情況做額外刷新
      window.dispatchEvent(
        new CustomEvent("experimentSystem:shouldRefreshPanel", {
          detail: { experimentId },
        }),
      );
    } catch (error) {
      Logger.warn("重新初始化組合資訊失敗:", error);
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
   * 【重要】分離了「綁定事件監聽」和「同步 ID 值」
   * 以確保每次面板打開時都能同步最新 ID
   * @private
   */
  _bindExperimentIdInputListener() {
    const idInput = document.getElementById("experimentIdInput");
    if (!idInput) return;

    // 【第一步】始終同步最新 ID 到 DOM（即使已綁定過）
    const currentId = this.hubManager?.ids?.experiment;
    if (currentId) {
      idInput.value = currentId;
      Logger.debug("面板展開時同步實驗ID到UI:", currentId);
    }

    // 【第二步】若未綁定過事件監聽，則綁定（避免重複綁定）
    if (!idInput._experimentSystemBound) {
      this._setupExperimentIdInputListener(idInput);
      Logger.debug("實驗ID輸入框事件監聽已綁定");
    }
  }

  /**
   * 處理組合選擇事件
   * @private
   */
  _handleCombinationSelected(data) {
    const { combination, unitIds } = data;
    const normalizedPowerOptions = this._normalizePowerOptions(
      combination?.powerOptions,
    );

    // 更新狀態
    this.state.currentCombination = {
      ...combination,
      powerOptions: normalizedPowerOptions,
    };
    this.state.currentUnitIds = unitIds || [];

    this._applyPowerOptionsToUi(normalizedPowerOptions);

    Logger.debug(
      `【<cyan>排序追蹤</cyan>】<blue>組合選擇</blue> [組合: ${combination?.combinationName}] [順序: ${(unitIds || []).join("→")}]`,
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

  _handleRemoteCombinationSelected(detail) {
    if (!detail || detail.source !== LOG_SOURCES.REMOTE_SYNC) {
      return;
    }

    const combination = detail.combination;
    if (!combination) {
      Logger.warn("遠端組合資料缺失，忽略同步");
      return;
    }

    if (this.flowManager?.isRunning) {
      Logger.debug("實驗進行中，忽略遠端組合同步");
      return;
    }

    const normalizedPowerOptions = this._normalizePowerOptions(
      combination.powerOptions,
    );
    this._applyPowerOptionsToUi(normalizedPowerOptions);
    const normalizedCombination = {
      ...combination,
      powerOptions: normalizedPowerOptions,
    };

    const experimentId = detail.experimentId || this.getExperimentId();
    const skipCache = combination.combinationId === "custom";
    this.combinationManager.setCombination(normalizedCombination, experimentId, {
      skipBroadcast: true,
      skipCache,
    });
  }

  _handleCombinationLoaded(data) {
    Logger.debug("組合載入事件已處理:", data);
  }

  /**
   * 套用預設組合
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
        Logger.debug("預設組合已套用:", currentCombo?.combinationName);
        Logger.debug(
          `【<cyan>排序追蹤</cyan>】<blue>預設組合自動套用</blue> [組合: ${currentCombo?.combinationName}] [順序: ${this.state.currentUnitIds.join("→")}]`,
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
      Logger.error("套用預設組合失敗:", error);
      return false;
    }
  }

  /**
   * 更新UI以符合組合
   * @private
   */
  _updateUIForCombination(combination, unitIds) {
    if (this.state.containers.combinationSelector) {
      const containerEl = document.querySelector(
        this.state.containers.combinationSelector,
      );
      if (containerEl) {
        this.uiManager.updateCombinationSelection(
          containerEl,
          combination.combinationId,
        );
      }
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
        // 判斷目前頁面類型（非 board.html 一律視為 panel）
        const isPanel = !window.location.pathname.includes("board.html");

        if (isPanel) {
          // Panel 頁面的實驗元件是延遲渲染，元素不存在是正常的
          // 設定 MO 等待面板可見後，再套用組合排序（確保在 renderNow() 之後執行）
          const panelAncestor = document
            .querySelector(this.state.containers.unitPanel)
            ?.closest(".experiment-panel");
          if (panelAncestor) {
            const mo = new MutationObserver((mutations, obs) => {
              if (window.getComputedStyle(panelAncestor).display !== "none") {
                obs.disconnect();
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
          Logger.debug("找不到單元列表元素，無法更新單元面板", {
            container: this.state.containers.unitPanel,
            combination: combination?.combinationName,
            unitIds,
          });
        }
        return false;
      }

      // 取消全部選擇
      unitList
        .querySelectorAll("li:not(.power-option-card) input[type=\"checkbox\"]")
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
        const checkbox = li.querySelector("input[type=\"checkbox\"]");
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
        `【<cyan>排序追蹤</cyan>】<yellow>排序前</yellow> DOM[${domOrderBefore.join("→")}] 目標[${unitIds.join("→")}] ${needsReorder ? "⚠需調整" : "✓相同"}`,
        {
          combinationName: combination?.combinationName,
          combinationId: combination?.combinationId,
          目標unitIds: [...unitIds],
          目前DOM順序: domOrderBefore,
          需要調整: needsReorder,
        },
      );
      if (needsReorder) {
        this._reorderUnitsForCombination(unitList, unitIds);
        const domOrderAfter = Array.from(
          unitList.querySelectorAll("li[data-unit-id]"),
        ).map((li) => li.dataset.unitId);
        Logger.debug(`【<cyan>排序追蹤</cyan>】<green>排序完成</green> DOM[${domOrderAfter.join("→")}]`, {
          排序後DOM順序: domOrderAfter,
        });
      }

      // 更新全選狀態（嘗試呼叫頁面管理器，若不存在則靜默跳過）
      this._tryCallPageManager("updateSelectAllState");

      return true;
    };

    // 先嘗試更新UI
    if (!updateUI()) {
      // 判斷是否為 Panel 頁面
      const isPanel = !window.location.pathname.includes("board.html");

      if (isPanel) {
        // Panel 頁面不需要重試，UI 會在面板展開時自動渲染
        return;
      }

      // Board 頁面重試一次
      setTimeout(() => {
        if (!updateUI()) {
          Logger.debug("重試後仍然找不到單元列表元素");
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

    // 重新排序後更新按鈕停用狀態，確保第一個項目的▲被停用、最後一個的▼被停用
    setTimeout(() => this._tryCallPageManager("updateUnitButtonStates"), 0);
  }

  /**
   * 處理單元切換事件
   * @private
   */
  _handleUnitToggle(event) {
    const selectedUnitIds = this._getUnitIdsFromUi({ onlyChecked: true });
    this._applyCustomUnitSelection(selectedUnitIds);
    setTimeout(() => this._tryCallPageManager("updateSelectAllState"), 10);
  }

  /**
   * 處理單元重新排序事件
   * @private
   */
  _handleUnitReorder(fromIndex, toIndex) {
    Logger.debug("單元重新排序:", { fromIndex, toIndex });
    const selectedUnitIds = this._getUnitIdsFromUi({ onlyChecked: true });
    this._applyCustomUnitSelection(selectedUnitIds);
    this._tryCallPageManager("handleUnitReorder", fromIndex, toIndex);
  }

  applyCustomUnitSelection(unitIds = [], options = {}) {
    return this._applyCustomUnitSelection(unitIds, options);
  }

  _applyCustomUnitSelection(unitIds = [], options = {}) {
    if (!Array.isArray(unitIds)) return false;

    const powerOptions = this._normalizePowerOptions(
      options.powerOptions || this._getPowerOptionsFromUi(),
    );
    const currentUnitIds = this.state.currentUnitIds || [];
    const currentCombo =
      this.state.currentCombination ||
      this.combinationManager.getCurrentCombination();
    const baseComboId =
      currentCombo?.baseCombinationId || currentCombo?.combinationId;
    const baseCombo = baseComboId
      ? this.combinationManager.getCombinationById(baseComboId)
      : null;
    const currentPowerOptions = this._normalizePowerOptions(
      currentCombo?.powerOptions,
    );
    const powerOptionsChanged = !this._isSamePowerOptions(
      powerOptions,
      currentPowerOptions,
    );
    const experimentId = this.getExperimentId();

    if (unitIds.length === 0) {
      Logger.warn("忽略空白單元選擇，保留目前單元列表");
      return false;
    }

    const orderUnchanged = this._isSameUnitOrder(unitIds, currentUnitIds);
    if (orderUnchanged && !powerOptionsChanged && !options.forceBroadcast) {
      return false;
    }

    this.state.currentUnitIds = [...unitIds];

    const matchedCombo = this._findMatchingCombination(unitIds, experimentId);
    if (matchedCombo) {
      const combinationWithOptions = {
        ...matchedCombo,
        powerOptions,
      };
      return this.combinationManager.setCombination(
        combinationWithOptions,
        experimentId,
        {
          skipCache: false,
          skipBroadcast: options.skipBroadcast === true,
        },
      );
    }

    const customCombination = this._buildCustomCombination(
      unitIds,
      baseCombo || currentCombo,
      powerOptions,
    );
    return this.combinationManager.setCombination(
      customCombination,
      experimentId,
      {
        skipCache: true,
        skipBroadcast: options.skipBroadcast === true,
      },
    );
  }

  _buildCustomCombination(unitIds, baseCombination = null, powerOptions = null) {
    return {
      combinationId: "custom",
      combinationName: "自訂組合",
      description: "根據選擇和排序產生的自訂組合",
      units: [...unitIds],
      is_randomizable: false,
      baseCombinationId: baseCombination?.combinationId || null,
      baseCombinationName: baseCombination?.combinationName || null,
      powerOptions: this._normalizePowerOptions(
        powerOptions || this._getPowerOptionsFromUi(),
      ),
      source: "custom_order",
    };
  }

  _normalizePowerOptions(options = {}) {
    return { includeStartup: true, includeShutdown: true };
  }

  _isSamePowerOptions(a = {}, b = {}) {
    return a.includeStartup === b.includeStartup &&
      a.includeShutdown === b.includeShutdown;
  }

  _getPowerOptionsFromUi() {
    const includeStartup =
      document.getElementById("includeStartup")?.checked ?? true;
    const includeShutdown =
      document.getElementById("includeShutdown")?.checked ?? true;
    return { includeStartup, includeShutdown };
  }

  _applyPowerOptionsToUi(options = {}) {
    const startupCheckbox = document.getElementById("includeStartup");
    if (
      startupCheckbox &&
      typeof options.includeStartup === "boolean" &&
      startupCheckbox.checked !== options.includeStartup
    ) {
      startupCheckbox.checked = options.includeStartup;
    }

    const shutdownCheckbox = document.getElementById("includeShutdown");
    if (
      shutdownCheckbox &&
      typeof options.includeShutdown === "boolean" &&
      shutdownCheckbox.checked !== options.includeShutdown
    ) {
      shutdownCheckbox.checked = options.includeShutdown;
    }
  }

  _bindPowerOptionListeners() {
    const startupCheckbox = document.getElementById("includeStartup");
    if (startupCheckbox && !startupCheckbox._experimentSystemBound) {
      startupCheckbox._experimentSystemBound = true;
      startupCheckbox.addEventListener("change", () => {
        this._handlePowerOptionsChanged();
      });
    }

    const shutdownCheckbox = document.getElementById("includeShutdown");
    if (shutdownCheckbox && !shutdownCheckbox._experimentSystemBound) {
      shutdownCheckbox._experimentSystemBound = true;
      shutdownCheckbox.addEventListener("change", () => {
        this._handlePowerOptionsChanged();
      });
    }
  }

  _handlePowerOptionsChanged() {
    const selectedUnitIds = this._getUnitIdsFromUi({ onlyChecked: true });
    this._applyCustomUnitSelection(selectedUnitIds, {
      forceBroadcast: true,
      powerOptions: this._getPowerOptionsFromUi(),
    });
  }

  _getUnitIdsFromUi({ onlyChecked = false } = {}) {
    const unitPanelSelector = this.state.containers?.unitPanel;
    const unitList = unitPanelSelector
      ? document.querySelector(`${unitPanelSelector} .experiment-units-list`)
      : document.querySelector(".experiment-units-list");
    if (!unitList) return [];

    const items = Array.from(unitList.querySelectorAll("li[data-unit-id]"));
    const filtered = onlyChecked
      ? items.filter((li) => li.querySelector("input[type=\"checkbox\"]")?.checked)
      : items;

    return filtered.map((li) => li.dataset.unitId).filter(Boolean);
  }

  _isSameUnitOrder(a = [], b = []) {
    if (a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
  }

  _getUnitSignature(unitIds = []) {
    return Array.isArray(unitIds) ? unitIds.join("|") : "";
  }

  _getComboSignatureMap(experimentId) {
    const combos = this.combinationManager.getAvailableCombinations?.() || [];
    const comboKey = combos.map((c) => c.combinationId).join("|");
    if (
      this._comboSignatureCache?.experimentId === experimentId &&
      this._comboSignatureCache?.comboKey === comboKey
    ) {
      return this._comboSignatureCache.map;
    }

    const map = new Map();
    combos.forEach((combo) => {
      const ids =
        this.combinationManager.getCombinationUnitIds(combo, experimentId) || [];
      if (!ids.length) return;
      map.set(this._getUnitSignature(ids), combo);
    });

    this._comboSignatureCache = {
      experimentId,
      comboKey,
      map,
    };
    return map;
  }

  _findMatchingCombination(unitIds = [], experimentId = null) {
    const signature = this._getUnitSignature(unitIds);
    if (!signature) return null;
    const map = this._getComboSignatureMap(experimentId);
    return map.get(signature) || null;
  }

  _getFlow() {
    return this.flowManager || null;
  }

  getFlowProgressSnapshot() {
    const flow = this._getFlow();
    if (!flow) {
      return {
        currentUnitIndex: -1,
        totalUnits: 0,
        unitIds: [],
        isLastUnit: false,
      };
    }

    const progress = flow.getProgress?.() || null;
    const unitIds =
      flow.getUnitList?.() ||
      (Array.isArray(flow.loadedUnits) ? [...flow.loadedUnits] : []);
    const currentUnitIndex = progress?.currentUnitIndex ?? flow.currentUnitIndex ?? -1;
    const totalUnits = progress?.totalUnits ?? unitIds.length;
    const isLastUnit = totalUnits > 0 && currentUnitIndex >= totalUnits - 1;

    return {
      currentUnitIndex,
      totalUnits,
      unitIds,
      isLastUnit,
    };
  }

  advanceToNextUnit() {
    return this._getFlow()?.nextUnit?.() || false;
  }

  advanceToNextStep() {
    return this._getFlow()?.nextStep?.() || false;
  }

  isExperimentRunning() {
    const flow = this._getFlow();
    return flow ? (flow.isExperimentRunning?.() ?? Boolean(flow.isRunning)) : false;
  }

  async startExperiment() {
    const flow = this._getFlow();
    if (!flow) {
      throw new Error("ExperimentFlowManager 不可用，無法開始實驗");
    }
    return flow.startExperiment();
  }

  pauseExperiment() {
    return this._getFlow()?.pauseExperiment?.() || false;
  }

  resumeExperiment() {
    return this._getFlow()?.resumeExperiment?.() || false;
  }

  togglePauseExperiment() {
    const flow = this._getFlow();
    if (!flow?.isRunning) return false;
    return flow.isPaused ? this.resumeExperiment() : this.pauseExperiment();
  }

  stopFlowExperiment(...args) {
    return this._getFlow()?.stopExperiment?.(...args) || false;
  }

  stopExperiment(...args) {
    // board 端需要 pageManager.stopExperiment() 以確保 UI/計時器等清理完整
    if (this.pageManager?.stopExperiment) {
      return this.pageManager.stopExperiment(...args);
    }
    return this.stopFlowExperiment(...args);
  }

  async startExperimentFromSync(syncData = {}) {
    const remoteComboId = syncData?.combinationId;
    const currentCombo = this.combinationManager?.getCurrentCombination?.();

    if (
      remoteComboId &&
      (!currentCombo || currentCombo.combinationId !== remoteComboId)
    ) {
      Logger.info(`[ExperimentSystem] 組合不一致，同步遠端組合: ${remoteComboId}`);
      await this.selectCombination(remoteComboId).catch((err) =>
        Logger.warn("[ExperimentSystem] 設定遠端組合失敗:", err),
      );
    }

    if (this.isExperimentRunning()) {
      Logger.debug("[ExperimentSystem] 實驗已在進行中，略過同步啟動");
      return false;
    }

    return this.startExperiment();
  }

  async handleSyncExperimentStart(syncData = {}) {
    await this.handleSyncExperimentIdUpdate(syncData);
    this.handleSyncParticipantNameUpdate(syncData);

    if (!this.isExperimentRunning()) {
      return this.startExperimentFromSync(syncData);
    }
    Logger.debug("[ExperimentSystem] 實驗已在進行中，忽略遠端開始請求");
    return false;
  }

  handleSyncExperimentPaused() {
    if (!this.isExperimentRunning()) return false;
    return this.pauseExperiment();
  }

  handleSyncExperimentResumed() {
    if (!this.isExperimentRunning()) return false;
    return this.resumeExperiment();
  }

  handleSyncExperimentStopped() {
    if (!this.isExperimentRunning()) return false;
    return this.stopExperiment();
  }

  async handleSyncExperimentIdUpdate(syncData = {}) {
    const { experimentId } = syncData;
    if (!experimentId) return false;

    const currentId = this.getExperimentId();
    if (currentId === experimentId) return false;

    await this.setExperimentId(experimentId, LOG_SOURCES.REMOTE_SYNC, {
      registerToHub: false,
      broadcast: false,
      reapplyCombination: true,
    });
    return true;
  }

  handleSyncParticipantNameUpdate(syncData = {}) {
    const { participantName } = syncData;
    if (!participantName) return false;
    this.updateParticipantNameUi(participantName);
    return true;
  }

  /**
   * 處理實驗開始事件
   * @private
   */
  _handleExperimentStart() {
    this.startExperiment();
    Logger.debug("實驗開始 - 透過 ExperimentSystemManager");

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
    this.pauseExperiment();
    Logger.debug("實驗暫停 - 透過 ExperimentSystemManager");
  }

  /**
   * 處理實驗繼續事件
   * @private
   */
  _handleExperimentResume() {
    this.resumeExperiment();
    Logger.debug("實驗繼續 - 透過 ExperimentSystemManager");
  }

  /**
   * 處理實驗停止事件
   * @private
   */
  _handleExperimentStop() {
    this.stopExperiment();
    Logger.debug("實驗停止 - 透過 ExperimentSystemManager");
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

    const sameOrder =
      newUnitIds.length === this.state.currentUnitIds.length &&
      newUnitIds.every((id, index) => id === this.state.currentUnitIds[index]);
    if (sameOrder) {
      return;
    }

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
   * @param {string} source - 日誌來源標籤
   * @param {Object} options - 選項
   * @param {boolean} options.registerToHub - 是否註冊到中樞（預設依同步模式決定）
   * @param {boolean} options.broadcast - 是否廣播（預設 true）
   * @param {boolean} options.reapplyCombination - 是否重新套用組合排序（預設 true）
   */
  async setExperimentId(newId, source = LOG_SOURCES.LOCAL_GENERATE, options = {}) {
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
    } else {
      this.state.pendingUi.experimentId = newId;
    }

    // 同步模式下註冊到中樞
    const isSync = this.hubManager?.isInSyncMode?.() || false;
    const shouldRegister =
      registerToHub === true &&
      isSync &&
      source !== LOG_SOURCES.REMOTE_SYNC &&
      source !== LOG_SOURCES.HUB_SYNC;
    if (shouldRegister) {
      try {
        await experimentSyncManager.registerExperimentIdToHub(newId);
        Logger.debug("實驗ID已註冊到中樞");
      } catch (error) {
        Logger.warn("註冊實驗ID到中樞失敗:", error);
      }
    }

    // 廣播
    if (broadcast) {
      experimentSyncManager.broadcastExperimentIdUpdate(newId);
    }

    // 通知日誌管理器
    if (this.experimentLogManager?.setExperimentId) {
      this.experimentLogManager.setExperimentId(newId, source);
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

  updateParticipantNameUi(participantName) {
    if (!participantName) return;
    const input = document.getElementById("participantNameInput");
    if (input) {
      if (input.value.trim() !== participantName) {
        input.value = participantName;
      }
    } else {
      this.state.pendingUi.participantName = participantName;
    }
  }

  refreshPanelUi() {
    const { combinationSelector, unitPanel, experimentControls } =
      this.state.containers || {};

    if (combinationSelector && !this.state.uiInitialized.combinationSelector) {
      this._initializeCombinationSelector(combinationSelector);
    }

    if (unitPanel && !this.state.uiInitialized.unitPanel) {
      if (this.state.scriptData?.units) {
        this._initializeUnitPanel(unitPanel, this.state.scriptData.units);
      }
    }

    if (experimentControls && !this.state.uiInitialized.experimentControls) {
      this._initializeExperimentControls(experimentControls);
      const idInput = document.getElementById("experimentIdInput");
      if (idInput) {
        this._setupExperimentIdInputListener(idInput);
      }
    }

    this._applyPendingUiUpdates();

    if (this.state.currentCombination && this.state.currentUnitIds.length > 0) {
      setTimeout(() => {
        this._updateUIForCombination(
          this.state.currentCombination,
          this.state.currentUnitIds,
        );
      }, 0);
    }

    if (this.pageManager?.experimentStateManager?.setupInputSync) {
      this.pageManager.experimentStateManager.setupInputSync();
    }
  }

  _applyPendingUiUpdates() {
    const { experimentId, participantName } = this.state.pendingUi;

    if (experimentId) {
      const idInput = document.getElementById("experimentIdInput");
      if (idInput) {
        if (idInput.value.trim() !== experimentId) {
          idInput.value = experimentId;
        }
        this.state.pendingUi.experimentId = null;
      }
    }

    if (participantName) {
      const participantInput = document.getElementById("participantNameInput");
      if (participantInput) {
        if (participantInput.value.trim() !== participantName) {
          participantInput.value = participantName;
        }
        this.state.pendingUi.participantName = null;
      }
    }

    if (this.state.currentCombination && this.state.currentUnitIds.length > 0) {
      this._updateUIForCombination(
        this.state.currentCombination,
        this.state.currentUnitIds,
      );
    }
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
          await this.setExperimentId(hubId, LOG_SOURCES.HUB_SYNC, { broadcast: false, reapplyCombination: true });
          return hubId;
        }
      } catch (error) {
        Logger.warn("取得中樞ID失敗，產生新ID:", error);
      }
    }

    // 產生新 ID
    const newId = generateExperimentId();
    await this.setExperimentId(newId, LOG_SOURCES.LOCAL_GENERATE);
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
      experimentId = generateExperimentId();
      Logger.debug(`實驗ID來源：新產生 (${experimentId})`);
    }

    // 套用（不重複廣播，避免初始化時的雜訊）
    await this.setExperimentId(
      experimentId,
      LOG_SOURCES.LOCAL_INITIALIZE,
      {
        broadcast: isSync,
        reapplyCombination: false, // initializeUI 已處理
      },
    );

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
      await this.setExperimentId(newVal, LOG_SOURCES.LOCAL_INPUT);
    });
  }

  _handleFlowStarted(data) {
    this._applyExperimentLockState({ locked: true, allowParticipantEdit: false });
    this._updateExperimentControlsForStarted();
    this.timerManager.startExperimentTimer();
    Logger.debug("回應實驗開始事件，UI已更新");
  }

  _handleFlowPaused(data) {
    this._applyExperimentLockState({ locked: true, allowParticipantEdit: true });
    this._updateExperimentControlsForPaused();
    this.timerManager.pauseExperimentTimer();
    Logger.debug("回應實驗暫停事件，UI和計時器已更新");
  }

  _handleFlowResumed(data) {
    this._applyExperimentLockState({ locked: true, allowParticipantEdit: false });
    this._updateExperimentControlsForResumed();
    this.timerManager.resumeExperimentTimer();
    Logger.debug("回應實驗繼續事件，UI和計時器已更新");
  }

  _handleFlowStopped(data) {
    this._applyExperimentLockState({ locked: false, allowParticipantEdit: true });
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
    Logger.debug("回應實驗停止事件，UI已更新並發出通知");
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

    // 受試者名稱輸入框由 _setParticipantEditAllowed 統一管理

    document
      .querySelectorAll(".unit-checkbox input[type=\"checkbox\"]")
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

  _setParticipantEditAllowed(allowed) {
    const pInput = document.querySelector("#participantNameInput");
    if (pInput) {
      pInput.readOnly = !allowed;
      if (allowed) {
        pInput.classList.remove("experiment-disabled");
        pInput.removeAttribute("disabled");
      } else {
        pInput.classList.add("experiment-disabled");
        pInput.setAttribute("disabled", "true");
      }
    }
  }

  _applyExperimentLockState({ locked, allowParticipantEdit }) {
    this._setUILocked(!!locked);
    this._setParticipantEditAllowed(!!allowParticipantEdit);
  }

  _tryCallPageManager(methodName, ...args) {
    const mgr = this.pageManager;
    if (mgr && typeof mgr[methodName] === "function") {
      return mgr[methodName](...args);
    }
  }
}

// 匯出到全域
export default ExperimentSystemManager;
export { ExperimentSystemManager };
