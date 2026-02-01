/**
 * PanelPageManager - 面板頁面管理器
 *
 * 負責面板頁面腳本的載入與初始化（Page-level orchestrator）
 */

class PanelPageManager {
  constructor() {
    // 初始化階段狀態
    this.initStages = {
      SCRIPTS_LOADING: "scripts_loading",
      MODULES_INIT: "modules_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;

    // 初始化頁面
    this.initialize();
  }

  /**
   * 開始新的初始化階段
   * @param {string} stage - 階段名稱
   */
  startStage(stage) {
    this.currentStage = stage;
    this.stageStartTime = performance.now();
    Logger.debug(`開始階段: ${stage}`);
  }

  /**
   * 結束當前初始化階段
   */
  endStage() {
    if (this.currentStage && this.stageStartTime) {
      const duration = performance.now() - this.stageStartTime;
      Logger.debug(
        `階段 ${this.currentStage} 完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
      );
    }
    this.currentStage = null;
    this.stageStartTime = null;
  }

  /**
   * 初始化 Page（載入所需腳本並呼叫完成流程）
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("PanelPageManager 開始初始化");

      // 腳本載入
      this.startStage(this.initStages.SCRIPTS_LOADING);
      await this.loadAllScripts();
      this.endStage();

      // 模組初始化
      this.startStage(this.initStages.MODULES_INIT);
      await this.initializeModules();
      this.endStage();

      // 完成
      this.currentStage = this.initStages.COMPLETE;
      Logger.debug(
        `PanelPageManager 初始化完成 (<orange>${(performance.now() - startTime).toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error(
        `PanelPageManager 初始化失敗 (階段: ${this.currentStage}, 耗時: ${(performance.now() - startTime).toFixed(0)} ms)`,
        error,
      );
    }
  }

  /**
   * 階段 1: 載入所有腳本
   */
  async loadAllScripts() {
    // 載入核心腳本
    await this.loadCoreScripts();

    // 載入 UI 控制腳本
    await this.loadUIScripts();

    // 載入實驗管理腳本
    await this.loadExperimentScripts();

    // 載入同步相關腳本
    await this.loadSyncScripts();
  }

  /**
   * 階段 2: 初始化模組
   */
  async initializeModules() {
    await this.onInitializationComplete();
  }

  /**
   * 階段 3: 載入初始數據
   */
  async loadInitialData() {
    // 數據載入已經在 initializeUI 中處理
  }

  /**
   * 帶重試的異步操作
   * @param {Function} operation - 要執行的操作
   * @param {number} maxRetries - 最大重試次數
   * @param {number} delay - 重試間隔 (ms)
   */
  async withRetry(operation, maxRetries = 3, delay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        Logger.warn(`操作失敗 (嘗試 ${attempt}/${maxRetries}):`, error.message);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * 載入核心資源（Logger、config、time sync 等）
   */
  async loadCoreScripts() {
    const coreScripts = [
      "js/core/console-manager.js",
      "js/core/config.js",
      "js/core/websocket-client.js",
      "js/core/time-sync-manager.js",
      "js/core/random-utils.js",
      "js/core/data-loader.js",
      "js/sync/indicator-manager.js",
      "js/sync/sync-client.js",
    ];

    const startTime = performance.now();
    const results = await this.loadScriptsInParallel(coreScripts, false);

    const totalTime = performance.now() - startTime;
    Logger.debug(
      `核心腳本載入完成: <green>${results.loaded}</green> 個載入, <cyan>${results.cached}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 載入面板 UI 與控制相關腳本
   */
  async loadUIScripts() {
    const uiScripts = [
      "js/panel/panel-ui-manager.js",
      "js/panel/panel-button-manager.js",
      "js/panel/panel-logger.js",
      "js/panel/panel-power-control.js",
    ];

    const startTime = performance.now();
    const results = await this.loadScriptsInParallel(uiScripts);

    const totalTime = performance.now() - startTime;
    Logger.debug(
      `UI腳本載入完成: <green>${results.loaded}</green> 個載入, <cyan>${results.cached}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 載入實驗相關模組（system, hub, combination, flow, UI 等）
   */
  async loadExperimentScripts() {
    const experimentScripts = [
      // === 實驗系統管理器 ===
      "js/experiment/experiment-system-manager.js",

      // === 模組化架構===
      "js/experiment/experiment-hub-manager.js",
      "js/experiment/experiment-combination-manager.js",
      "js/experiment/experiment-flow-manager.js",
      "js/experiment/experiment-action-handler.js",
      "js/experiment/experiment-ui-manager.js",

      // Panel 專用模組
      "js/panel/panel-media-manager.js",
      "js/panel/panel-experiment-power.js",
    ];

    const startTime = performance.now();
    const results = await this.loadScriptsInParallel(experimentScripts, false);

    const totalTime = performance.now() - startTime;
    Logger.debug(
      `實驗腳本載入完成: <green>${results.loaded}</green> 個載入, <cyan>${results.cached}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 載入同步/對話框模組
   */
  async loadSyncScripts() {
    const syncScripts = [
      "js/sync/sync-confirm-dialog.js",
      "js/sync/sync-manager.js", // module
      "js/panel/panel-sync-manager.js",
    ];

    const startTime = performance.now();
    const results = await this.loadScriptsInParallel(
      syncScripts,
      (script) => script.includes(".mjs") || script.includes("sync-manager.js"),
    );

    const totalTime = performance.now() - startTime;
    Logger.debug(
      `同步腳本載入完成: <green>${results.loaded}</green> 個載入, <cyan>${results.cached}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 動態新增 <script> 並回傳是否為快取
   */
  loadScript(src, isModule = false) {
    return new Promise((resolve, reject) => {
      const loadStart = performance.now();
      // 檢查是否已經載入
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(true); // 返回 true 表示已快取
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      if (isModule) {
        script.type = "module";
      }
      script.onload = () => {
        resolve(false); // 返回 false 表示新載入
      };
      script.onerror = () => {
        const error = `載入腳本失敗: ${src} (耗時: ${(performance.now() - loadStart).toFixed(0)}ms)`;
        Logger.error(error);
        reject(new Error(error));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * 並行載入多個腳本
   * @param {string[]} scripts - 腳本路徑陣列
   * @param {boolean|function} isModule - 是否為模組，或判斷函數
   * @returns {Promise<{loaded: number, cached: number}>}
   */
  async loadScriptsInParallel(scripts, isModule = false) {
    const promises = scripts.map((script) => {
      const moduleFlag =
        typeof isModule === "function" ? isModule(script) : isModule;
      return this.loadScript(script, moduleFlag);
    });

    const results = await Promise.all(promises);
    const loaded = results.filter((wasCached) => !wasCached).length;
    const cached = results.filter((wasCached) => wasCached).length;

    return { loaded, cached };
  }

  /**
   * 完成腳本載入後建立實驗模組並初始化UI
   */
  async onInitializationComplete() {
    Logger.debug("所有腳本載入完成，開始初始化新架構模組");

    // 優先初始化同步管理器，確保狀態同步
    if (
      window.panelSyncManager &&
      typeof window.panelSyncManager.initialize === "function"
    ) {
      await window.panelSyncManager.initialize();
      Logger.debug("PanelSyncManager 已初始化");
    }

    // 初始化新架構的實驗模組
    try {
      // 初始化 ExperimentHubManager
      if (
        typeof ExperimentHubManager !== "undefined" &&
        !window.experimentHubManager
      ) {
        window.experimentHubManager = new ExperimentHubManager();
        Logger.debug("ExperimentHubManager 已初始化");
      }

      // 初始化 ExperimentCombinationManager
      if (
        typeof ExperimentCombinationManager !== "undefined" &&
        !window.experimentCombinationManager
      ) {
        window.experimentCombinationManager =
          new ExperimentCombinationManager();
        Logger.debug("ExperimentCombinationManager 已初始化");
      }

      // 初始化 ExperimentFlowManager
      try {
        if (
          typeof ExperimentFlowManager !== "undefined" &&
          !window.experimentFlowManager
        ) {
          window.experimentFlowManager = new ExperimentFlowManager();
          // 注入已知依賴
          if (
            window.experimentCombinationManager &&
            typeof window.experimentFlowManager.injectCombinationManager ===
              "function"
          ) {
            window.experimentFlowManager.injectCombinationManager(
              window.experimentCombinationManager,
            );
          }
          if (
            window.experimentHubManager &&
            typeof window.experimentFlowManager.injectHubManager === "function"
          ) {
            window.experimentFlowManager.injectHubManager(
              window.experimentHubManager,
            );
          }
          if (
            window.experimentActionHandler &&
            typeof window.experimentFlowManager.injectActionHandler ===
              "function"
          ) {
            window.experimentFlowManager.injectActionHandler(
              window.experimentActionHandler,
            );
          }
          if (
            window.uiManager &&
            typeof window.experimentFlowManager.injectUIManager === "function"
          ) {
            window.experimentFlowManager.injectUIManager(window.uiManager);
          }
          Logger.debug("ExperimentFlowManager 已初始化");
        }
      } catch (e) {
        Logger.error("初始化 ExperimentFlowManager 失敗", e);
      }
    } catch (error) {
      Logger.error("新架構模組初始化失敗", error);
    }

    // 初始化 ExperimentUIManager
    if (typeof ExperimentUIManager !== "undefined" && !window.uiManager) {
      window.uiManager = new ExperimentUIManager({
        enableVisualHints: true,
        debug: false,
      });
      if (typeof Logger !== "undefined") {
        Logger.debug("ExperimentUIManager 已初始化");
      }
    }

    // 直接初始化實驗 UI
    await this._initializeExperimentUI();

    // 設定實驗面板按鈕顏色
    this.setupExperimentPanelButtonColor();
  }

  async _initializeExperimentUI() {
    try {
      if (typeof ExperimentSystemManager === "undefined") {
        Logger.warn("ExperimentSystemManager 不可用，跳過實驗 UI 初始化");
        return;
      }

      // 確保組合管理器完全初始化並準備好
      if (window.experimentCombinationManager) {
        await window.experimentCombinationManager.ready();
      }

      // 初始化系統管理器實例（共用全域實例）
      if (!window.experimentSystemManager) {
        window.experimentSystemManager = new ExperimentSystemManager({
          combinationManager: window.experimentCombinationManager,
          uiManager: window.uiManager,
          hubManager: window.experimentHubManager,
          flowManager: window.experimentFlowManager,
        });
        await window.experimentSystemManager.initialize();
      }

      // 取得腳本數據 - 使用統一的資料載入器
      let scriptData = null;
      try {
        scriptData = await this.withRetry(
          async () => {
            const convertedData = await loadUnitsFromScenarios();
            return {
              unit_combinations: convertedData.unit_combinations,
              sections: convertedData.sections,
              units: convertedData.units,
              gestures: convertedData.gestures,
            };
          },
          3,
          500,
        );
      } catch (e) {
        Logger.error("載入 scenarios.json 失敗，已重試多次:", e);
        scriptData = {
          unit_combinations: [],
          sections: [],
          units: [],
          gestures: [],
        };
      }

      await window.experimentSystemManager.initializeUI(
        {
          combinationSelector: "#combinationSelectorContainer",
          unitPanel: "#unitsPanelContainer",
          experimentControls: "#experimentControlsContainer",
        },
        scriptData,
      );

      // 設置頁面特定的實驗事件監聽器
      this._setupExperimentEventListeners();

      // 初始化按鈕管理器（如果存在）
      this._initializeButtonManager();

      Logger.debug("Panel: ExperimentSystemManager UI 初始化完成");
    } catch (error) {
      Logger.error("Panel 初始化實驗 UI 失敗:", error);
    }
  }

  /**
   * 設置頁面特定的實驗事件監聽器
   * @private
   */
  _setupExperimentEventListeners() {
    if (!window.experimentFlowManager) {
      Logger.warn("FlowManager 不可用，無法設置事件監聽器");
      return;
    }

    const flowManager = window.experimentFlowManager;

    // 監聽實驗開始事件，載入動作序列並通知按鈕管理器
    flowManager.on(ExperimentFlowManager.EVENT.STARTED, async (data) => {
      Logger.debug("收到實驗開始事件，開始載入動作序列");
      await this._handleExperimentStarted(data);
    });

    // 監聽實驗停止事件，清理按鈕狀態
    flowManager.on(ExperimentFlowManager.EVENT.STOPPED, () => {
      Logger.debug("收到實驗停止事件，清理按鈕狀態");
      this._handleExperimentStopped();
    });

    Logger.debug("已設置頁面特定的實驗事件監聽器");
  }

  /**
   * 處理實驗開始事件：載入動作序列並通知相關管理器
   * @private
   */
  async _handleExperimentStarted(data) {
    try {
      const { units } = data;

      if (!units || units.length === 0) {
        Logger.warn("沒有可用的單元，無法載入動作序列");
        return;
      }

      // 取得第一個單元
      const firstUnit = units[0];

      // 載入動作序列到 ActionHandler
      await this._loadUnitActionsToActionHandler(firstUnit);

      // 通知按鈕管理器更新動作狀態
      this._notifyButtonManagerForActions(firstUnit);

      Logger.debug("實驗開始處理完成，已載入動作序列並通知管理器");
    } catch (error) {
      Logger.error("處理實驗開始事件失敗:", error);
    }
  }

  /**
   * 載入單元動作序列到 ActionHandler
   * @private
   */
  async _loadUnitActionsToActionHandler(unit) {
    const actionHandler = window.experimentActionHandler;

    if (!actionHandler) {
      Logger.warn("ActionHandler 不可用，無法載入動作序列");
      return false;
    }

    // 從單元中提取步驟/動作
    const actions = unit.steps || unit.actions || [];

    if (actions.length === 0) {
      Logger.warn(`單元 ${unit.unit_id} 沒有動作序列`);
      return false;
    }

    // 初始化 ActionHandler 的動作序列
    const success = actionHandler.initializeSequence(actions);

    if (success) {
      Logger.debug("動作序列已載入到 ActionHandler", {
        unitId: unit.unit_id,
        actionCount: actions.length,
      });
      return true;
    } else {
      Logger.error(`無法初始化單元 ${unit.unit_id} 的動作序列`);
      return false;
    }
  }

  /**
   * 初始化按鈕管理器
   * @private
   */
  _initializeButtonManager() {
    if (!window.buttonManager) {
      Logger.warn("ButtonManager 不可用，跳過初始化");
      return;
    }

    // 設置按鈕動作點擊事件監聽器
    window.buttonManager.on("button:action-clicked", (data) => {
      this._handleButtonActionClick(data);
    });

    Logger.debug("ButtonManager 初始化完成，已設置事件監聽器");
  }

  /**
   * 通知按鈕管理器更新動作狀態
   * @private
   */
  _notifyButtonManagerForActions(unit) {
    if (!window.buttonManager) {
      Logger.warn("ButtonManager 不可用，無法通知動作更新");
      return;
    }

    const actions = unit.steps || unit.actions || [];

    if (actions.length === 0) {
      Logger.warn("沒有動作需要通知按鈕管理器");
      return;
    }

    // 準備動作數據
    const actionData = actions.map((action, index) => ({
      actionId: action.action_id || action.id || `action_${index}`,
      buttonId: action.expected_button || action.button_id || `B${index + 1}`,
      action: action,
    }));

    // 發送事件通知按鈕管理器
    window.buttonManager.emit("experiment:actions-loaded", {
      actions: actionData,
      unit: unit,
    });

    Logger.debug(`已通知 ButtonManager 加載 ${actions.length} 個動作`);
  }

  /**
   * 處理按鈕動作點擊事件（從 ButtonManager 接收）
   * @private
   */
  _handleButtonActionClick(data) {
    const { buttonId, actionId, action } = data;

    Logger.debug(`處理按鈕動作點擊: ${buttonId}`, { actionId, action });

    // 驗證動作
    const actionHandler = window.experimentActionHandler;
    if (!actionHandler) {
      Logger.warn("ActionHandler 不可用，無法驗證動作");
      return;
    }

    const validation = actionHandler.validateAction(actionId, {
      buttonId,
      timestamp: Date.now(),
    });

    if (validation.valid) {
      // 動作正確，處理完成
      actionHandler.handleCorrectAction(actionId, {
        buttonId,
        timestamp: Date.now(),
      });

      // 通知 ButtonManager 顯示正確回饋
      if (window.buttonManager) {
        window.buttonManager.showActionFeedback(buttonId, "correct");
      }

      Logger.info(`動作正確: ${buttonId}`);
    } else {
      // 動作錯誤
      actionHandler.handleIncorrectAction(actionId, validation.error);

      // 通知 ButtonManager 顯示錯誤回饋
      if (window.buttonManager) {
        window.buttonManager.showActionFeedback(buttonId, "incorrect");
      }

      Logger.warn(`動作錯誤: ${buttonId}`, validation.error);
    }
  }

  /**
   * 處理實驗停止事件
   * @private
   */
  _handleExperimentStopped() {
    // 清理 ButtonManager 中的實驗動作數據
    if (window.buttonManager) {
      window.buttonManager.experimentActions.clear();
      window.buttonManager.removeActionListeners();
    }

    Logger.debug("已清理實驗動作狀態");
  }

  // 根據實驗狀態切換 experimentPanelButton 底色
  setupExperimentPanelButtonColor() {
    // 初始狀態
    this.setExperimentPanelButtonColor("default");
  }

  // 直接用 JS 切換 experimentPanelButton 底色
  setExperimentPanelButtonColor(status) {
    const btn = document.getElementById("experimentPanelButton");
    if (!btn) {
      // 在 experiment.html 等沒有此按鈕的頁面中，靜默跳過
      return;
    }
    if (status === "running") {
      btn.style.setProperty("background", "#27ae60", "important"); // 綠色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    } else if (status === "paused") {
      btn.style.setProperty("background", "#f39c12", "important"); // 橘色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    } else {
      btn.style.setProperty("background", "#888", "important"); // 灰色，使用 !important
      btn.style.setProperty("color", "#fff", "important");
    }
  }
}

// 建立全域實例
window.panelPageManager = new PanelPageManager();
