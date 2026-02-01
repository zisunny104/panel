/**
 * BoardPageManager - 實驗頁面管理器
 *
 * 專門用於 board.html 頁面，負責載入所有必要的腳本、
 * 初始化各個管理器模組，並協調頁面各組件間的互動。
 */

class BoardPageManager {
  constructor() {
    // 初始化階段狀態
    this.initStages = {
      SCRIPTS_LOADING: "scripts_loading",
      MODULES_INIT: "modules_init",
      COMPONENTS_INIT: "components_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;

    // 開始初始化
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
   * 初始化 Board 頁面（載入腳本並初始化模組）
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("BoardPageManager 開始初始化");

      // 階段 1：載入腳本
      this.startStage(this.initStages.SCRIPTS_LOADING);
      await this.loadAllScripts();
      this.endStage();

      // 階段 2：初始化模組
      this.startStage(this.initStages.MODULES_INIT);
      await this.initializeModules();
      this.endStage();

      // 階段 3：初始化其他組件
      this.startStage(this.initStages.COMPONENTS_INIT);
      await this.initializeOtherComponents();
      this.endStage();

      // 完成
      this.currentStage = this.initStages.COMPLETE;
      Logger.debug(
        `BoardPageManager 初始化完成 (<orange>${(performance.now() - startTime).toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error(
        `BoardPageManager 初始化失敗 (階段: ${this.currentStage}, 耗時: ${(performance.now() - startTime).toFixed(0)} ms)`,
        error,
      );
      // 即使失敗也嘗試繼續基本功能
      await this.initializeOtherComponents().catch((e) => {
        Logger.error("初始化其他組件失敗:", e);
      });
    }
  }

  /**
   * 階段 1：載入所有腳本
   */
  async loadAllScripts() {
    await this.loadDependencies();
  }

  /**
   * 階段 2：初始化模組
   */
  async initializeModules() {
    await this.initializeManagersSimplified();
  }

  /**
   * 階段 3：初始化其他組件
   */
  async initializeOtherComponents() {
    this.initializeRemainingComponents();
  }

  /**
   * 載入實驗頁面所需的依賴腳本
   */
  async loadDependencies() {
    const dependencies = [
      // 核心基礎設施
      { src: "js/core/console-manager.js", isModule: false },
      { src: "js/core/config.js", isModule: false },
      { src: "js/core/websocket-client.js", isModule: false },
      { src: "js/core/time-sync-manager.js", isModule: false },
      { src: "js/experiment/experiment-state-manager.js", isModule: false },

      // 同步系統
      { src: "js/sync/sync-client.js", isModule: false },
      { src: "js/experiment/experiment-hub-manager.js", isModule: false },

      // 核心工具
      { src: "js/core/data-loader.js", isModule: false },
      { src: "js/core/random-utils.js", isModule: false },

      // 實驗模組架構
      {
        src: "js/experiment/experiment-combination-manager.js",
        isModule: false,
      },
      { src: "js/experiment/experiment-flow-manager.js", isModule: false },
      { src: "js/experiment/experiment-action-handler.js", isModule: false },
      { src: "js/experiment/experiment-ui-manager.js", isModule: false },

      // 實驗系統管理器
      { src: "js/experiment/experiment-system-manager.js", isModule: false },

      // 計時器管理
      { src: "js/experiment/experiment-timer.js", isModule: false },

      // Board 專用模組
      { src: "js/board/board-log-manager.js", isModule: false },
      { src: "js/board/board-log-ui.js", isModule: false },
      { src: "js/board/board-export-manager.js", isModule: false },
      { src: "js/board/board-sync-manager.js", isModule: false },
      { src: "js/board/board-ui-manager.js", isModule: false },
      { src: "js/board/board-gesture-utils.js", isModule: false },

      // 同步與對話框
      { src: "js/sync/sync-confirm-dialog.js", isModule: false },
      { src: "js/core/sync-events-constants.js", isModule: true },
      { src: "js/sync/sync-manager.js", isModule: true },
    ];

    // 並行載入所有腳本以提升效能
    const promises = dependencies.map((dep) =>
      this.loadScript(dep.src, dep.isModule),
    );
    await Promise.all(promises);
  }

  /**
   * 動態載入腳本
   */
  loadScript(src, isModule = false) {
    return new Promise((resolve, reject) => {
      // 檢查是否已經載入
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      if (isModule) {
        script.type = "module";
      }
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`載入腳本失敗: ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * 簡化的管理器初始化
   */
  async initializeManagersSimplified() {
    try {
      // 初始化核心管理器
      window.experimentHubManager = new ExperimentHubManager();
      window.experimentUIManager = new ExperimentUIManager();
      window.experimentCombinationManager = new ExperimentCombinationManager();

      // 初始化系統管理器
      const instance = new ExperimentSystemManager({
        combinationManager: window.experimentCombinationManager,
        uiManager: window.experimentUIManager,
        hubManager: window.experimentHubManager,
        flowManager: window.experimentFlowManager,
      });
      await instance.initialize();
      window.experimentSystemManager = instance;

      Logger.debug("所有管理器已初始化");
    } catch (error) {
      Logger.error("初始化模組失敗:", error);
      throw error;
    }
  }

  /**
   * 初始化其餘組件（在管理器初始化之後）
   */
  initializeRemainingComponents() {
    try {
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

      // 匯出管理器
      this.exportManager = new BoardExportManager(this);

      // UI 管理器 - 使用全域實例
      this.uiManager = window.experimentUIManager;

      // 初始化 Board UI 管理器
      this.boardUIManager = new BoardUIManager(this);
      this.boardUIManager.init();

      // 開始初始化其他組件
      this.init();
    } catch (error) {
      Logger.error("初始化其餘組件失敗:", error);
      // 即使失敗也嘗試繼續基本功能
      this.init();
    }
  }

  /**
   * 使用統一的 UI 管理器渲染所有界面組件
   */

  generateSessionId() {
    return RandomUtils.generateExperimentId();
  }

  /**
   * 產生新的實驗ID
   */
  generateExperimentId() {
    const result = RandomUtils.generateExperimentId();

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.value = result;
    }

    // 廣播新的實驗ID到同步工作階段
    window.experimentSyncManager.broadcastExperimentIdUpdate(result);

    Logger.info(`新的實驗ID已產生: ${result}`);
    return result;
  }

  /**
   * 產生新的實驗ID 並在同步模式下註冊到中樞
   */
  async generateExperimentIdWithHub() {
    try {
      Logger.debug("產生新的實驗ID...");

      // 產生新的實驗ID
      const newId = RandomUtils.generateExperimentId();

      // 更新UI
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) {
        experimentIdInput.value = newId;
      }

      // 檢查是否在同步模式
      const hubManager = getExperimentHubManager();
      if (hubManager?.isInSyncMode?.()) {
        Logger.debug(`同步模式: 註冊新ID到中樞: ${newId}`);
        await window.experimentSyncManager.registerExperimentIdToHub(newId);
      } else {
        Logger.debug(`獨立模式: 新ID僅存本機: ${newId}`);
      }

      // 廣播新的實驗ID
      window.experimentSyncManager.broadcastExperimentIdUpdate(newId);

      Logger.info(`新的實驗ID已產生: ${newId}`);
      return newId;
    } catch (error) {
      Logger.error("產生新實驗ID失敗:", error);
      throw error;
    }
  }

  /** 智慧重新產生實驗ID - 檢查中樞同步狀態 */
  async smartRegenerateExperimentId() {
    const hubManager = getExperimentHubManager();

    // 檢查是否在同步模式
    if (!hubManager?.isInSyncMode?.()) {
      Logger.debug("直接產生新的實驗ID");
      await this.generateExperimentIdWithHub();
      this.selectDefaultCombination();
      return;
    }

    try {
      // 取得中樞的實驗ID
      const hubExperimentId = await hubManager.getExperimentId();
      const currentExperimentId = document
        .getElementById("experimentIdInput")
        ?.value?.trim();

      Logger.debug(
        `中樞ID: ${hubExperimentId}, 本機ID: ${currentExperimentId}`,
      );

      if (
        hubExperimentId &&
        currentExperimentId &&
        hubExperimentId !== currentExperimentId
      ) {
        // 實驗ID與中樞不同，同步到中樞的ID
        Logger.info(`實驗ID與中樞不同，同步到中樞ID: ${hubExperimentId}`);
        this.experimentId = hubExperimentId;
        const experimentIdInput = document.getElementById("experimentIdInput");
        if (experimentIdInput) {
          experimentIdInput.value = hubExperimentId;
        }

        // 更新日誌管理器
        if (window.experimentLogManager) {
          window.experimentLogManager.setExperimentId(hubExperimentId);
        }

        // 廣播同步
        window.experimentSyncManager.broadcastExperimentIdUpdate(
          hubExperimentId,
        );
      } else {
        // 實驗ID與中樞相同或中樞沒有ID，產生新的ID
        Logger.info("產生新的實驗ID並廣播");
        await this.generateExperimentIdWithHub();
      }

      this.selectDefaultCombination();
    } catch (error) {
      Logger.error("檢查中樞狀態失敗:", error);
      // 出錯時仍產生新的ID
      await this.generateExperimentIdWithHub();
      this.selectDefaultCombination();
    }
  }

  /**
   * 初始化實驗頁面管理器
   */
  async init() {
    await this.loadScenarioData();
    // 渲染統一UI
    if (this.boardUIManager) {
      await this.boardUIManager.renderUnifiedUI();
      this.boardUIManager.renderGestureTypesReference();
    } else {
      Logger.warn("BoardUIManager 不可用，跳過UI渲染");
    }

    // 初始化實驗ID
    const experimentIdInput = document.getElementById("experimentIdInput");
    const regenerateIdBtn = document.getElementById("regenerateIdButton");

    if (!experimentIdInput) {
      Logger.error("找不到 experimentIdInput 元素，無法初始化實驗ID");
      return;
    }

    Logger.debug("初始化實驗ID...");

    let experimentId = null;

    // 第1步：檢查是否在同步模式，優先從中樞取得
    const hubManager = window.experimentHubManager;
    const isInSyncMode = hubManager?.isInSyncMode?.() || false;

    if (isInSyncMode) {
      Logger.debug("第1優先：檢測到同步模式，嘗試從中樞讀取ID");
      try {
        experimentId = await hubManager.getExperimentId();
        if (experimentId) {
          Logger.debug(`從中樞取得實驗ID: ${experimentId}`);
          experimentIdInput.value = experimentId;
        }
      } catch (error) {
        Logger.debug(`中樞讀取失敗: ${error.message}，嘗試其他來源`);
      }
    }

    // 第2步：如果中樞沒取到，檢查快照ID
    if (!experimentId && window.experimentStateManager?.experimentId) {
      experimentId = window.experimentStateManager.experimentId;
      Logger.debug(`第2優先：使用快照ID: ${experimentId}`);
      experimentIdInput.value = experimentId;
    }

    // 第3步：如果還沒有，檢查輸入框是否已有值
    if (!experimentId) {
      const inputValue = experimentIdInput.value.trim();
      if (inputValue) {
        experimentId = inputValue;
        Logger.debug(`第3優先：使用輸入框ID: ${experimentId}`);
      }
    }

    // 第4步：都沒有ID，根據模式決定是否產生新ID
    if (!experimentId) {
      if (isInSyncMode) {
        Logger.debug("第4步：同步模式無ID，產生新ID");
        const newId = await this.generateExperimentIdWithHub();
        Logger.debug(`已產生新的實驗ID: ${newId}`);
      } else {
        Logger.debug("第4步：本機模式無ID，產生新ID");
        const newId = this.generateExperimentId();
        Logger.debug(`已產生新的實驗ID: ${newId}`);
      }
    }

    // 選擇預設組合
    this.selectDefaultCombination();

    // 綁定實驗ID輸入框事件
    experimentIdInput.addEventListener("change", async () => {
      if (!experimentIdInput.value.trim()) {
        await this.generateExperimentIdWithHub();
        return;
      }

      const newExperimentId = experimentIdInput.value.trim();
      Logger.debug(`使用者手動輸入實驗ID: ${newExperimentId}`);

      // 只在同步模式下註冊到中樞
      const hubManager = getExperimentHubManager();
      if (hubManager?.isInSyncMode?.()) {
        Logger.debug("註冊手動輸入的實驗ID到中樞");
        await window.experimentSyncManager.registerExperimentIdToHub(
          newExperimentId,
        );
      } else {
        Logger.debug("實驗ID僅存本機");
      }

      if (this.currentCombination) {
        const combination =
          this.scriptData.combinations[
            this.scriptData.combinations.findIndex(
              (c) => c.combinationId === this.currentCombination.combinationId,
            )
          ];
        await this.loadScriptForCombination(combination, newExperimentId);
      }

      window.experimentSyncManager.broadcastExperimentIdUpdate(newExperimentId);
    });

    // 綁定重新產生按鈕事件
    if (regenerateIdBtn) {
      regenerateIdBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.smartRegenerateExperimentId();
      });
    }

    // 綁定受試者名稱變更事件
    this.setupSubjectNameListener();

    // 監聽遠端實驗狀態變化
    this.setupRemoteEventListeners();
  }

  async loadScenarioData() {
    try {
      // 確保 loadUnitsFromScenarios 已經被定義
      if (typeof window.loadUnitsFromScenarios === "undefined") {
        // 等待 data-loader.js 完成加載
        let attempts = 0;
        while (
          typeof window.loadUnitsFromScenarios === "undefined" &&
          attempts < 100
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          attempts++;
        }

        if (typeof window.loadUnitsFromScenarios === "undefined") {
          throw new Error("loadUnitsFromScenarios 未能成功定義");
        }
      }

      // 使用資料轉換器載入完整的 units 和 actions 資料
      const convertedData = await loadUnitsFromScenarios();

      this.scenariosData = await fetch("data/scenarios.json").then((r) =>
        r.json(),
      );

      // 載入手勢多語言資料
      this.gesturesData = await fetch("data/gestures.json").then((r) =>
        r.json(),
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

  /**
   * 選擇預設組合並載入手勢序列
   * 優先順序：本機快取 > 設定預設 > 第一個
   */
  selectDefaultCombination() {
    if (!this.scriptData || !this.scriptData.combinations) return;

    let selectedIndex = 0;

    // 優先檢查本機快取
    const cachedCombinationId = localStorage.getItem(
      "last_selected_combination_id",
    );
    if (cachedCombinationId) {
      const cachedIndex = this.scriptData.combinations.findIndex(
        (c) => c.combinationId === cachedCombinationId,
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
          (c) => c.combinationId === defaultCombinationId,
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
      combination.combinationId,
    );

    // 更新 UI 顯示選中狀態
    this.updateCombinationSelection(index);

    // 更新單元列表以匹配組合要求
    this.updateUnitListForCombination(combination);

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
    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
    if (!unitList) {
      this._warn("找不到單元列表容器");
      return;
    }

    // 取得該組合包含的單元ID，並按正確順序排列
    // 使用統一的 RandomUtils 處理組合邏輯
    const experimentId =
      document.getElementById("experimentIdInput").value.trim() || "default";
    const combinationUnitIds = RandomUtils.getCombinationUnitIds(
      combination,
      experimentId,
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
      unitList.querySelectorAll("li:not(.power-option-card)"),
    );
    const startupCard = unitList.querySelector(".startup-card");
    const shutdownCard = unitList.querySelector(".shutdown-card");

    // 按照 combinationUnitIds 的順序重新排列
    combinationUnitIds.forEach((unitId) => {
      const li = normalItems.find((item) => item.dataset.unitId === unitId);
      if (li) {
        // 移到最後但在電源選項卡片之前
        if (shutdownCard && shutdownCard.parentNode === unitList) {
          // 確保 shutdownCard 是 unitList 的子節點
          unitList.insertBefore(li, shutdownCard);
        } else if (startupCard && startupCard.parentNode === unitList) {
          // 如果沒有 shutdownCard，使用 startupCard
          unitList.insertBefore(li, startupCard);
        } else {
          // 如果都沒有電源選項卡片，添加到列表末尾
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
        experimentId = this.generateExperimentId();
      }

      // 建立組合內容
      const script = {
        combination_id: combination.combinationId,
        combination_name: combination.combinationName,
        description: combination.description,
        experiment_id: experimentId,
        units_sequence: [],
        gestures: [],
      };

      // 建立單元序列
      const unitIds = RandomUtils.getCombinationUnitIds(
        combination,
        experimentId,
      );

      const confirmGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "confirm",
      );
      const nextGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "next",
      );
      const prevGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "prev",
      );
      const openGesture = this.scenariosData.gesture_list.find(
        (g) => g.gesture_id === "open",
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
            (u) => u.unit_id === firstUnitId,
          );
          const firstUnitIndexInJson = section.units.findIndex(
            (u) => u.unit_id === firstUnitId,
          );

          if (firstUnitIndexInJson > 0 && nextGesture) {
            script.gestures.push({
              step: script.gestures.length + 1,
              gesture: "next",
              name: nextGesture.gesture_name,
              description: nextGesture.gesture_description,
              reason: `[num6] x${firstUnitIndexInJson} | 導航至「${firstUnit.unit_name}」 | 列表 -> ${firstUnitId}`,
              step_id: "FIRST_UNIT_NAV",
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
              (g) => g.gesture_id === "reload",
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
                (g) => g.gesture_id === gestureId,
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
              (u) => u.unit_id === nextUnitId,
            );

            // 第一個單元結束後加入放大手勢
            if (unitIdx === 0) {
              const zoomInG = this.scenariosData.gesture_list.find(
                (g) => g.gesture_id === "zoom_in",
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
                step_name: "回傳單元列表",
                actions: [],
              });
            }

            // 列表導航
            const currentIdxInJson = section.units.findIndex(
              (u) => u.unit_id === unitId,
            );
            const nextIdxInJson = section.units.findIndex(
              (u) => u.unit_id === nextUnitId,
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
                  dist,
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
          (g) => g.gesture_id === "zoom_out",
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
          (g) => g.gesture_id === "capture",
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
          (g) => g.gesture_id === "close",
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
          '<span style="color: #ff9800; font-weight: 700;">$1</span>',
        )
        .replace(
          /\[red\](.*?)\[\/red\]/g,
          '<span style="color: #f44336; font-weight: 700;">$1</span>',
        )
        .replace(
          /\[green\](.*?)\[\/green\]/g,
          '<span style="color: #4caf50; font-weight: 700;">$1</span>',
        )
        .replace(
          /\[blue\](.*?)\[\/blue\]/g,
          '<span style="color: #2196f3; font-weight: 700;">$1</span>',
        );
    };

    let html = '<div class="right-section"><h2>實驗手勢序列</h2>';
    if (script.gestures) {
      html +=
        '<div style="display: grid; grid-template-columns: 1fr; gap: 12px;">';

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
                                      gestureName_en
                                        ? ` | ${gestureName_en}`
                                        : ""
                                    }</div>
                                    <div style="font-size: 11px; color: #555; margin-top: 2px; word-break: break-word;">${convertColorTags(
                                      gesture.description,
                                    )}</div>
                                </div>
                            </div>
                        </div>

                        <!-- 手勢反應按鈕區域 -->
                        <div style="margin-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                            <button onclick="window.markGesture(${idx}, 'correct', '${
                              gesture.name
                            }')" class="gesture-action-btn correct">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <circle cx="12" cy="12" r="8.5" />
                                </svg>
                            </button>
                            <button onclick="window.markGesture(${idx}, 'uncertain', '${
                              gesture.name
                            }')" class="gesture-action-btn uncertain">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12,4.5 20.5,19.5 3.5,19.5" />
                                </svg>
                            </button>
                            <button onclick="window.markGesture(${idx}, 'incorrect', '${
                              gesture.name
                            }')" class="gesture-action-btn incorrect">
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
                            <div class="gesture-info-section step-info">
                                <div class="section-label">對應步驟</div>
                                <div class="section-content">${convertColorTags(
                                  gesture.reason,
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
                            <div class="gesture-info-section action-info">
                                <!-- 上排：步驟說明 -->
                                ${
                                  gesture.step_name
                                    ? `
                                    <div class="gesture-step-card">
                                        <div class="step-id">${
                                          gesture.step_id || "N/A"
                                        }</div>
                                        <div class="step-name">${convertColorTags(
                                          gesture.step_name,
                                        )}</div>
                                    </div>
                                `
                                    : ""
                                }

                                <!-- 下排：操作步驟 -->
                                ${
                                  gesture.actions && gesture.actions.length > 0
                                    ? `
                                    <div class="gesture-actions-container">
                                        ${gesture.actions
                                          .map(
                                            (action, actionIdx) => `
                                            <button
                                              class="action-button gesture-action-button"
                                              data-action-id="${
                                                action.action_id
                                              }"
                                              data-gesture-index="${idx}"
                                              data-completed="false"
                                              onclick="window.handleActionClick(this, '${
                                                action.action_id
                                              }', ${idx})">
                                                <div class="action-id">${
                                                  action.action_id
                                                }</div>
                                                <div class="action-name">${convertColorTags(
                                                  action.action_name,
                                                )}</div>
                                            </button>
                                        `,
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
                        }')" class="gesture-next-button">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="9,18 15,12 9,6" />
                            </svg>
                        </button>
                    </div>
                `;
      });
      html += "</div></div>";
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
      if (statsPanel.classList.contains("is-hidden"))
        statsPanel.classList.remove("is-hidden");

      // 更新手勢步驟數量
      document.getElementById("statGestureCount").textContent =
        `${script.gestures.length} 步`;

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
      if (!statsPanel.classList.contains("is-hidden"))
        statsPanel.classList.add("is-hidden");
    }
  }

  renderGestureCountList() {
    const listContainer = document.getElementById("gestureCountList");
    if (!listContainer) return;

    let html = "";
    const sortedGestures = Object.entries(this.gestureStats).sort(
      (a, b) => b[1].planned - a[1].planned,
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
                                <div style="font-size: 10px; color: #4caf50; margin-bottom: 2px;">正確</div>
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

  // ========== 動作序列實驗流程管理 ==========

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
        experimentId,
      );
      // 初始化 Action 序列，實驗ID: experimentId, 單元序列: unitIds

      // 使用資料轉換器建立 action 序列
      this.currentActionSequence = buildActionSequenceFromUnits(
        unitIds,
        this.actionsMap,
        this.scriptData.units,
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
        },
      );
    }

    // 通知多螢幕同步
    if (window.syncManager) {
      const stepInfo = this.actionToStepMap.get(actionId);
      window.syncManager.core.syncState({
        type: "action_completed",
        client_id: window.syncManager?.clientId || "experiment_panel",
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
        (this.completedActions.size / this.currentActionSequence.length) * 100,
      ),
    };
  }

  /**
   * 此方法已廢棄 - 單元列表渲染已整合到 renderUnifiedUI 中
   * @deprecated 使用 renderUnifiedUI 代替
   */
  async renderUnitList() {
    Logger.warn("renderUnitList() 已廢棄，請使用 renderUnifiedUI() 代替");
  }

  handleUnitReorder(arg1, arg2) {
    // 支援兩種呼叫格式： (fromIndex, toIndex) 或 ({ unitId, direction: 'up'|'down' })
    Logger.debug("handleUnitReorder called", { arg1, arg2 });
    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
    if (!unitList) return;

    const items = Array.from(unitList.querySelectorAll("li[data-unit-id]"));

    // Numeric indices
    if (typeof arg1 === "number" && typeof arg2 === "number") {
      const fromIndex = arg1;
      const toIndex = arg2;
      if (
        fromIndex < 0 ||
        fromIndex >= items.length ||
        toIndex < 0 ||
        toIndex >= items.length
      ) {
        return;
      }
      const itemToMove = items[fromIndex];
      if (!itemToMove || !itemToMove.parentNode) return;
      if (fromIndex < toIndex) {
        itemToMove.parentNode.insertBefore(
          itemToMove,
          items[toIndex].nextSibling,
        );
      } else {
        itemToMove.parentNode.insertBefore(itemToMove, items[toIndex]);
      }
      // 更新按鈕狀態與選取
      if (typeof this.updateUnitButtonStates === "function")
        this.updateUnitButtonStates();
      this.onUnitSelectionChanged();
      return;
    }

    // Object format { unitId, newIndex } or { unitId, direction }
    if (arg1 && typeof arg1 === "object") {
      const { unitId, direction, newIndex } = arg1;
      if (!unitId) return;

      const currentIndex = items.findIndex(
        (it) => it.dataset.unitId === unitId,
      );
      if (currentIndex === -1) return;

      // newIndex or direction provided: UI 已處理 DOM 移動，這裡只更新狀態與選取（避免重複操作 DOM）
      Logger.debug(
        "handleUnitReorder: object-format received, syncing states",
        { unitId, direction, newIndex },
      );
      if (typeof this.updateUnitButtonStates === "function")
        this.updateUnitButtonStates();
      this.onUnitSelectionChanged();
      return;

      return;
    }

    Logger.warn("handleUnitReorder: unsupported arguments", arg1, arg2);
  }

  moveUnit(li, direction) {
    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
    if (!unitList) return;

    const allItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)"),
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

  /**
   * 更新全選複選框的狀態
   */
  updateSelectAllState() {
    const selectAllCheckbox = document.querySelector("#selectAllUnits");
    if (!selectAllCheckbox) return;

    const unitList = document.querySelector("#experimentUnitsList");
    if (!unitList) return;

    const checkboxes = Array.from(
      unitList.querySelectorAll('input[name="unitCheckbox"]'),
    );
    const checkedCount = checkboxes.filter((cb) => cb.checked).length;

    selectAllCheckbox.checked = checkedCount === checkboxes.length;
    selectAllCheckbox.indeterminate =
      checkedCount > 0 && checkedCount < checkboxes.length;
  }

  updateUnitButtonStates() {
    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
    if (!unitList) return;

    const allItems = Array.from(
      unitList.querySelectorAll("li:not(.power-option-card)"),
    );

    Logger.debug("updateUnitButtonStates: itemCount", {
      count: allItems.length,
    });

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
    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
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
      // 建立一個自定義組合
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
      '.unit-checkbox input[type="checkbox"]:checked',
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
    let subjectName = document.getElementById("subjectName").value.trim();

    // 如果受試者名稱為空，自動產生「受試者_實驗ID」
    if (!subjectName) {
      subjectName = `受試者_${experimentId}`;
      const subjectNameInput = document.getElementById("subjectName");
      if (subjectNameInput) {
        // 更新輸入框，確保輸入欄等於實際使用的值
        subjectNameInput.value = subjectName;
      }
      Logger.debug(`自動產生受試者名稱: ${subjectName}`);
    }

    const experimentData = {
      experiment_id: experimentId,
      subject_name: subjectName,
      combination_id: this.currentCombination.combinationId,
      combination_name: this.currentCombination.combinationName,
      unit_count: validUnits.length,
      gesture_count: this.currentCombination.gestures.length,
      start_time: new Date().toISOString(),
    };

    // 初始化日誌管理器
    if (window.experimentLogManager) {
      window.experimentLogManager.initialize(experimentId, subjectName);
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
      }),
    );

    this.toggleExperimentUI(true); // 鎖定 UI

    // 註冊實驗狀態到中樞
    window.experimentSyncManager.registerExperimentStateToHub({
      experiment_id: experimentData.experiment_id,
      subject_name: experimentData.subject_name,
      combination_name: experimentData.combination_name,
      combination_id: experimentData.combination_id,
      gesture_count: experimentData.gesture_count,
      is_running: true,
    });

    // 啟動計時器 - 委派給 experiment-timer.js
    if (window.experimentTimerManager) {
      window.experimentTimerManager.startExperimentTimer();
    }

    // 初始化受試者名稱狀態
    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput) {
      this.subjectName = subjectNameInput.value.trim();
      this.lastSavedSubjectName = this.subjectName;
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

    if (this.pendingCombinationUpdate) {
      // 套用等待中的組合更新
      const { currentCombination, loadedUnits } = this.pendingCombinationUpdate;
      this.currentCombination = currentCombination;
      if (loadedUnits) {
        this.loadedUnits = loadedUnits;
      }
      Logger.info(
        `套用等待中的組合更新: ${currentCombination?.combinationName || "未知組合"}`,
      );
      this.pendingCombinationUpdate = null;
    }

    // 分發事件供同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_stopped", {
        detail: {
          experimentId:
            document.getElementById("experimentIdInput")?.value || "",
          subjectName: document.getElementById("subjectName")?.value || "",
          combinationName: this.currentCombination?.combinationName || "",
        },
      }),
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
        if (logDownloadBtns.classList.contains("is-hidden"))
          logDownloadBtns.classList.remove("is-hidden");
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

    // 停止計時器 - 委派給 experiment-timer.js
    if (window.experimentTimerManager) {
      window.experimentTimerManager.stopExperimentTimer();
    }

    // 解鎖 UI
    this.toggleExperimentUI(false);

    //廣播實驗停止狀態到其他連線裝置（僅人為停止時廣播）
    if (isManualStop) {
      window.experimentSyncManager.broadcastExperimentStop();
    } else {
      // 自動停止時，產生新的實驗ID（會自動廣播到同步工作階段）
      const newId = this.generateExperimentId();

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

    const pauseBtn = document.getElementById("pauseExperimentBtn");
    const isPaused = window.experimentTimerManager?.experimentPaused ?? false;
    const newPausedState = !isPaused;

    // 更新按鈕文本
    if (pauseBtn) {
      pauseBtn.textContent = newPausedState ? "▶ 繼續" : "⏸ 暫停";
    }

    if (newPausedState) {
      // 暫停實驗 - 委派給 experiment-timer.js
      if (window.experimentTimerManager) {
        window.experimentTimerManager.pauseExperimentTimer();
      }
      if (window.logger) {
        window.logger.logExperimentPause();
      }
      // 分發暫停事件
      document.dispatchEvent(
        new CustomEvent("experiment_paused", {
          detail: { isPaused: true },
        }),
      );
      //廣播暫停狀態到其他連線裝置
      window.experimentSyncManager.broadcastExperimentPauseState(true);
    } else {
      // 繼續實驗 - 委派給 experiment-timer.js
      if (window.experimentTimerManager) {
        window.experimentTimerManager.resumeExperimentTimer();
      }
      if (window.logger) {
        window.logger.logExperimentResume();
      }
      // 分發還原事件
      document.dispatchEvent(
        new CustomEvent("experiment_resumed", {
          detail: { isPaused: false },
        }),
      );
      //廣播還原狀態到其他連線裝置
      window.experimentSyncManager.broadcastExperimentPauseState(false);
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
    if (subjectNameInput) subjectNameInput.disabled = locked;

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
      "experimentControlButtons",
    );

    if (experimentIdRow) {
      experimentIdRow.classList.toggle("is-hidden", locked);
    }
    if (experimentControlButtons) {
      experimentControlButtons.classList.toggle("is-hidden", !locked);
    }

    // 實驗中時隱藏計時器按鈕顯示區
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer && locked) {
      if (experimentTimer.classList.contains("is-hidden"))
        experimentTimer.classList.remove("is-hidden");
    }
  }

  /** 設定受試者名稱監聽器 */
  setupSubjectNameListener() {
    const subjectNameInput = document.getElementById("subjectName");

    if (!subjectNameInput) return;

    // 初始化受試者名稱
    this.subjectName = subjectNameInput.value.trim();
    this.lastSavedSubjectName = this.subjectName;

    // 監聽輸入框變更並自動儲存
    subjectNameInput.addEventListener("input", (e) => {
      const newValue = e.target.value.trim();

      // 如果內容改變，立即更新內部狀態
      if (newValue !== this.lastSavedSubjectName) {
        this.subjectName = newValue;
        this.lastSavedSubjectName = newValue;

        // 如果在同步模式下，廣播變更
        this.broadcastSubjectNameChange(newValue);

        // 記錄日誌
        this.logAction("subject_name_updated", {
          subject_name: newValue,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // 監聽 Enter 鍵（可選，用於更好的使用者體驗）
    subjectNameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Enter 鍵可以觸發其他操作，如果需要的話
      }
    });
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
        case "experimentIdUpdate":
          this.handleRemoteExperimentIdUpdate(data);
          break;
        case "subjectNameUpdate":
          // 受試者名稱更新已由本機處理，此為同步管理器通知
          // 無需在此重複處理
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
          client_id: state.client_id,
          timestamp: state.timestamp,
        });
      }
      //處理面板的暫停訊號
      else if (state.type === "experiment_paused" && state.source === "panel") {
        // 接收到機台面板的暫停訊號
        const isPaused =
          window.experimentTimerManager?.experimentPaused ?? false;
        if (!isPaused) {
          this.togglePauseExperiment();
        }
      }
      //處理面板的還原訊號
      else if (
        state.type === "experiment_resumed" &&
        state.source === "panel"
      ) {
        // 接收到機台面板的還原訊號
        const isPaused =
          window.experimentTimerManager?.experimentPaused ?? false;
        if (isPaused) {
          this.togglePauseExperiment();
        }
      }
      //處理面板的停止訊號
      else if (
        state.type === "experiment_stopped" &&
        state.source === "panel"
      ) {
        // 接收到機台面板的停止訊號
        const isPaused =
          window.experimentTimerManager?.experimentPaused ?? false;
        if (this.experimentRunning || isPaused) {
          //響應遠端停止訊號時不廣播（false = 不廣播）
          this.stopExperiment(false);
        }
      }
      // 處理實驗ID更新
      else if (state.type === "experimentIdUpdate") {
        this.handleRemoteExperimentIdUpdate(state);
      }
      // 處理受試者名稱更新
      else if (state.type === "subjectNameUpdate") {
        this.handleRemoteSubjectNameUpdate(state);
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
      const { experimentId, client_id } = event.detail;
      const hubManager = getExperimentHubManager();

      // 避免自己廣播的回音
      if (client_id === hubManager.getClientId()) {
        return;
      }

      Logger.debug(`收到遠程實驗ID廣播: ${experimentId}`);

      // 更新本機UI
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput && experimentIdInput.value !== experimentId) {
        experimentIdInput.value = experimentId;
        Logger.info(`已同步實驗ID到UI: ${experimentId}`);
      }
    });

    // 監聽組合選擇事件
    document.addEventListener("combination:selected", (event) => {
      const { combination, unitIds } = event.detail;
      if (combination) {
        // 更新目前組合
        this.currentCombination = combination;

        // 更新單元列表以匹配組合要求
        this.updateUnitListForCombination(combination);

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
    const { action_id, source, client_id, timestamp } = syncData;

    // 接收遠端 action 完成

    // 記錄到日誌
    this.logAction("remote_action_completed", {
      action_id: action_id,
      source: source,
      client_id: client_id,
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
          (s) => s.step_id === stepInfo.step_id,
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
   * 面板按鈕動作已統一使用 button_action 事件處理
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
      remote_client_id,
      clientId,
      timestamp,
    } = data;

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value || "";
    const expId = experiment_id || experimentId;
    const btn = button || button_id;
    const func = buttonFunction || button_function;
    const deviceInfo = remote_client_id || clientId;
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
        timestamp,
      );
    }
  }

  /** 處理遠端實驗初始化 */
  handleRemoteExperimentInit(data) {
    const { experimentId, currentCombination, subjectName, loadedUnits } = data;

    // 設置實驗ID
    if (experimentId) {
      this.experimentId = experimentId;
      Logger.info(`從機台面板同步的實驗ID: ${experimentId}`);

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

    // 處理組合變更
    if (currentCombination) {
      // 如果目前實驗正在進行中，等待實驗結束後再同步新的組合
      if (this.experimentRunning) {
        Logger.debug("實驗進行中，將組合更新請求加入佇列");
        // 將更新請求加入佇列，等待實驗結束
        this.pendingCombinationUpdate = { currentCombination, loadedUnits };
        return;
      }

      // 實驗未進行中，直接套用組合
      this.currentCombination = currentCombination;
      if (loadedUnits) {
        this.loadedUnits = loadedUnits;
      }
    }

    //接收到機台面板的實驗開始訊號，立即自動開始實驗
    if (!this.experimentRunning) {
      // 確保有必要的設定
      if (currentCombination && !this.pendingCombinationUpdate) {
        this.currentCombination = currentCombination;
      }
      if (loadedUnits && !this.pendingCombinationUpdate) {
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
      // 將更新請求加入佇列，等待實驗結束
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
      // 將更新請求加入佇列，等待實驗結束
      this.pendingExperimentIdUpdate = data;
      Logger.debug(
        `實驗進行中，等待實驗結束後套用ID更新: ${data.experimentId}`,
      );
      return;
    }

    const { experimentId } = data;
    Logger.debug(`套用遠端實驗ID更新: ${experimentId}`);

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput && experimentIdInput.value.trim() !== experimentId) {
      experimentIdInput.value = experimentId;
      this.experimentId = experimentId;

      // 更新狀態管理器並觸發儲存
      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(
          experimentId,
          "sync_update",
        );
      }

      Logger.info(`實驗ID已同步並儲存: ${experimentId}`);
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
      card.className = "gesture-card";
      card.setAttribute("data-gesture-index", index);

      // 從手勢對象直接取得名稱 (loadScriptForCombination 已經設置了)
      const gestureName = gestureObj.name || gestureObj.gesture || "未知手勢";

      const title = document.createElement("div");
      title.className = "gesture-card-title";
      title.textContent = gestureName;

      const desc = document.createElement("div");
      desc.className = "gesture-card-desc";
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
      const currentAction = window.experimentActionHandler?.getCurrentAction();
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
            true, // isRemote = true，表示來自遠端
          );
        }

        // 新增高亮效果（視覺回饋）
        card.classList.add("remote-action-completed");

        // 2秒後移除高亮（保留綠色完成狀態）
        setTimeout(() => {
          card.classList.remove("remote-action-completed");
        }, 2000);
      }
    });

    if (!highlightedCard) {
      Logger.warn(`找不到對應的卡片 (action_id: ${targetActionId})`);
    }
  }

  highlightMatchingAction(currentGesture, buttonData, remoteClientId = null) {
    const buttonName = buttonData.button || "";
    let matchedActionId = null;

    if (currentGesture.actions && currentGesture.actions.length > 0) {
      matchedActionId = currentGesture.actions.find(
        (action) =>
          action.action_name.includes(buttonName) ||
          action.action_id.includes(buttonName),
      )?.action_id;

      if (!matchedActionId) {
        return;
      }
      const matchedCard = document.querySelector(
        `.action-button[data-action-id="${matchedActionId}"]`,
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
            remoteClientId,
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

    // 如果受試者名稱為空，不進行同步（避免 null 污染）
    if (!subjectName || !subjectName.trim()) {
      Logger.debug("受試者名稱為空，跳過同步");
      return;
    }

    const updateData = {
      type: "subjectNameUpdate",
      client_id: window.syncManager?.clientId || "experiment_panel",
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      subjectName: subjectName.trim(),
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
      }),
    );
  }

  /** 註冊實驗狀態到中樞 */

  /** 處理遠端實驗開始 */
  handleRemoteExperimentStarted(detail) {
    // 如果本機已在進行實驗，忽略
    if (this.experimentRunning) {
      return;
    }

    // 記錄日誌
    this.logAction("remote_experiment_started_received", {
      remote_client_id: detail.remote_client_id,
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
        "unitCombinationSelect",
      );
      if (combinationSelect) {
        combinationSelect.value = detail.combination_id;
        // 觸發組合變更事件以重新載入手勢序列
        combinationSelect.dispatchEvent(new Event("change"));
      }
    }

    // 記錄同步完成
    this.logAction("remote_experiment_started", {
      remote_client_id: detail.remote_client_id,
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
    const isPaused = window.experimentTimerManager?.experimentPaused ?? false;
    if (isPaused) {
      return;
    }

    // 同步暫停狀態 - 委派給 experiment-timer.js
    if (window.experimentTimerManager) {
      window.experimentTimerManager.pauseExperimentTimer();
    }

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "▶ 繼續";
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("遠端暫停實驗", null, null, false, false);
    }

    this.logAction("remote_experiment_paused", {
      remote_client_id: detail.remote_client_id,
    });
  }

  /** 處理遠端實驗還原 */
  handleRemoteExperimentResumed(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 如果未暫停，忽略
    const isPaused = window.experimentTimerManager?.experimentPaused ?? false;
    if (!isPaused) {
      return;
    }

    // 同步還原狀態 - 委派給 experiment-timer.js
    if (window.experimentTimerManager) {
      window.experimentTimerManager.resumeExperimentTimer();
    }

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction("遠端繼續實驗", null, null, false, false);
    }

    this.logAction("remote_experiment_resumed", {
      remote_client_id: detail.remote_client_id,
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
      remote_client_id: detail.remote_client_id,
    });

    //響應遠端停止訊號時不廣播（false = 不廣播）
    this.stopExperiment(false);

    // 記錄停止完成
    this.logAction("remote_experiment_stopped_completed", {
      remote_client_id: detail.remote_client_id,
    });
  }

  logAction(action, data) {
    const _logEntry = {
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
window.boardPageManager = new BoardPageManager();

// 為實驗頁面提供相容性
globalThis.app = window.boardPageManager;
const _app = globalThis.app; // 為了向後相容

// 暴露工具函式到全域作用域供 HTML 使用
window.toggleTimer = window.toggleTimer;
window.formatDuration = window.formatDuration;
window.resetTimer = window.resetTimer;
window.timerLongPressStart = window.timerLongPressStart;
window.timerLongPressEnd = window.timerLongPressEnd;

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
    buttonElement.getAttribute("data-last-click") || "0",
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
  isRemote = false,
) {
  // 取得裝置 ID
  let clientId = null;
  if (window.syncClient) {
    clientId = window.syncClient.clientId;
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
      clientId,
    );
  }

  // 如果是本機操作（非遠端同步），則廣播到其他裝置
  if (!isRemote && window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: "action_completed",
        action_id: actionId,
        gesture_index: gestureIndex,
        client_id: clientId,
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
  gestureIndex,
) {
  // 取得裝置 ID
  let clientId = null;
  if (window.syncClient) {
    clientId = window.syncClient.clientId;
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
      clientId,
    );
  }

  // 廣播取消狀態到其他裝置
  if (window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: "action_cancelled",
        action_id: actionId,
        gesture_index: gestureIndex,
        client_id: clientId,
        timestamp: new Date().toISOString(),
      })
      .catch((error) => {
        Logger.warn("同步動作取消狀態失敗:", error);
      });
  }
};
