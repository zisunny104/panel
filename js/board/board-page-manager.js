/**
 * BoardPageManager - 實驗頁面管理器
 *
 * 專門用於 board.html 頁面，負責載入所有必要的腳本、
 * 初始化各個管理器模組，並協調頁面各元件間的互動。
 */

import {
  loadScenariosData,
  loadUnitsFromScenarios,
  buildActionSequenceFromUnits,
} from "../core/data-loader.js";
import {
  ACTION_IDS,
  ACTION_BUTTONS,
  LOG_SOURCES,
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import { experimentSyncManager } from "./board-sync-manager.js";
import { ExperimentCombinationManager } from "../experiment/experiment-combination-manager.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";
import { ExperimentTimerManager } from "../experiment/experiment-timer.js";
import ExperimentUIManager from "../experiment/experiment-ui-manager.js";
import {
  initExperimentFlowManager,
  initExperimentUIManager,
} from "../experiment/experiment-init-utils.js";
import { ExperimentStateManager } from "../experiment/experiment-state-manager.js";
import { ExperimentSystemManager } from "../experiment/experiment-system-manager.js";
import { ExperimentHubManager } from "../experiment/experiment-hub-manager.js";
import { ExperimentSyncCore } from "../sync/experiment-sync-manager.js";
import { createBoardGestureUtils } from "./board-gesture-utils.js";
import { ExperimentLogManager } from "./board-log-manager.js";
import { experimentLogUI } from "./board-log-ui.js";
import { BoardUIManager } from "./board-ui-manager.js";
import { ConfigManager, getSharedConfig } from "../core/config.js";
import { generateExperimentId } from "../core/random-utils.js";
import { SyncManager } from "../sync/sync-manager.js";

class BoardPageManager {
  constructor() {
    this.initStages = {
      SCRIPTS_LOADING: "scripts_loading",
      MODULES_INIT: "modules_init",
      COMPONENTS_INIT: "components_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;
    this._listenersSetup = false; // 防止事件監聽器重複設定
    this._gestureHandlersBound = false;
    this._contentAreaListeners = null;
    this._exportGestureBound = false;

    this.timerManager = null;
    this.gestureUtils = null;
    this.syncManager = null;
    this.experimentLogManager = null;
    this.experimentStateManager = null;

    this.config = {
      autoStopCooldownMs:
        getSharedConfig()?.experiment?.autoStopCooldownMs ?? 5000,
    };
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
   * 結束目前初始化階段
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

      //載入腳本
      this.startStage(this.initStages.SCRIPTS_LOADING);
      await this.loadAllScripts();
      this.endStage();

      //初始化模組
      this.startStage(this.initStages.MODULES_INIT);
      await this.initializeModules();
      this.endStage();

      //初始化其他元件
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
        Logger.error("初始化其他元件失敗:", e);
      });
    }
  }

  /**
   * 載入所有腳本
   */
  async loadAllScripts() {
    await this.loadDependencies();
  }

  /**
   * 初始化模組
   */
  async initializeModules() {
    // 先載入 scenarioData，以便在 SystemManager 初始化時可用
    await this.loadScenarioData();
    await this.initializeManagersSimplified();
  }

  /**
   * 初始化其他元件
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
      { src: "js/core/console-manager.js", isModule: true },
      { src: "js/core/config.js", isModule: true },
      { src: "js/core/websocket-client.js", isModule: true },
      { src: "js/core/time-sync-manager.js", isModule: true },
      { src: "js/experiment/experiment-state-manager.js", isModule: true },

      // 同步系統
      { src: "js/sync/sync-client.js", isModule: true },
      { src: "js/experiment/experiment-hub-manager.js", isModule: true },

      // 核心工具
      { src: "js/constants/action-constants.js", isModule: true },
      { src: "js/core/data-loader.js", isModule: true },
      { src: "js/core/random-utils.js", isModule: true },

      // 實驗模組架構
      {
        src: "js/experiment/experiment-combination-manager.js",
        isModule: true,
      },
      { src: "js/experiment/experiment-flow-manager.js", isModule: true },
      { src: "js/experiment/experiment-action-handler.js", isModule: true },
      { src: "js/experiment/experiment-ui-manager.js", isModule: true },

      // 實驗系統管理器
      { src: "js/experiment/experiment-system-manager.js", isModule: true },

      // 計時器管理
      { src: "js/experiment/experiment-timer.js", isModule: true },

      // Board 專用模組
      { src: "js/board/board-log-manager.js", isModule: true },
      { src: "js/board/board-log-ui.js", isModule: true },
      { src: "js/board/board-ui-manager.js", isModule: true },
      { src: "js/board/board-gesture-utils.js", isModule: true },

      // 同步與對話框（experiment-sync-manager 必須在 board-sync-manager 之前，確保 ExperimentSyncCore 先建立）
      { src: "js/sync/experiment-sync-manager.js", isModule: true },
      { src: "js/board/board-sync-manager.js", isModule: true },
      { src: "js/sync/sync-confirm-dialog.js", isModule: true },
      { src: "js/constants/sync-events-constants.js", isModule: true },
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
   * 管理器初始化
   */
  async initializeManagersSimplified() {
    const initStart = performance.now();
    const logInitDuration = (label, start) => {
      const duration = performance.now() - start;
      Logger.debug(`${label} (<orange>${duration.toFixed(0)} ms</orange>)`);
    };
    try {
      if (!this.syncManager) {
        const syncStart = performance.now();
        this.syncManager = new SyncManager();
        logInitDuration("Board: SyncManager 已初始化", syncStart);
      }

      if (!this.experimentSyncCore) {
        const syncCoreStart = performance.now();
        this.experimentSyncCore = new ExperimentSyncCore();
        this.experimentSyncCore.updateDependencies?.({
          syncManager: this.syncManager,
          syncClient: this.syncManager?.core?.syncClient,
        });
        logInitDuration("ExperimentSyncCore 已初始化", syncCoreStart);
      }

      experimentSyncManager.updateDependencies({
        syncManager: this.syncManager,
        syncClient: this.syncManager?.core?.syncClient,
        experimentSyncCore: this.experimentSyncCore,
        experimentHubManager: this.experimentHubManager,
      });

      if (!this.configManager) {
        const configStart = performance.now();
        this.configManager = new ConfigManager();
        await this.configManager.loadConfigSettings();
        logInitDuration("ConfigManager 已初始化", configStart);
      }

      if (!this.experimentHubManager) {
        this.experimentHubManager = new ExperimentHubManager({
          syncManager: this.syncManager,
          syncClient: this.syncManager?.core?.syncClient,
          experimentSyncCore: this.experimentSyncCore,
          roleConfig: this.syncManager?.constructor?.ROLE || {
            VIEWER: "viewer",
          },
        });
      }
      if (this.experimentHubManager?.updateDependencies) {
        this.experimentHubManager.updateDependencies({
          syncManager: this.syncManager,
          syncClient: this.syncManager?.core?.syncClient,
          experimentSyncCore: this.experimentSyncCore,
          roleConfig: this.syncManager?.constructor?.ROLE || {
            VIEWER: "viewer",
          },
        });
      }
      this.syncManager.updateDependencies({
        experimentHubManager: this.experimentHubManager,
      });
      experimentSyncManager.updateDependencies({
        experimentHubManager: this.experimentHubManager,
      });
      if (!this.experimentCombinationManager) {
        this.experimentCombinationManager = new ExperimentCombinationManager();
      }
      if (this.experimentCombinationManager?.updateDependencies) {
        this.experimentCombinationManager.updateDependencies({
          hubManager: this.experimentHubManager,
          syncManager: this.syncManager,
          syncClient: this.syncManager?.core?.syncClient,
          experimentSyncCore: this.experimentSyncCore,
        });
      }

      if (!this.experimentFlowManager) {
        const flowStart = performance.now();
        this.experimentFlowManager = initExperimentFlowManager({
          combinationManager: this.experimentCombinationManager,
          hubManager: this.experimentHubManager,
          actionHandler: this.experimentActionHandler,
          actionsMap: this.actionsMap || null,
          unitsData: this.unitsData || null,
        });
        logInitDuration("ExperimentFlowManager 已初始化", flowStart);
      }

      const stateStart = performance.now();
      this.experimentStateManager = new ExperimentStateManager({
        timeSyncManager: this.syncManager?.core?.timeSyncManager,
        experimentHubManager: this.experimentHubManager,
      });
      logInitDuration("ExperimentStateManager 已初始化", stateStart);

      if (!this.experimentLogManager) {
        const logStart = performance.now();
        this.experimentLogManager = new ExperimentLogManager({
          timeSyncManager: this.syncManager?.core?.timeSyncManager,
          stateManager: this.experimentStateManager,
        });
        this.experimentLogManager.updateDependencies?.({
          syncClient: this.syncManager?.core?.syncClient,
        });
        logInitDuration("ExperimentLogManager 已初始化", logStart);
      }
      this.experimentStateManager.updateDependencies({
        experimentLogManager: this.experimentLogManager,
      });

      if (!this.timerManager) {
        this.timerManager = new ExperimentTimerManager({
          timeSyncManager: this.syncManager?.core?.timeSyncManager,
          experimentLogManager: this.experimentLogManager,
          getCurrentCombination: () => this.currentCombination,
        });
      }

      if (!this.uiManager) {
        const uiStart = performance.now();
        this.uiManager = initExperimentUIManager({
          timerManager: this.timerManager,
          flowManager: this.experimentFlowManager,
          combinationManager: this.experimentCombinationManager,
          hubManager: this.experimentHubManager,
          syncManager: this.syncManager,
          syncClient: this.syncManager?.core?.syncClient,
          experimentSyncCore: this.experimentSyncCore,
          panelUIManager: null,
        });
        logInitDuration("ExperimentUIManager 已初始化", uiStart);
      }

      if (!this.gestureUtils) {
        this.gestureUtils = createBoardGestureUtils({
          app: this,
          timerManager: this.timerManager,
          syncClient: this.syncManager?.core?.syncClient,
          syncCore: this.experimentSyncCore,
          logger: Logger,
          experimentLogManager: this.experimentLogManager,
        });
      }

      if (experimentLogUI) {
        const uiLogStart = performance.now();
        experimentLogUI.updateDependencies({
          logManager: this.experimentLogManager,
          timeSyncManager: this.syncManager?.core?.timeSyncManager,
          config: getSharedConfig(),
          boardPageManager: this,
        });
        if (!experimentLogUI._initialized) {
          experimentLogUI.initialize();
        }
        logInitDuration("ExperimentLogUI 已初始化", uiLogStart);
      }

      this._setupEventListeners();

      const systemStart = performance.now();
      const instance = new ExperimentSystemManager({
        combinationManager: this.experimentCombinationManager,
        uiManager: this.uiManager,
        hubManager: this.experimentHubManager,
        flowManager: this.experimentFlowManager,
        timerManager: this.timerManager,
        pageManager: this,
        experimentLogManager: this.experimentLogManager,
      });
      await instance.initialize();
      this.experimentSystemManager = instance;
      this.experimentActionHandler = instance.actionHandler;
      logInitDuration("系統管理器已初始化", systemStart);

      logInitDuration("所有管理器已初始化", initStart);
    } catch (error) {
      Logger.error("初始化模組失敗:", error);
      throw error;
    }
  }

  /**
   * 初始化其餘元件（在管理器初始化之後）
   */
  initializeRemainingComponents() {
    this.scenariosData = null;
    this.scriptData = null;
    this.gesturesData = null;
    this.currentUnit = this.currentUnit || null;
    this.currentStep = this.currentStep || 0;
    this.currentCombination = this.currentCombination || null;
    this.currentUnitOrder = this.currentUnitOrder || [];
    this.sessionId = this.generateSessionId();
    this.experimentRunning = false;
    this.gestureStats = {};
    this.participantName = "";
    this.lastSavedParticipantName = "";
    this.pendingExperimentIdUpdate = null;
    this.pendingParticipantNameUpdate = null;
    this.actionsMap = new Map();
    this.actionToStepMap = new Map();
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionTimings = new Map();
    this.processedRemoteActions = new Map();
    this.remotActionDedupeWindow = 500;
    this.boardUIManager = new BoardUIManager(this);
    this.boardUIManager.init();
    Logger.debug("BoardUIManager 已初始化");
    this.init();
  }

  /**
  * 使用統一的 UI 管理器渲染所有 UI 元件
   */

  /**
  * 設定事件監聽器（僅應被呼叫一次）
   * @private
   */
  _setupEventListeners() {
    // 防止重複監聽器設定
    if (this._listenersSetup) {
      Logger.warn("BoardPageManager 事件監聽器已設定，跳過重複設定");
      return;
    }

    this._listenersSetup = true;

    // 監聽 ExperimentSystemManager 的組合選擇事件
    window.addEventListener("experimentSystem:combinationSelected", (event) => {
      const { combination, experimentId } = event.detail;
      this._handleSystemCombinationSelected(combination, experimentId);
    });

    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.STARTED,
      (data) => {
        this._handleFlowStarted(data);
      },
    );
    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.PAUSED,
      (data) => {
        this._handleFlowPaused(data);
      },
    );
    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.RESUMED,
      (data) => {
        this._handleFlowResumed(data);
      },
    );
    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.STOPPED,
      (data) => {
        this._handleFlowStopped(data);
      },
    );
    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.LOCKED,
      (data) => {
        this._handleFlowLocked(data);
      },
    );
    this.experimentFlowManager.on(
      ExperimentFlowManager.EVENT.UNLOCKED,
      (data) => {
        this._handleFlowUnlocked(data);
      },
    );
  }

  /**
   * 處理 ExperimentSystemManager 的組合選擇事件
   * @private
   */
  async _handleSystemCombinationSelected(combination, experimentId) {
    Logger.debug("_handleSystemCombinationSelected: 收到組合選擇事件", {
      combinationName: combination?.combinationName,
      combinationId: combination?.combinationId,
      experimentId,
    });

    // 更新 board 端的目前組合參照
    this.currentCombination = combination;

    // 載入對應的腳本（board 專屬邏輯 — 建構手勢序列等）
    try {
      await this.loadScriptForCombination(combination, experimentId);
      Logger.debug("_handleSystemCombinationSelected: 手勢序列載入完成");
    } catch (error) {
      Logger.error("_handleSystemCombinationSelected: 載入手勢序列失敗", error);
    }
  }

  /**
   * 處理 ExperimentFlowManager 的 STARTED 事件
   * @private
   * 觸發時機：ExperimentFlowManager.startExperiment() 完成
   * 目的：初始化 Board 端的記錄、同步等特定功能
   */
  _handleFlowStarted(data) {
    Logger.info("Board: 實驗已開始，初始化記錄和同步", { units: data.units });

    // 同步 experimentRunning 旗標，避免 _autoStartExperimentIfNeeded 重複觸發
    this.experimentRunning = true;

    // 初始化日誌管理器與即時日誌 UI（統一由 flowStarted 驅動）
    if (this.experimentLogManager) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      const experimentId = experimentIdInput?.value || data.experimentId || "";
      const participantNameInput = document.getElementById("participantNameInput");
      const participantName =
        participantNameInput?.value?.trim() || this.participantName || "";

      this.experimentLogManager.initialize(experimentId, participantName);
      this.experimentLogManager.logExperimentStart();
      Logger.debug(`日誌管理器已初始化: ID=${experimentId}`);
    }

    this.updateExperimentStats();

    const experimentControls = document.getElementById("experimentControlsContainer");
    if (experimentControls) {
      experimentControls.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // 廣播由 startExperiment() 在呼叫 FlowManager 前先 dispatchEvent("experiment_started")
    // → _bindDomEvents 捕獲後廣播，此處不重複 dispatch
  }

  /**
   * 處理 FlowManager PAUSED 事件（board 端）
   * 分發 DOM 事件供 _bindDomEvents 廣播兩端
   */
  _handleFlowPaused(data) {
    // FlowManager 已自動發出 EXPERIMENT_PAUSED DOM 事件，此處只進行特化 board 操作
    experimentSyncManager.registerExperimentStateToHub({
      type: SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
      experimentId:
        document.getElementById("experimentIdInput")?.value?.trim() ||
        this.experimentId ||
        "",
      participantName:
        document.getElementById("participantNameInput")?.value?.trim() ||
        this.participantName ||
        "",
      combinationId: this.currentCombination?.combinationId || "",
      combinationName: this.currentCombination?.combinationName || "",
      gestureCount: this.currentCombination?.gestures?.length || 0,
      isRunning: true,
    });
    Logger.debug("Board: 實驗已暫停");
  }

  /**
   * 處理 FlowManager RESUMED 事件（board 端）
   * FlowManager 已自動發出 EXPERIMENT_RESUMED DOM 事件
   */
  _handleFlowResumed(data) {
    // FlowManager 已自動發出 EXPERIMENT_RESUMED DOM 事件，此處只進行特化 board 操作
    experimentSyncManager.registerExperimentStateToHub({
      type: SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
      experimentId:
        document.getElementById("experimentIdInput")?.value?.trim() ||
        this.experimentId ||
        "",
      participantName:
        document.getElementById("participantNameInput")?.value?.trim() ||
        this.participantName ||
        "",
      combinationId: this.currentCombination?.combinationId || "",
      combinationName: this.currentCombination?.combinationName || "",
      gestureCount: this.currentCombination?.gestures?.length || 0,
      isRunning: true,
    });
    Logger.debug("Board: 實驗已繼續");
  }

  /**
   * 處理 ExperimentFlowManager 的 STOPPED 事件
   * @private
   * 觸發時機：ExperimentFlowManager.stopExperiment() 完成
   * 目的：儲存日誌、停止同步、處理實驗結束邏輯
   */
  _handleFlowStopped(data) {
    Logger.info("Board: 實驗已停止，清理資源和儲存日誌", {
      reason: data.reason,
      completedUnits: data.completedUnits,
    });

    experimentSyncManager.registerExperimentStateToHub({
      type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
      experimentId:
        document.getElementById("experimentIdInput")?.value?.trim() ||
        this.experimentId ||
        "",
      participantName:
        document.getElementById("participantNameInput")?.value?.trim() ||
        this.participantName ||
        "",
      combinationId: this.currentCombination?.combinationId || "",
      combinationName: this.currentCombination?.combinationName || "",
      gestureCount: this.currentCombination?.gestures?.length || 0,
      isRunning: false,
    });

    // 同步 experimentRunning 旗標
    this.experimentRunning = false;

    // 停止日誌記錄並準備匯出
    if (this.experimentLogManager) {
      try {
        // 立即儲存所有待處理的日誌
        if (typeof this.experimentLogManager.flushPendingLogs === "function") {
          this.experimentLogManager.flushPendingLogs();
        }

        Logger.debug("Board: 已清空日誌緩衝區");

        // 如果需要，可以觸發日誌匯出對話框
        // this._showLogExportDialog(data);
      } catch (error) {
        Logger.error("Board: 處理日誌儲存失敗:", error);
      }
    }

    // 廣播由 stopExperiment() 透過 dispatchEvent(EXPERIMENT_STOPPED) → _bindDomEvents 自動處理
  }

  /**
   * 處理 ExperimentFlowManager 的 LOCKED 事件
   * @private
   */
  _handleFlowLocked(data) {
    Logger.debug("收到 ExperimentFlowManager LOCKED 事件:", data);
    // 鎖定 board 端的 UI 控制
    this._setBoardControlsLocked(true);
  }

  /**
   * 處理 ExperimentFlowManager 的 UNLOCKED 事件
   * @private
   */
  _handleFlowUnlocked(data) {
    Logger.debug("收到 ExperimentFlowManager UNLOCKED 事件:", data);
    // 解鎖 board 端的 UI 控制
    this._setBoardControlsLocked(false);
  }

  /**
  * 設定 board 控制項的鎖定狀態
   * @private
   * @param {boolean} locked - 是否鎖定
   */
  _setBoardControlsLocked(locked) {
    Logger.debug(`設定 board 控制項鎖定狀態: ${locked}`);

    // 鎖定/解鎖主要控制按鈕
    const startBtn = document.getElementById("startExperimentBtn");
    const stopBtn = document.getElementById("stopExperimentBtn");
    const regenerateBtn = document.getElementById("regenerateExperimentIdBtn");

    if (startBtn) startBtn.disabled = locked;
    // 停止按鈕邏輯與 locked 相反：實驗進行中（locked=true）才可用，未執行時停用
    if (stopBtn) stopBtn.disabled = !locked;
    if (regenerateBtn) regenerateBtn.disabled = locked;

    // 更新按鈕樣式以反映鎖定狀態（停止按鈕不參與 locked 樣式）
    const lockableButtons = [startBtn, regenerateBtn].filter((btn) => btn);
    lockableButtons.forEach((btn) => {
      if (locked) {
        btn.classList.add("locked");
      } else {
        btn.classList.remove("locked");
      }
    });
  }

  generateSessionId() {
    return generateExperimentId();
  }

  /**
   * 初始化實驗頁面管理器
   */
  async init() {
    await this.boardUIManager.renderUnifiedUI();
    this.boardUIManager.renderGestureTypesReference();
    this.setupParticipantNameListener();
    this.setupRemoteEventListeners();
    this._bindExportGestureButton();
  }

  async loadScenarioData() {
    Logger.debug("loadScenarioData: 開始載入劇本資料");
    const loadStart = performance.now();
    try {
      // 使用資料轉換器載入完整的 units 和 actions 資料
      const convertedData = await loadUnitsFromScenarios();
      this.scenariosData = await loadScenariosData();

      // 載入手勢多語言資料
      this.gesturesData = await fetch("data/gestures.json").then((r) =>
        r.json(),
      );

      // 儲存 actions 相關資料
      this.actionsMap = convertedData.actions;
      this.actionToStepMap = convertedData.actionToStep;
      this.unitsData = convertedData.units;
      this.experimentFlowManager?.updateDependencies?.({
        actionsMap: this.actionsMap,
        unitsData: this.unitsData,
      });

      // 初始化 scriptData
      this.scriptData = {
        combinations: convertedData.unit_combinations,
        gestures: this.scenariosData.gesture_list,
        sections: this.scenariosData.sections,
        units: convertedData.units,
      };

      Logger.debug(`loadScenarioData: 劇本資料載入完成 (<orange>${(performance.now() - loadStart).toFixed(0)} ms</orange>)`, {
        gestureList_count: this.scenariosData?.gesture_list?.length || 0,
        sections_count: this.scenariosData?.sections?.length || 0,
        combinations_count: convertedData?.unit_combinations?.length || 0,
      });
    } catch (error) {
      Logger.error(`載入 scenarios.json 失敗 (<orange>${(performance.now() - loadStart).toFixed(0)} ms</orange>):`, error);
    }
  }

  /**
   * 載入組合腳本並建立手勢序列
   * @param {Object} combination - 組合資料
   * @param {string} experimentId - 實驗ID
   */
  async loadScriptForCombination(combination, experimentId) {
    Logger.debug("loadScriptForCombination: 開始載入組合腳本", {
      combinationName: combination?.combinationName,
      experimentId,
    });
    try {
      // 確保實驗ID不為空
      if (!experimentId || !experimentId.trim()) {
        experimentId = this.experimentSystemManager
          ? this.experimentSystemManager.getExperimentId() ||
            generateExperimentId()
          : generateExperimentId();
      }

      Logger.debug("loadScriptForCombination: 實驗ID確認完成", {
        experimentId,
      });

      // 建立組合內容
      const script = {
        combinationId: combination.combinationId,
        combinationName: combination.combinationName,
        description: combination.description,
        experimentId: experimentId,
        unitsSequence: [],
        gestures: [],
      };

      // 建立單元序列（統一使用 CombinationManager 管理排序邏輯）
      const unitIds = this.experimentCombinationManager.getCombinationUnitIds(
        combination,
        experimentId,
      );
      Logger.debug("loadScriptForCombination: 單元序列模式", { unitIds });

      const confirmGesture = this.scenariosData?.gesture_list?.find(
        (g) => g.gesture_id === "confirm",
      );
      const nextGesture = this.scenariosData?.gesture_list?.find(
        (g) => g.gesture_id === "next",
      );
      const prevGesture = this.scenariosData?.gesture_list?.find(
        (g) => g.gesture_id === "prev",
      );
      const openGesture = this.scenariosData?.gesture_list?.find(
        (g) => g.gesture_id === "open",
      );
      const section = this.scenariosData?.sections?.[0];

      Logger.debug("loadScriptForCombination: 手勢載入來源狀態", {
        openGesture_loaded: !!openGesture,
        confirmGesture_loaded: !!confirmGesture,
        nextGesture_loaded: !!nextGesture,
        prevGesture_loaded: !!prevGesture,
        section_loaded: !!section,
        scenariosData_exists: !!this.scenariosData,
        gestureList_count: this.scenariosData?.gesture_list?.length || 0,
        sections_count: this.scenariosData?.sections?.length || 0,
      });

      if (this.scenariosData && this.scenariosData.sections) {
        const startupCheckbox = document.getElementById("includeStartup");
        const shutdownCheckbox = document.getElementById("includeShutdown");
        const includeStartup = startupCheckbox ? startupCheckbox.checked : true;
        const includeShutdown = shutdownCheckbox ? shutdownCheckbox.checked : true;

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

        unitIds.forEach((unitId, unitIdx) => {
          const unit = section.units.find((u) => u.unit_id === unitId);
          if (!unit) return;

          script.unitsSequence.push({
            unit_id: unit.unit_id,
            unit_name: unit.unit_name,
            description: unit.unit_description,
          });

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

          if (unit.steps) {
            unit.steps.forEach((step, stepIdx) => {
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

          if (unitIdx < unitIds.length - 1) {
            const nextUnitId = unitIds[unitIdx + 1];
            const nextUnit = section.units.find(
              (u) => u.unit_id === nextUnitId,
            );

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

        const addPowerActionToGesture = (gestureIndex, action) => {
          if (!script.gestures[gestureIndex]) return;
          const target = script.gestures[gestureIndex];
          if (!Array.isArray(target.actions)) {
            target.actions = [];
          }
          const exists = target.actions.some(
            (existing) => existing.action_id === action.action_id,
          );
          if (!exists) {
            target.actions.push(action);
          }
        };

        if (includeStartup && script.gestures.length > 0) {
          const targetIndex = script.gestures.length > 1 ? 1 : 0;
          addPowerActionToGesture(targetIndex, {
            action_id: ACTION_IDS.POWER_ON,
            action_name: "電源開機",
            action_buttons: ACTION_BUTTONS.POWER_ON,
            media_file: null,
            interactions: {
              [ACTION_BUTTONS.POWER_ON]: { next_action_id: null },
            },
          });
        }

        if (includeShutdown && script.gestures.length > 0) {
          const lastIndex = script.gestures.length - 1;
          const targetIndex = lastIndex > 0 ? lastIndex - 1 : 0;
          addPowerActionToGesture(targetIndex, {
            action_id: ACTION_IDS.POWER_OFF,
            action_name: "電源關機",
            action_buttons: ACTION_BUTTONS.POWER_OFF,
            media_file: null,
            interactions: {
              [ACTION_BUTTONS.POWER_OFF]: { next_action_id: null },
            },
          });
        }
      } else {
        Logger.warn(
          "loadScriptForCombination: scenariosData 或 sections 不存在",
        );
      }

      Logger.debug("loadScriptForCombination: 手勢序列建構完成", {
        gestureCount: script.gestures.length,
        unitCount: script.unitsSequence.length,
        combinationName: script.combinationName,
      });

      if (script.gestures.length === 0) {
        Logger.warn("loadScriptForCombination: 警告：沒有產生任何手勢！");
      }

      this.currentCombination = script;
      Logger.debug("loadScriptForCombination: 呼叫 renderUnitDetail()");
      this.renderUnitDetail();
    } catch (error) {
      Logger.error("loadScriptForCombination: 載入組合劇本失敗", error);
    }
  }

  /**
   * 渲染單元詳細內容
   */
  renderUnitDetail() {
    Logger.debug("renderUnitDetail: 開始渲染手勢序列面板", {
      hasCombination: !!this.currentCombination,
      gesture_count: this.currentCombination?.gestures?.length || 0,
    });

    if (!this.currentCombination) {
      Logger.warn("renderUnitDetail: currentCombination 為空，無法渲染");
      return;
    }

    const contentArea = document.getElementById("contentArea");
    if (!contentArea) {
      Logger.warn("renderUnitDetail: contentArea 元素不存在");
      return;
    }

    const script = this.currentCombination;

    Logger.debug("renderUnitDetail: 開始建構 HTML", {
      combinationName: script.combinationName,
      gestureCount: script.gestures?.length || 0,
    });

    const convertColorTags = (text) => {
      if (!text) return text;
      return text
        .replace(
          /\[orange\](.*?)\[\/orange\]/g,
          "<span style=\"color: #ff9800; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[red\](.*?)\[\/red\]/g,
          "<span style=\"color: #f44336; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[green\](.*?)\[\/green\]/g,
          "<span style=\"color: #4caf50; font-weight: 700;\">$1</span>",
        )
        .replace(
          /\[blue\](.*?)\[\/blue\]/g,
          "<span style=\"color: #2196f3; font-weight: 700;\">$1</span>",
        );
    };

    let html = "<div class=\"right-section\"><h2>實驗手勢序列</h2>";
    if (script.gestures) {
      html +=
        "<div style=\"display: grid; grid-template-columns: 1fr; gap: 12px;\">";

      script.gestures.forEach((gesture, idx) => {
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
        const hasPowerAction =
          Array.isArray(gesture.actions) &&
          gesture.actions.some(
            (action) =>
              action.action_id === ACTION_IDS.POWER_ON ||
              action.action_id === ACTION_IDS.POWER_OFF,
          );

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

                            <div id="timer-card-${idx}" class="timer-card"
                              style="--timer-accent: ${accentColor}; background: ${bgColor}; border: 2px solid ${accentColor};"
                              data-action="timer-card"
                              data-gesture-index="${idx}">

                            <div id="timer-display-${idx}" class="timer-display" style="color: ${accentColor};">
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

                        <div style="margin-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                            <button class="gesture-action-btn correct"
                                    data-action="mark-gesture"
                                    data-mark-status="correct"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <circle cx="12" cy="12" r="8.5" />
                                </svg>
                            </button>
                            <button class="gesture-action-btn uncertain"
                                    data-action="mark-gesture"
                                    data-mark-status="uncertain"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12,4.5 20.5,19.5 3.5,19.5" />
                                </svg>
                            </button>
                            <button class="gesture-action-btn incorrect"
                                    data-action="mark-gesture"
                                    data-mark-status="incorrect"
                                    data-gesture-index="${idx}"
                                    data-gesture-name="${gesture.name}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round">
                                    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
                                    <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" />
                                </svg>
                            </button>
                        </div>

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

                        ${
                          ((!isSystemOpen &&
                            !isSystemClose &&
                            !isCapture &&
                            !isZoomIn &&
                            !isZoomOut &&
                            !isUnitSwitch) ||
                            hasPowerAction) &&
                          (gesture.step_name ||
                            (gesture.actions && gesture.actions.length > 0))
                            ? `
                            <div class="gesture-info-section action-info">
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

                                ${
                                  gesture.actions && gesture.actions.length > 0
                                    ? `
                                    <div class="gesture-actions-container">
                                        ${gesture.actions
                                          .map(
                                            (action, actionIdx) => `
                                            <button
                                              class="action-button gesture-action-button"
                                              data-action="action-button"
                                              data-action-id="${
                                                action.action_id
                                              }"
                                              data-gesture-index="${idx}"
                                              data-completed="false">
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

                        <button class="gesture-next-button"
                                data-action="next-step"
                                data-gesture-index="${idx}"
                                data-gesture-name="${gesture.name}">
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
    Logger.debug("renderUnitDetail: 手勢序列 HTML 已渲染到 DOM");

    const gestureCards = contentArea.querySelectorAll("[id^='gesture-card-']");
    Logger.debug("renderUnitDetail: 驗證渲染結果", {
      rendered_cards_count: gestureCards.length,
      expected_cards_count: this.currentCombination?.gestures?.length || 0,
    });

    if (
      gestureCards.length === 0 &&
      this.currentCombination?.gestures?.length > 0
    ) {
      Logger.warn(
        "renderUnitDetail: HTML 中沒有找到手勢卡片，但 script 中有手勢",
      );
    }

    this._bindGestureContentEvents(contentArea);
    this.updateExperimentStats();
  }

  updateExperimentStats() {
    const statsPanel = document.getElementById("experimentStats");
    const script = this.currentCombination;

    if (script && script.gestures && script.gestures.length > 0) {
      if (statsPanel.classList.contains("is-hidden"))
        statsPanel.classList.remove("is-hidden");

      document.getElementById("statGestureCount").textContent =
        `${script.gestures.length} 步`;

      const unitCount = script.unitsSequence ? script.unitsSequence.length : 0;
      document.getElementById("statUnitCount").textContent = unitCount;

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

      this.renderGestureCountList();

      if (this.currentActionSequence && this.currentActionSequence.length > 0) {
        const firstAction = this.currentActionSequence[0];
        if (firstAction) {
          this.startActionTiming(firstAction.action_id);
        }
      }
    } else {
      if (!statsPanel.classList.contains("is-hidden"))
        statsPanel.classList.add("is-hidden");
    }
  }

  _bindGestureContentEvents(contentArea) {
    if (!contentArea) return;

    if (this._contentAreaListeners?.element === contentArea) {
      return;
    }

    if (this._contentAreaListeners?.element) {
      const previous = this._contentAreaListeners;
      previous.element.removeEventListener("click", previous.onClick);
      previous.element.removeEventListener(
        "pointerdown",
        previous.onPointerDown,
      );
      previous.element.removeEventListener(
        "pointerup",
        previous.onPointerUp,
      );
      previous.element.removeEventListener(
        "pointercancel",
        previous.onPointerUp,
      );
      previous.element.removeEventListener(
        "pointerout",
        previous.onPointerOut,
      );
    }

    const parseIndex = (value) => {
      const idx = parseInt(value, 10);
      return Number.isNaN(idx) ? null : idx;
    };

    const onClick = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !contentArea.contains(target)) return;

      const action = target.dataset.action;
      const idx = parseIndex(target.dataset.gestureIndex);
      const gestureName = target.dataset.gestureName || "";

      switch (action) {
        case "timer-card":
          if (idx !== null) {
            this.timerManager?.toggleIndexedTimer(idx);
          }
          break;
        case "mark-gesture":
          if (idx !== null) {
            this.gestureUtils?.markGesture(
              idx,
              target.dataset.markStatus,
              gestureName,
            );
          }
          break;
        case "next-step":
          if (idx !== null) {
            this.gestureUtils?.goToNextStep(idx, gestureName);
          }
          break;
        case "action-button": {
          const actionId = target.dataset.actionId;
          this._handleActionButtonClick(target, actionId, idx);
          break;
        }
        default:
          break;
      }
    };

    const onPointerDown = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !contentArea.contains(target)) return;

      const action = target.dataset.action;
      const idx = parseIndex(target.dataset.gestureIndex);

      if (action === "timer-card" && idx !== null) {
        this.timerManager?.longPressStart(idx);
      }

      if (action === "action-button") {
        this._startActionRollbackPress(
          target,
          target.dataset.actionId,
          idx,
        );
      }
    };

    const onPointerUp = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !contentArea.contains(target)) return;

      const action = target.dataset.action;
      const idx = parseIndex(target.dataset.gestureIndex);

      if (action === "timer-card" && idx !== null) {
        this.timerManager?.longPressEnd(idx);
      }

      if (action === "action-button") {
        this._endActionRollbackPress(target);
      }
    };

    const onPointerOut = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !contentArea.contains(target)) return;

      if (target.contains(event.relatedTarget)) return;

      const action = target.dataset.action;
      const idx = parseIndex(target.dataset.gestureIndex);

      if (action === "timer-card" && idx !== null) {
        this.timerManager?.longPressEnd(idx);
      }

      if (action === "action-button") {
        this._endActionRollbackPress(target);
      }
    };

    contentArea.addEventListener("click", onClick);
    contentArea.addEventListener("pointerdown", onPointerDown);
    contentArea.addEventListener("pointerup", onPointerUp);
    contentArea.addEventListener("pointercancel", onPointerUp);
    contentArea.addEventListener("pointerout", onPointerOut);

    this._contentAreaListeners = {
      element: contentArea,
      onClick,
      onPointerDown,
      onPointerUp,
      onPointerOut,
    };
  }

  _handleActionButtonClick(buttonElement, actionId, gestureIndex) {
    if (buttonElement?.getAttribute("data-rollback-fired") === "true") {
      return;
    }

    if (typeof this.gestureUtils?.activateGestureStep === "function") {
      const idx = Number.isFinite(gestureIndex)
        ? gestureIndex
        : parseInt(gestureIndex, 10);
      if (!Number.isNaN(idx)) {
        this.gestureUtils.activateGestureStep(idx);
      }
    }

    const isCompleted = buttonElement.getAttribute("data-completed") === "true";
    const now = Date.now();
    const lastClickTime = parseInt(
      buttonElement.getAttribute("data-last-click") || "0",
      10,
    );
    const clickDelay = now - lastClickTime;

    buttonElement.setAttribute("data-last-click", now);
    const isDoubleClick = clickDelay < 300;

    if (isDoubleClick && isCompleted) {
      this._cancelActionCompletion(buttonElement, actionId, gestureIndex, false);
    } else if (!isCompleted) {
      this._markActionCompleted(buttonElement, actionId, gestureIndex, false);
    }
  }

  _startActionRollbackPress(buttonElement, actionId, gestureIndex) {
    if (!buttonElement) return;
    if (buttonElement.getAttribute("data-completed") !== "true") return;
    if (buttonElement._rollbackTimer) return;

    buttonElement._rollbackTimer = setTimeout(() => {
      buttonElement.setAttribute("data-rollback-fired", "true");
      this._cancelActionCompletion(buttonElement, actionId, gestureIndex, false);
      setTimeout(() => {
        buttonElement.removeAttribute("data-rollback-fired");
      }, 600);
    }, 5000);
  }

  _endActionRollbackPress(buttonElement) {
    if (!buttonElement?._rollbackTimer) return;
    clearTimeout(buttonElement._rollbackTimer);
    buttonElement._rollbackTimer = null;
  }

  _markActionCompleted(
    buttonElement,
    actionId,
    gestureIndex,
    isRemote = false,
  ) {
    if (!buttonElement) return;

    buttonElement.setAttribute("data-completed", "true");
    buttonElement.style.background = "#c8e6c9";
    buttonElement.style.borderColor = "#4caf50";
    buttonElement.style.boxShadow = "0 0 8px rgba(76, 175, 80, 0.3)";

    if (!isRemote && this.experimentLogManager) {
      this.experimentLogManager.logAction(actionId, gestureIndex, null);
    }
  }

  _cancelActionCompletion(
    buttonElement,
    actionId,
    gestureIndex,
    shouldBroadcast = false,
  ) {
    if (!buttonElement) return;

    buttonElement.setAttribute("data-completed", "false");
    buttonElement.style.background = "#e8eeff";
    buttonElement.style.borderColor = "#667eea";
    buttonElement.style.boxShadow = "";

    if (this.experimentLogManager) {
      this.experimentLogManager.logAction(
        `${actionId}_CANCELLED`,
        gestureIndex,
        null,
      );
    }

    void shouldBroadcast;
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
        "<div style=\"color: #999; font-size: 12px; text-align: center; padding: 10px;\">尚無手勢統計記錄</div>";
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

  /**
   * 初始化指定組合的 action 序列
   * @param {Object} combination - 選定的組合
   * @param {string} experimentId - 實驗ID
   */
  initActionSequenceForCombination(combination, experimentId) {
    try {
      const unitIds = this.experimentCombinationManager.getCombinationUnitIds(
        combination,
        experimentId,
      );
      this.currentActionSequence = buildActionSequenceFromUnits(
        unitIds,
        this.actionsMap,
        this.scriptData.units,
        {
          includeStartup:
            document.getElementById("includeStartup")?.checked ?? true,
          includeShutdown:
            document.getElementById("includeShutdown")?.checked ?? true,
        },
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

    this.completedActions.add(actionId);

    const timingData = this.endActionTiming(actionId);

    const stepInfo = this.actionToStepMap.get(actionId);
    if (this.experimentLogManager?.logAction) {
      this.experimentLogManager.logAction(actionId, null, stepInfo?.step_id);
    }
    Logger.debug(`Action完成: ${action.action_name}`, {
      action_id: actionId,
      step_id: stepInfo?.step_id,
      unit_id: stepInfo?.unit_id,
      duration_ms: timingData?.duration_ms || null,
      start_time: timingData?.start_time || null,
      end_time: timingData?.end_time || null,
    });

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
    this.uiManager.updateSelectAllState();
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
    this.updateUnitButtonStates();
    this.updateSelectAllState();

    const unitList = document.querySelector(
      "#unitsPanelContainer .experiment-units-list",
    );
    if (!unitList) return;

    const selectedUnits = [];
    unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
      const checkbox = li.querySelector("input[type=\"checkbox\"]");
      if (checkbox && checkbox.checked) {
        selectedUnits.push(li.dataset.unitId);
      }
    });

    if (selectedUnits.length > 0) {
      const customCombination = {
        combinationId: "custom",
        combinationName: "自訂組合",
        description: "根據選擇和排序產生的自訂組合",
        units: selectedUnits,
        is_randomizable: false,
      };

      const experimentId = document
        .getElementById("experimentIdInput")
        .value.trim();
      this.loadScriptForCombination(customCombination, experimentId);

      document.querySelectorAll(".combination-item").forEach((el) => {
        el.classList.remove("active");
      });
    }
  }

  async startExperiment() {
    const checkedUnits = document.querySelectorAll(
      ".unit-checkbox input[type=\"checkbox\"]:checked",
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
      return false;
    }

    let experimentId =
      this.experimentId ||
      document.getElementById("experimentIdInput")?.value?.trim() ||
      "";

    if (!experimentId) {
      Logger.warn("請輸入實驗ID");
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) experimentIdInput.focus();
      return false;
    }

    if (!this.experimentId) {
      this.experimentId = experimentId;
    }

    if (
      !this.currentCombination ||
      !this.currentCombination.gestures ||
      this.currentCombination.gestures.length === 0
    ) {
      Logger.warn("請先選擇實驗組合並載入手勢序列");
      return false;
    }

    const participantNameEl = document.getElementById("participantNameInput");
    let participantName = participantNameEl
      ? participantNameEl.value.trim()
      : this.participantName || "";

    if (!participantName) {
      participantName = this.participantName || "";
      Logger.debug("受試者名稱未填寫，使用空值繼續");
    }

    const unitOrder =
      this.experimentSystemManager?.state?.currentUnitIds?.join("->") ||
      this.loadedUnits?.join("->") ||
      "";

    const experimentData = {
      experimentId: experimentId,
      participantName: participantName,
      combinationId: this.currentCombination.combinationId,
      combinationName: this.currentCombination.combinationName,
      unitCount: validUnits.length,
      unitOrder: unitOrder,
      gestureCount: this.currentCombination.gestures.length,
      startTime: new Date().toISOString(),
    };

    // 日誌初始化與面板切換統一由 Flow STARTED 事件處理

    this.logAction("experiment_started", experimentData);

    const firstGestureCard = document.getElementById("gesture-card-0");
    if (firstGestureCard) {
      firstGestureCard.scrollIntoView({ behavior: "smooth", block: "start" });

      firstGestureCard.classList.remove("gesture-card-inactive");
      firstGestureCard.classList.add(
        "gesture-card-active",
        "gesture-card-current",
      );

    }

    experimentSyncManager.registerExperimentStateToHub({
      experiment_id: experimentData.experimentId,
      participantName: experimentData.participantName,
      combination_name: experimentData.combinationName,
      combination_id: experimentData.combinationId,
      gesture_count: experimentData.gestureCount,
      is_running: true,
    });

    const flowStarted = await this.experimentFlowManager.startExperiment();
    if (!flowStarted) {
      Logger.warn("實驗流程啟動失敗");
      return false;
    }

    const participantNameInput = document.getElementById("participantNameInput");
    if (participantNameInput) {
      this.participantName = participantNameInput.value.trim();
      this.lastSavedParticipantName = this.participantName;
    }

    return true;
  }

  async stopExperiment(isManualStop = true) {
    if (!this.experimentRunning) {
      return;
    }

    this.experimentRunning = false;

    if (this.pendingExperimentIdUpdate) {
      this.handleRemoteExperimentIdUpdate(this.pendingExperimentIdUpdate);
      this.pendingExperimentIdUpdate = null;
    }

    if (this.pendingParticipantNameUpdate) {
      this.handleRemoteParticipantNameUpdate(this.pendingParticipantNameUpdate);
      this.pendingParticipantNameUpdate = null;
    }

    if (!isManualStop) {
      const participantNameInput = document.getElementById("participantNameInput");
      if (participantNameInput) {
        participantNameInput.value = "";
      }
      this.participantName = "";
      this.lastSavedParticipantName = "";
    }

    if (this.pendingCombinationUpdate) {
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

    const experimentData = {
      experiment_id: document.getElementById("experimentIdInput")?.value || "",
      participant_name:
        document.getElementById("participantNameInput")?.value || "",
      combination: this.currentCombination?.combinationName || "",
      end_time: new Date().toISOString(),
    };

    if (this.experimentLogManager) {
      this.experimentLogManager.logExperimentEnd();
      this.experimentLogManager.flushAll();
      const logDownloadBtns = document.getElementById("logDownloadBtns");
      if (logDownloadBtns) {
        if (logDownloadBtns.classList.contains("is-hidden"))
          logDownloadBtns.classList.remove("is-hidden");
      }
    }

    this.logAction("experiment_stopped", experimentData);

    document
      .querySelectorAll(".gesture-card-active, .gesture-card-current")
      .forEach((card) => {
        card.classList.remove("gesture-card-active", "gesture-card-current");
        card.classList.add("gesture-card-inactive");
      });

    if (window.timerStates) {
      Object.keys(window.timerStates).forEach((idx) => {
        const state = window.timerStates[idx];
        if (state && state.running) {
          if (window.timerIntervals && window.timerIntervals[idx]) {
            clearInterval(window.timerIntervals[idx]);
          }
          state.running = false;
          state.elapsedTime += Date.now() - state.startTime;
        }
      });
    }

    if (this.timerManager) {
      this.timerManager.stopExperimentTimer();
    }

    this.experimentFlowManager.stopExperiment(
      isManualStop ? "manual" : "auto",
    );

    if (!isManualStop) {
      if (this.config.autoStopCooldownMs > 0) {
        Logger.debug(
          `自動停止冷卻 ${this.config.autoStopCooldownMs} ms`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.autoStopCooldownMs),
        );
      }
      if (this.experimentSystemManager) {
        await this.experimentSystemManager.regenerateExperimentId();
      }
    }
  }

  /**
   * 暫停/繼續實驗 —帶過 FlowManager（統一驅動計時器、UI、同步廣播）
   */
  togglePauseExperiment() {
    if (!this.experimentRunning) return;
    const fm = this.experimentFlowManager;
    if (fm.isPaused) {
      fm.resumeExperiment();
    } else {
      fm.pauseExperiment();
    }
  }

  /** 設定受試者名稱監聽器 */
  setupParticipantNameListener() {
    const participantNameInput = document.getElementById("participantNameInput");

    if (!participantNameInput) return;

    // 初始化受試者名稱
    this.participantName = participantNameInput.value.trim();
    this.lastSavedParticipantName = this.participantName;

    // 監聽輸入框變更並自動儲存
    participantNameInput.addEventListener("input", (e) => {
      const newValue = e.target.value.trim();

      // 如果內容改變，立即更新內部狀態
      if (newValue !== this.lastSavedParticipantName) {
        this.participantName = newValue;
        this.lastSavedParticipantName = newValue;

        // 如果在同步模式下，廣播變更
        this.broadcastParticipantNameChange(newValue);

        // 記錄日誌
        this.logAction("participant_name_updated", {
          participant_name: newValue,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // 監聽 Enter 鍵（可選，用於更好的使用者體驗）
    participantNameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Enter 鍵可以觸發其他操作，如果需要的話
      }
    });
  }

  /** 監聽遠端實驗狀態變化 */
  setupRemoteEventListeners() {
    // 監聽來自 index.html 的按鈕動作廣播
    document.addEventListener(
      SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      (event) => {
        const data = event.detail;
        // 收到遠端事件

        if (!data || !data.type) return;

        switch (data.type) {
          case SYNC_DATA_TYPES.EXPERIMENT_INITIALIZE:
            this.handleRemoteExperimentInit(data);
            break;
          case SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE:
            this.handleRemoteExperimentIdUpdate(data);
            break;
          case SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE:
            // 受試者名稱更新已由本機處理，此為同步管理器通知
            // 無需在此重複處理
            break;
          default:
            Logger.warn("未知的遠端事件類型:", data.type);
        }
      },
    );

    // 監聽同步狀態更新（用於接收面板同步操作者的 action）
    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (event) => {
      const state = event.detail;
      if (!state) return;
      // 防止自我回聲：捨棄自己廣播後回來的訊息
      const myId = this.syncManager?.core?.syncClient?.clientId;
      if (myId && state.clientId === myId) return;

      // 處理面板廣播的實驗初始化
      if (state.type === SYNC_DATA_TYPES.EXPERIMENT_INITIALIZE) {
        this.handleRemoteExperimentInit(state);
      }
      // 處理面板的按鈕動作（button_action）
      else if (state.type === SYNC_DATA_TYPES.BUTTON_ACTION) {
        this.handleRemoteButtonAction(state);
      }
      // 處理面板的 action 完成
      else if (state.type === SYNC_DATA_TYPES.ACTION_COMPLETED) {
        this.handleRemoteActionCompleted(state);
      }
      // 處理面板的 action 取消
      else if (state.type === SYNC_DATA_TYPES.ACTION_CANCELLED) {
        this.handleRemoteActionCancelled(state);
      }
      // 處理實驗ID更新
      else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE) {
        this.handleRemoteExperimentIdUpdate(state);
      }
      // 處理受試者名稱更新
      else if (state.type === SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE) {
        this.handleRemoteParticipantNameUpdate(state);
      }
    });

    // 監聽來自其他 experiment.html 裝置的實驗狀態變化
    window.addEventListener(
      SYNC_EVENTS.REMOTE_EXPERIMENT_STARTED,
      (event) => {
        this.handleRemoteExperimentStarted(event.detail);
      },
    );

    window.addEventListener(
      SYNC_EVENTS.REMOTE_EXPERIMENT_PAUSED,
      (event) => {
        this.handleRemoteExperimentPaused(event.detail);
      },
    );

    window.addEventListener(
      SYNC_EVENTS.REMOTE_EXPERIMENT_RESUMED,
      (event) => {
        this.handleRemoteExperimentResumed(event.detail);
      },
    );

    window.addEventListener(
      SYNC_EVENTS.REMOTE_EXPERIMENT_STOPPED,
      (event) => {
        this.handleRemoteExperimentStopped(event.detail);
      },
    );

    // 監聽來自實驗中樞的實驗ID廣播更新
    window.addEventListener("experiment_id_broadcasted", (event) => {
      const { experimentId, client_id } = event.detail;
      const hubManager = this.experimentHubManager;

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

    // combination:selected DOM 事件不再於此監聽
    // 統一透過 experimentSystem:combinationSelected 處理
    // （由 _setupEventListeners 中的 _handleSystemCombinationSelected 接收）

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
    const event = new CustomEvent(
      SYNC_EVENTS.REMOTE_PANEL_STATE_UPDATE,
      {
        detail: data,
      },
    );
    document.dispatchEvent(event);
  }

  /**
   * 處理來自面板的 action 完成同步
   * 若實驗管理中的手勢序列對應的步驟中有相同的 action，則更新狀態
   */
  handleRemoteActionCompleted(syncData) {
    const { actionId, source, clientId, timestamp, gestureIndex } = syncData;

    // 接收遠端 action 完成

    // 記錄到日誌
    this.logAction("remote_action_completed", {
      actionId: actionId,
      source: source,
      clientId: clientId,
      timestamp: timestamp,
    });

    const actionButton = document.querySelector(
      `.gesture-action-button[data-action-id="${actionId}"]`,
    );
    if (actionButton) {
      this._markActionCompleted(actionButton, actionId, gestureIndex, true);
    }

    // 在實驗進行中時，檢查是否有對應的步驟
    if (this.experimentRunning && this.currentCombination) {
      // 取得對應 action 的步驟資訊
      const stepInfo = this.actionToStepMap?.get(actionId);

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

  /** 處理來自面板的 action 取消同步 */
  handleRemoteActionCancelled(syncData) {
    const { actionId, clientId, timestamp, gestureIndex } = syncData;

    this.logAction("remote_action_cancelled", {
      actionId: actionId,
      clientId: clientId,
      timestamp: timestamp,
    });

    const actionButton = document.querySelector(
      `.gesture-action-button[data-action-id="${actionId}"]`,
    );
    if (actionButton) {
      this._cancelActionCompletion(actionButton, actionId, gestureIndex, false);
    }
  }

  /** 處理遠端按鈕動作 */
  handleRemoteButtonAction(data) {
    const {
      experimentId,
      button,
      actionId,
      function: buttonFunction,
      clientId,
      timestamp,
    } = data;

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value || "";
    const expId = experimentId;
    const btn = button;
    const func = buttonFunction;
    const deviceInfo = clientId;

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
    if (this.experimentLogManager) {
      this.experimentLogManager.logButtonAction(btn, func, deviceInfo);
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
    const { experimentId, currentCombination, participantName, loadedUnits } = data;

    // 設定實驗ID
    if (experimentId) {
      this.experimentId = experimentId;
      Logger.info(`從機台面板同步的實驗ID: ${experimentId}`);

      // 更新輸入框
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }
    }

    // 如果實驗正在執行，同步受試者名稱
    if (participantName) {
      const participantNameInput = document.getElementById("participantNameInput");
      if (participantNameInput && participantNameInput.value.trim() !== participantName) {
        participantNameInput.value = participantName;
        this.participantName = participantName;
        this.lastSavedParticipantName = participantName;
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
  handleRemoteParticipantNameUpdate(data) {
    // 如果目前實驗正在進行中，等待實驗結束後再同步新的受試者名稱
    if (this.experimentRunning) {
      // 將更新請求加入佇列，等待實驗結束
      this.pendingParticipantNameUpdate = data;
      return;
    }

    const { participantName } = data;

    const participantNameInput = document.getElementById("participantNameInput");
    if (participantNameInput && participantNameInput.value.trim() !== participantName) {
      participantNameInput.value = participantName;
      this.participantName = participantName;
      this.lastSavedParticipantName = participantName;
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
      if (this.experimentStateManager) {
        this.experimentStateManager.setExperimentId(
          experimentId,
          LOG_SOURCES.REMOTE_SYNC,
        );
      }

      // 重新套用組合排序（與面板側行為對稱）
      if (this.experimentSystemManager?.setExperimentId) {
        this.experimentSystemManager.setExperimentId(experimentId, LOG_SOURCES.REMOTE_SYNC, {
          registerToHub: false,
          broadcast: false,
          reapplyCombination: true,
        });
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

      // 從手勢對象直接取得名稱 (loadScriptForCombination 已經設定了)
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

  showRemoteActionFeedback(actionId, buttonData, timestamp) {
    const actionCards = document.querySelectorAll(".action-button");
    if (actionCards.length === 0) {
      Logger.warn("找不到動作卡片");
      return;
    }
    let targetActionId = actionId;
    if (!targetActionId) {
      const currentAction = this.experimentActionHandler?.getCurrentAction();
      if (!currentAction) {
        Logger.warn("無法取得目前 action");
        return;
      }
      targetActionId = currentAction.action_id;
    }

    let highlightedCard = null;
    let gestureIndex = null;

    actionCards.forEach((card) => {
      const cardAction = card.getAttribute("data-action-id");
      const cardGestureIdx = card.getAttribute("data-gesture-index");

      if (cardAction === targetActionId) {
        highlightedCard = card;
        gestureIndex = cardGestureIdx;

        this._markActionCompleted(card, targetActionId, gestureIndex, true);

        if (gestureIndex !== null) {
          const idx = parseInt(gestureIndex, 10);
          if (!Number.isNaN(idx)) {
            this.gestureUtils?.activateGestureStep(idx);
          }
        }

        card.classList.add("remote-action-completed");

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
        if (this.experimentLogManager) {
          this.experimentLogManager.logAction(
            matchedActionId,
            this.currentStep,
            null,
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
  broadcastParticipantNameChange(participantName) {
    // 檢查是否存在同步工作階段
    if (!this.syncManager?.core?.isConnected()) {
      return;
    }

    // 如果受試者名稱為空，不進行同步（避免 null 污染）
    if (!participantName || !participantName.trim()) {
      Logger.debug("受試者名稱為空，跳過同步");
      return;
    }

    const updateData = {
      type: SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE,
      clientId: this.syncManager?.core?.syncClient?.clientId || "experiment_panel",
      timestamp: Date.now(),
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      participantName: participantName.trim(),
    };

    // 同步到伺服器
    this.experimentSyncCore?.safeBroadcast?.(updateData).catch((error) => {
      Logger.warn("同步受試者名稱更新失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: updateData,
      }),
    );
  }

  /** 註冊實驗狀態到中樞 */

  /** 處理遠端實驗開始 */
  async handleRemoteExperimentStarted(detail) {
    const myId = this.syncManager?.core?.syncClient?.clientId;
    if (myId && detail.clientId === myId) {
      Logger.debug("Board: 收到本機實驗開始廣播，忽略");
      return;
    }

    if (this.experimentFlowManager?.isRunning) {
      Logger.debug("Board: Flow 已在進行中，忽略遠端啟動");
      return;
    }
    // 如果本機已在進行相同的實驗，忽略（避免重複啟動）
    if (this.experimentRunning) {
      const currentId =
        document.getElementById("experimentIdInput")?.value?.trim() ||
        this.experimentId ||
        "";
      if (currentId === detail.experimentId) {
        Logger.debug("Board: 收到遠端實驗開始，但本機已在進行相同實驗，忽略");
        return;
      }
      // 不同實驗 ID → 接受此資訊，FlowManager 的 isRunning 檢測會保護
    }

    // 記錄日誌
    this.logAction("remote_experiment_started_received", {
      clientId: detail.clientId,
      experimentId: detail.experimentId,
    });

    // 檢查本機的實驗 ID 是否配對
    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value.trim() || "";
    if (currentExperimentId !== detail.experimentId) {
      // 更新本機實驗 ID
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) {
        experimentIdInput.value = detail.experimentId;
      }
    }

    // 檢查受試者名稱是否需要更新
    if (detail.participantName) {
      const participantNameInput = document.getElementById("participantNameInput");
      if (participantNameInput && !participantNameInput.value.trim()) {
        participantNameInput.value = detail.participantName;
      }
    }

    // 同步單元組合設定
    if (detail.combinationId) {
      const combinationSelect = document.getElementById(
        "unitCombinationSelect",
      );
      if (combinationSelect) {
        combinationSelect.value = detail.combinationId;
        // 觸發組合變更事件以重新載入手勢序列
        combinationSelect.dispatchEvent(new Event("change"));
      }
    }

    // 記錄同步完成
    this.logAction("remote_experiment_started", {
      clientId: detail.clientId,
      experimentId: detail.experimentId,
      combinationId: detail.combinationId,
      combinationName: detail.combinationName,
    });

    // 啟動本機實驗以同步 Panel 的操作
    try {
      this.startExperiment();
      Logger.debug("Board: 遠端實驗開始已處理，已啟動本機實驗");
    } catch (error) {
      Logger.error("Board: 啟動遠端同步實驗失敗:", error);
    }
  }

  /** 處理遠端實驗暫停 */
  handleRemoteExperimentPaused(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 如果已經暫停，忽略
    const isPaused = this.timerManager?.experimentPaused ?? false;
    if (isPaused) {
      return;
    }

    // 同步暫停狀態 - 委派給 experiment-timer.js
    if (this.timerManager) {
      this.timerManager.pauseExperimentTimer();
    }

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "▶ 繼續";
    }

    // 記錄日誌
    Logger.info("遠端暫停實驗");

    this.logAction("remote_experiment_paused", {
      clientId: detail.clientId,
    });
  }

  /** 處理遠端實驗還原 */
  handleRemoteExperimentResumed(detail) {
    // 檢查實驗是否正在進行
    if (!this.experimentRunning) {
      return;
    }

    // 如果未暫停，忽略
    const isPaused = this.timerManager?.experimentPaused ?? false;
    if (!isPaused) {
      return;
    }

    // 同步還原狀態 - 委派給 experiment-timer.js
    if (this.timerManager) {
      this.timerManager.resumeExperimentTimer();
    }

    // 更新暫停按鈕顯示
    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
    }

    // 記錄日誌
    Logger.info("遠端繼續實驗");

    this.logAction("remote_experiment_resumed", {
      clientId: detail.clientId,
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
      clientId: detail.clientId,
    });

    //回應遠端停止訊號時不廣播（false = 不廣播）
    this.stopExperiment(false);

    // 記錄停止完成
    this.logAction("remote_experiment_stopped_completed", {
      clientId: detail.clientId,
    });
  }

  logAction(action, data) {
    const _logEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      action: action,
      data: data,
    };

    Logger.debug("BoardPageManager logAction", _logEntry);
  }

  _bindExportGestureButton() {
    if (this._exportGestureBound) return;
    const btn = document.getElementById("exportGestureSequenceBtn");
    if (!btn) return;

    btn.addEventListener("click", () => this.exportGestureSequence());
    this._exportGestureBound = true;
  }

  async syncLogsNow() {
    try {
      Logger.debug("=== 立即同步日誌開始 ===");

      const syncStatus = {
        timestamp: new Date().toISOString(),
        localLogsFlushResult: null,
        webSocketQueueStatus: null,
        errors: [],
      };

      if (this.experimentLogManager) {
        try {
          const localFlushResult =
            await this.experimentLogManager.flushPendingLogs();
          syncStatus.localLogsFlushResult = localFlushResult;

          Logger.info(
            `✓ 本機日誌緩衝區已寫入${localFlushResult ? "（發送 " + this.experimentLogManager.pendingLogs.length + " 筆）" : "（無待發送日誌）"}`,
            { result: localFlushResult },
          );
        } catch (error) {
          const msg = `本機日誌寫入失敗: ${error.message}`;
          Logger.error(msg, error);
          syncStatus.errors.push(msg);
        }
      } else {
        const msg = "experimentLogManager 未初始化";
        Logger.warn(msg);
        syncStatus.errors.push(msg);
      }

      const wsClient = this.syncManager?.core?.syncClient?.wsClient;
      if (wsClient) {
        const queueSize = wsClient.messageQueue?.length || 0;
        const isConnected = wsClient.ws?.readyState === WebSocket.OPEN;

        syncStatus.webSocketQueueStatus = {
          queueSize: queueSize,
          isConnected: isConnected,
          maxSize: 500,
        };

        Logger.info(
          `WebSocket 訊息緩衝區狀態: ${isConnected ? "已連接" : "斷開"}, 佇列大小: ${queueSize}`,
          syncStatus.webSocketQueueStatus,
        );

        if (queueSize > 0 && !isConnected) {
          Logger.warn(`WebSocket 已斷開且有 ${queueSize} 條待發送訊息`);
        }
      } else {
        Logger.warn("WebSocket 客戶端未初始化");
      }

      const syncCompleteEvent = new CustomEvent("logs_synced_now", {
        detail: {
          timestamp: syncStatus.timestamp,
          success: syncStatus.errors.length === 0,
          localLogsFlushResult: syncStatus.localLogsFlushResult,
          webSocketQueueStatus: syncStatus.webSocketQueueStatus,
          errors: syncStatus.errors,
        },
      });
      document.dispatchEvent(syncCompleteEvent);

      Logger.info("=== 立即同步日誌完成 ===", syncStatus);

      if (syncStatus.errors.length > 0) {
        Logger.warn("同步過程中發生錯誤，但本機操作已完成", syncStatus.errors);
      }

      return syncStatus;
    } catch (error) {
      Logger.error("立即同步日誌發生未預期的錯誤:", error);
      throw error;
    }
  }

  exportGestureSequence() {
    try {
      if (!this.currentCombination) {
        alert("請先選擇一個組合");
        return;
      }

      const gestures = this.currentCombination.gestures || [];
      if (gestures.length === 0) {
        alert("沒有手勢序列資料");
        return;
      }

      const experimentIdInput = document.getElementById("experimentIdInput");
      const experimentId = experimentIdInput?.value || "N/A";

      const gestureTypes = gestures
        .map((g) => g.gesture || "?")
        .join(" ");
      const textContent = `${experimentId} ${gestureTypes}`;

      navigator.clipboard
        .writeText(textContent)
        .then(() => {
          const btn = document.getElementById("exportGestureSequenceBtn");
          if (btn) {
            const originalHTML = btn.innerHTML;
            const originalBg = btn.style.background;
            btn.innerHTML = "✓ 已複製";
            btn.style.background = "#4caf50";

            setTimeout(() => {
              btn.innerHTML = originalHTML;
              btn.style.background = originalBg;
            }, 2000);
          }

          Logger.info("已複製手勢序列", textContent);
        })
        .catch((err) => {
          Logger.error("複製到剪貼簿失敗:", err);
          alert("複製失敗，請查看控制台");
        });
    } catch (error) {
      Logger.error("匯出手勢序列失敗:", error);
      alert("匯出失敗，請查看控制台");
    }
  }
}
const boardPageManager = new BoardPageManager();

const initializeBoard = async () => {
  try {
    await boardPageManager.initialize();
    Logger.debug("Board 頁面已自動初始化");
  } catch (error) {
    Logger.error("Board 頁面自動初始化失敗:", error);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBoard);
} else {
  initializeBoard();
}

export { BoardPageManager, boardPageManager };
