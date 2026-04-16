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
  SYNC_DATA_TYPES,
} from "../constants/index.js";
import { experimentSyncManager } from "./board-experiment-sync.js";
import { BoardSyncIO } from "./board-sync-io.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";
import { buildBoardGestureScript } from "../experiment/experiment-script-builder.js";
import { BoardUIManager } from "./board-ui-manager.js";
import { generateExperimentId } from "../core/random-utils.js";
import { initializeBoardManagers } from "./board-init.js";

class BoardPageManager {
  constructor() {
    this.initStages = {
      DEPENDENCY_READY: "dependency_ready",
      MODULES_INIT: "modules_init",
      COMPONENTS_INIT: "components_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;
    this._listenersSetup = false; // 防止事件監聽器重複設定
    this._contentAreaListeners = null;
    this._exportGestureBound = false;

    this.timerManager = null;
    this.gestureUtils = null;
    this.syncManager = null;
    this.recordManager = null;
    this.experimentStateManager = null;
    this.syncIO = null;
    this._lastCombinationLoadSignature = null;
    this._lastCombinationRenderSignature = null;
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

  async _runInitStage(stage, task) {
    this.startStage(stage);
    try {
      await task();
    } finally {
      this.endStage();
    }
  }

  /**
   * 初始化 Board 頁面（載入腳本並初始化模組）
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("BoardPageManager 開始初始化");

      await this._runInitStage(this.initStages.DEPENDENCY_READY, async () => {
        await this.prepareDependencies();
      });

      await this._runInitStage(this.initStages.MODULES_INIT, async () => {
        await this.initializeModules();
      });

      await this._runInitStage(this.initStages.COMPONENTS_INIT, async () => {
        this.initializeRemainingComponents();
      });

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
      try {
        this.initializeRemainingComponents();
      } catch (e) {
        Logger.error("初始化其他元件失敗:", e);
      }
    }
  }

  /**
   * 初始化模組
   */
  async initializeModules() {
    // 先載入 scenarioData，以便在 SystemManager 初始化時可用
    await this.loadScenarioData();
    await initializeBoardManagers(this);
  }

  /**
   * 載入實驗頁面所需的依賴腳本
   */
  async prepareDependencies() {
    // board.html 已透過 module bootstrap + 靜態 import 鏈載入依賴，
    // 這裡保留初始化階段但不再動態注入 script，避免雙軌載入互相干擾。
    Logger.debug("Board 依賴由靜態 import 鏈提供，略過動態 script 載入");
  }

  /**
   * 初始化其餘元件（在管理器初始化之後）
   */
  initializeRemainingComponents() {
    // 保留 modules_init 階段已載入的資料，避免重複載入造成啟動成本上升。
    Object.assign(this, {
      scenariosData: this.scenariosData || null,
      scriptData: this.scriptData || null,
      gesturesData: this.gesturesData || null,
      currentUnit: this.currentUnit || null,
      currentStep: this.currentStep || 0,
      currentCombination: this.currentCombination || null,
      currentUnitOrder: this.currentUnitOrder || [],
      sessionId: this.generateSessionId(),
      experimentRunning: false,
      participantName: "",
      lastSavedParticipantName: "",
      pendingExperimentIdUpdate: null,
      pendingParticipantNameUpdate: null,
      actionsMap: this.actionsMap || new Map(),
      actionToStepMap: this.actionToStepMap || new Map(),
      currentActionSequence: [],
      currentActionIndex: 0,
      completedActions: new Set(),
      actionTimings: new Map(),
      processedRemoteActions: new Map(),
    });
    this._lastCombinationRenderSignature = null;
    // 避免遠端 action 短時間內重複處理
    this.remoteActionDedupeWindow = 500;
    this.experimentStartedAt = 0;
    this.boardUIManager = new BoardUIManager(this);
    this.boardUIManager.init();
    Logger.debug("BoardUIManager 已初始化");
    this.init();
  }

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
    this.experimentStartedAt = Date.now();

    // 初始化日誌管理器與即時日誌 UI（統一由 flowStarted 驅動）
    if (this.recordManager) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      const experimentId = experimentIdInput?.value || data.experimentId || "";
      const participantNameInput = document.getElementById("participantNameInput");
      const participantName =
        participantNameInput?.value?.trim() || this.participantName || "";

      this.recordManager.initialize(experimentId, participantName);
      this.recordManager.logExperimentStart();
      Logger.debug(`日誌管理器已初始化: ID=${experimentId}`);
    }

    this.updateExperimentStats();

    const container = document.querySelector(".container");
    const isStackedLayout =
      container &&
      window.getComputedStyle(container).flexDirection === "column";
    const experimentControls = document.getElementById("experimentControlsContainer");
    const scrollToFirstStep = () => {
      const firstGestureCard = document.getElementById("gesture-card-0");
      if (firstGestureCard) {
        firstGestureCard.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      }
      return false;
    };

    if (isStackedLayout) {
      if (!scrollToFirstStep() && this.currentCombination?.gestures?.length) {
        setTimeout(scrollToFirstStep, 0);
      }
      return;
    }

    if (experimentControls) {
      experimentControls.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (!scrollToFirstStep() && this.currentCombination?.gestures?.length) {
      setTimeout(scrollToFirstStep, 0);
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
    this.recordManager?.logExperimentPause();
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
    this.recordManager?.logExperimentResume();
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
    this.experimentStartedAt = 0;

    // 停止日誌記錄並準備匯出
    if (this.recordManager) {
      try {
        // 立即儲存所有待處理的日誌
        if (typeof this.recordManager.flushPendingLogs === "function") {
          this.recordManager.flushPendingLogs();
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

  _syncCombinationDetailRender() {
    if (!this.boardUIManager?.initialized || !this.currentCombination) return false;

    const signature = this._lastCombinationLoadSignature || JSON.stringify({
      combinationId: this.currentCombination?.combinationId || "",
      combinationName: this.currentCombination?.combinationName || "",
      gestureCount: this.currentCombination?.gestures?.length || 0,
    });

    if (this._lastCombinationRenderSignature === signature) return true;

    this.boardUIManager.renderUnitDetail();
    this._lastCombinationRenderSignature = signature;
    Logger.debug("Board: 右面板手勢序列已同步渲染");
    return true;
  }

  /**
   * 初始化實驗頁面管理器
   */
  async init() {
    await this.boardUIManager.renderUnifiedUI();

    this._syncCombinationDetailRender();

    this.boardUIManager.renderGestureTypesReference();
    this.setupParticipantNameListener();
    if (!this.syncIO) {
      this.syncIO = new BoardSyncIO(this);
    }
    this.syncIO.startReceive();
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

      const unitIds = this.experimentCombinationManager.getCombinationUnitIds(
        combination,
        experimentId,
      );
      const normalizedPowerOptions = combination?.powerOptions || {};
      const loadSignature = JSON.stringify({
        experimentId,
        combinationId: combination?.combinationId || "",
        unitIds,
        powerOptions: normalizedPowerOptions,
      });
      if (this._lastCombinationLoadSignature === loadSignature) {
        Logger.debug("loadScriptForCombination: 組合內容未變更，略過重建", {
          experimentId,
          combinationId: combination?.combinationId,
        });
        return true;
      }

      Logger.debug("loadScriptForCombination: 實驗ID確認完成", {
        experimentId,
      });

      Logger.debug("loadScriptForCombination: 單元序列模式", { unitIds });
      const { script, hasScenarioSections } = buildBoardGestureScript({
        combination,
        experimentId,
        scenariosData: this.scenariosData,
        unitIds,
        actionIds: ACTION_IDS,
        actionButtons: ACTION_BUTTONS,
      });

      if (!hasScenarioSections) {
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
      this._lastCombinationLoadSignature = loadSignature;
      this._syncCombinationDetailRender();
    } catch (error) {
      Logger.error("loadScriptForCombination: 載入組合劇本失敗", error);
    }
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

    const withTimerCard = (event, handler, options = {}) => {
      const target = event.target.closest("[data-action]");
      if (!target || !contentArea.contains(target)) return;

      if (options.skipChildTransition && target.contains(event.relatedTarget)) {
        return;
      }

      if (target.dataset.action !== "timer-card") return;

      const idx = parseIndex(target.dataset.gestureIndex);
      if (idx === null) return;

      handler(idx);
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
      withTimerCard(event, (idx) => {
        this.timerManager?.longPressStart(idx);
      });
    };

    const onPointerUp = (event) => {
      withTimerCard(event, (idx) => {
        this.timerManager?.longPressEnd(idx);
      });
    };

    const onPointerOut = (event) => {
      withTimerCard(
        event,
        (idx) => {
          this.timerManager?.longPressEnd(idx);
        },
        { skipChildTransition: true },
      );
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
    if (typeof this.gestureUtils?.activateGestureStep === "function") {
      const idx = Number.isFinite(gestureIndex)
        ? gestureIndex
        : parseInt(gestureIndex, 10);
      if (!Number.isNaN(idx)) {
        this.gestureUtils.activateGestureStep(idx);
      }
    }

    const isCompleted = buttonElement.getAttribute("data-completed") === "true";
    if (!isCompleted) {
      this._markActionCompleted(buttonElement, actionId, gestureIndex, false);
    }
  }

  _scrollActionCardIntoView(buttonElement) {
    const card = buttonElement?.closest("[id^='gesture-card-']");
    if (!card) return;

    const scrollContainer = document.querySelector(".right-panel");
    const containerRect = scrollContainer?.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const isOutOfView = containerRect
      ? cardRect.top < containerRect.top || cardRect.bottom > containerRect.bottom
      : cardRect.top < 0 || cardRect.bottom > window.innerHeight;

    if (isOutOfView) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    this._scrollActionButtonHorizontally(buttonElement);
  }

  _scrollActionButtonHorizontally(buttonElement) {
    const actionContainer = buttonElement?.closest(".gesture-actions-container");
    if (!actionContainer) return;

    const containerRect = actionContainer.getBoundingClientRect();
    const buttonRect = buttonElement.getBoundingClientRect();
    const isOutOfView =
      buttonRect.left < containerRect.left ||
      buttonRect.right > containerRect.right;
    if (!isOutOfView) return;

    const targetLeft =
      buttonElement.offsetLeft -
      (actionContainer.clientWidth - buttonElement.offsetWidth) / 2;
    actionContainer.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth",
    });
  }

  _markActionCompleted(
    buttonElement,
    actionId,
    gestureIndex,
    isRemote = false,
  ) {
    if (!buttonElement) return;

    const stepId =
      this.experimentActionHandler?.actionToStepMap?.get(actionId)?.step_id ||
      null;

    buttonElement.setAttribute("data-completed", "true");
    buttonElement.style.background = "#c8e6c9";
    buttonElement.style.borderColor = "#4caf50";
    buttonElement.style.boxShadow = "0 0 8px rgba(76, 175, 80, 0.3)";

    this._scrollActionCardIntoView(buttonElement);

    if (!isRemote && this.recordManager) {
      this.recordManager.logAction(actionId, gestureIndex, stepId);
    }

    if (!isRemote && actionId) {
      const isPowerAction =
        actionId === ACTION_IDS.POWER_ON || actionId === ACTION_IDS.POWER_OFF;
      if (isPowerAction) {
        const experimentId =
          this.experimentSystemManager?.getExperimentId?.() ||
          document.getElementById("experimentIdInput")?.value?.trim() ||
          "";
        const combinationId =
          this.currentCombination?.combinationId ||
          this.experimentCombinationManager?.getCurrentCombination?.()
            ?.combinationId ||
          "";
        const participantName =
          document.getElementById("participantNameInput")?.value?.trim() ||
          "";
        experimentSyncManager.broadcastActionCompleted({
          actionId,
          experimentId,
          combinationId,
          participantName,
        });
      }
    }
  }

  _cancelActionCompletion(
    buttonElement,
    actionId,
    gestureIndex,
  ) {
    if (!buttonElement) return;

    buttonElement.setAttribute("data-completed", "false");
    buttonElement.style.background = "#e8eeff";
    buttonElement.style.borderColor = "#667eea";
    buttonElement.style.boxShadow = "";

    if (this.recordManager) {
      this.recordManager.logAction(
        `${actionId}_CANCELLED`,
        gestureIndex,
        null,
      );
    }
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
      const powerOptions = combination?.powerOptions || {};
      const includeStartup =
        typeof powerOptions.includeStartup === "boolean"
          ? powerOptions.includeStartup
          : true;
      const includeShutdown =
        typeof powerOptions.includeShutdown === "boolean"
          ? powerOptions.includeShutdown
          : true;
      this.currentActionSequence = buildActionSequenceFromUnits(
        unitIds,
        this.actionsMap,
        this.scriptData.units,
        {
          includeStartup,
          includeShutdown,
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
    if (this.recordManager?.logAction) {
      this.recordManager.logAction(actionId, null, stepInfo?.step_id);
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
    }

    Logger.warn("handleUnitReorder: unsupported arguments", arg1, arg2);
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

    if (this.experimentSystemManager?.applyCustomUnitSelection) {
      this.experimentSystemManager.applyCustomUnitSelection(selectedUnits);
      document.querySelectorAll(".combination-item").forEach((el) => {
        el.classList.remove("active");
      });
      return;
    }

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

    if (this.gestureUtils?.activateGestureStep) {
      this.gestureUtils.activateGestureStep(0);
    } else {
      const firstGestureCard = document.getElementById("gesture-card-0");
      if (firstGestureCard) {
        firstGestureCard.scrollIntoView({ behavior: "smooth", block: "start" });

        firstGestureCard.classList.remove("gesture-card-inactive");
        firstGestureCard.classList.add(
          "gesture-card-active",
          "gesture-card-current",
        );

      }
    }

    experimentSyncManager.registerExperimentStateToHub({
      experiment_id: experimentData.experimentId,
      participantName: experimentData.participantName,
      combination_name: experimentData.combinationName,
      combination_id: experimentData.combinationId,
      gesture_count: experimentData.gestureCount,
      is_running: true,
    });

    const systemManager = this.experimentSystemManager;
    if (!systemManager?.startExperiment) {
      Logger.warn("ExperimentSystemManager 未就緒，無法啟動實驗");
      return false;
    }

    const flowStarted = await systemManager.startExperiment();
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

  async stopExperiment() {
    const systemManager = this.experimentSystemManager;
    if (!systemManager?.isExperimentRunning) {
      Logger.warn("ExperimentSystemManager 未就緒，無法停止實驗");
      return;
    }

    if (!systemManager.isExperimentRunning()) {
      return;
    }

    if (this.pendingExperimentIdUpdate) {
      this.syncIO?.receiveExperimentIdUpdate(this.pendingExperimentIdUpdate);
      this.pendingExperimentIdUpdate = null;
    }

    if (this.pendingParticipantNameUpdate) {
      this.syncIO?.receiveParticipantNameUpdate(this.pendingParticipantNameUpdate);
      this.pendingParticipantNameUpdate = null;
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

    if (this.recordManager) {
      this.recordManager.logExperimentEnd();
      this.recordManager.flushAll();
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

    systemManager.stopFlowExperiment();

  }

  /**
   * 暫停/繼續實驗 —帶過 FlowManager（統一驅動計時器、UI、同步廣播）
   */
  togglePauseExperiment() {
    if (!this.experimentRunning) return;
    const systemManager = this.experimentSystemManager;
    if (!systemManager?.togglePauseExperiment) {
      Logger.warn("ExperimentSystemManager 未就緒，無法切換暫停");
      return;
    }
    systemManager.togglePauseExperiment();
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
        this.syncIO?.sendParticipantNameUpdate(newValue);

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
  // 同步訊息接收與送出由 BoardSyncIO 負責。

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
window.boardPageManager = boardPageManager;

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
