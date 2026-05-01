/**
 * PanelPageManager - 機台面板頁面管理器
 *
 * 頁面腳本的載入與初始化。
 */

import { Logger } from "../core/console-manager.js";
import { loadUnitsFromScenarios } from "../core/data-loader.js";
import { ButtonManager } from "./panel-button-manager.js";
import { ExperimentFlowManager } from "../experiment/experiment-flow-manager.js";
import { ExperimentActionHandler } from "../experiment/experiment-action-handler.js";
import { ACTION_IDS } from "../constants/index.js";
import { initializePanelManagers } from "./panel-init.js";
import "../experiment/experiment-timer.js";
import "../sync/sync-confirm-dialog.js";

class PanelPageManager {
  constructor() {
    this.initStages = {
      MODULES_INIT: "modules_init",
      COMPONENTS_INIT: "components_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;

    this.configManager = null;
    this.panelUIManager = null;
    this.powerControl = null;
    this.panelMediaManager = null;
    this.syncManager = null;
    this.experimentSyncCore = null;
    this.panelSyncManager = null;
    this.experimentHubManager = null;
    this.experimentCombinationManager = null;
    this.experimentFlowManager = null;
    this.uiManager = null;
    this.experimentSystemManager = null;
    this.experimentStateManager = null;
    this.experimentActionHandler = null;
    this.timerManager = null;
    this.buttonManager = null;
    this.panelLogger = null;
    this._listenersSetup = false;
    this._eventUnsubscribers = [];
  }

  /**
   * 開始初始化流程區段
   * @param {string} stage - 流程名稱
   */
  startStage(stage) {
    this.currentStage = stage;
    this.stageStartTime = performance.now();
    Logger.debug(`開始流程: ${stage}`);
  }

  /**
   * 結束目前初始化流程
   */
  endStage() {
    if (this.currentStage && this.stageStartTime) {
      const duration = performance.now() - this.stageStartTime;
      Logger.debug(
        `流程 ${this.currentStage} 完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
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
   * 初始化 Panel 頁面（載入所需腳本並呼叫完成流程）
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("PanelPageManager 開始初始化");

      await this._runInitStage(this.initStages.MODULES_INIT, () => this.initializeModules());
      await this._runInitStage(this.initStages.COMPONENTS_INIT, () => this.initializeRemainingComponents());

      this.currentStage = this.initStages.COMPLETE;
      Logger.debug(
        `PanelPageManager 初始化完成 (<orange>${(performance.now() - startTime).toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error(
        `PanelPageManager 初始化失敗 (流程: ${this.currentStage}, 耗時: ${(performance.now() - startTime).toFixed(0)} ms)`,
        error,
      );
      throw error;
    }
  }

  /**
   * 初始化面板管理器模組
   */
  async initializeModules() {
    const managerInitStart = performance.now();
    await initializePanelManagers(this);
    Logger.debug(
      `Panel: 管理器初始化完成 (<orange>${(performance.now() - managerInitStart).toFixed(0)} ms</orange>)`,
    );
  }

  /**
   * 初始化其餘元件（在管理器初始化之後）
   */
  async initializeRemainingComponents() {
    const initStart = performance.now();
    Logger.debug("Panel: 開始初始化 UI 與執行期綁定");

    const uiDataInitStart = performance.now();
    await this._initializeExperimentUIAndData();
    Logger.debug(
      `Panel: UI 與資料初始化完成 (<orange>${(performance.now() - uiDataInitStart).toFixed(0)} ms</orange>)`,
    );

    const runtimeInitStart = performance.now();
    this._initializePanelRuntimeBindings();
    Logger.debug(
      `Panel: 執行期綁定完成 (<orange>${(performance.now() - runtimeInitStart).toFixed(0)} ms</orange>)`,
    );

    Logger.debug(
      `Panel: ExperimentSystemManager UI 初始化完成 (<orange>${(performance.now() - initStart).toFixed(0)} ms</orange>)`,
    );
  }

  async _initializeExperimentUIAndData() {
    const scriptData = await loadUnitsFromScenarios();
    this.actionToStepMap = scriptData.actionToStep;
    this.experimentFlowManager.injectDependencies({
      unitsData: scriptData.units,
      actionsMap: scriptData.actions,
    });
    await this.experimentSystemManager.initializeUI(
      {
        combinationSelector: "#combinationSelectorContainer",
        unitPanel: "#unitsPanelContainer",
        experimentControls: "#experimentControlsContainer",
      },
      scriptData,
    );
  }

  _initializePanelRuntimeBindings() {
    this._teardownExperimentEventListeners();
    this._setupExperimentEventListeners();
    this._initializeButtonManager();
    this.powerControl.updateDependencies(this._buildPowerControlDependencies());
    this.panelLogger.updateDependencies({
      buttonManager: this.buttonManager,
    });
    this.panelUIManager.setupExperimentPanelButtonColor();
  }

  _buildPowerControlDependencies() {
    return {
      panelLogger: this.panelLogger,
      experimentActionHandler: this.experimentActionHandler,
      experimentFlowManager: this.experimentFlowManager,
      experimentSystemManager: this.experimentSystemManager,
      experimentCombinationManager: this.experimentCombinationManager,
      experimentSyncCore: this.experimentSyncCore,
      syncClient: this.syncManager.core?.syncClient,
      panelMediaManager: this.panelMediaManager,
      buttonManager: this.buttonManager,
    };
  }

  /**
   * 設定頁面特定的實驗事件監聽器
   * @private
   */
  _setupExperimentEventListeners() {
    if (this._listenersSetup) {
      Logger.debug("Panel: 事件監聽器已設定，略過重複綁定");
      return;
    }

    this._listenersSetup = true;
    const flowManager = this.experimentFlowManager;

    this._registerEventUnsubscriber(
      flowManager.on(ExperimentFlowManager.EVENT.STARTED, async (data) => {
        this.panelUIManager?.closeAllPanels();
        Logger.debug("Panel: 收到實驗開始事件，開始載入動作序列");
        await this._handleExperimentStarted(data);
      }),
    );

    this._registerEventUnsubscriber(
      this.panelSyncManager.bindExperimentBroadcast(flowManager),
    );
    this._registerEventUnsubscriber(
      this.panelLogger.bindExperimentEvents(flowManager),
    );

    this._registerEventUnsubscriber(
      flowManager.on(ExperimentFlowManager.EVENT.STOPPED, (data) => {
        Logger.debug("Panel: 收到實驗停止事件，清理按鈕狀態");
        this._handleFlowTermination(data);
      }),
    );

    this._registerEventUnsubscriber(
      flowManager.on(ExperimentFlowManager.EVENT.COMPLETED, (data) => {
        const powerOptions = this._getPowerOptionsForCurrentCombination();
        const reason = powerOptions.includeShutdown ? "power_off" : "completed";
        Logger.debug("Panel: 收到實驗完成事件，清理按鈕狀態", {
          reason,
        });
        this._handleFlowTermination({
          reason,
          completedUnits: data?.completedUnits,
          timestamp: data?.timestamp,
        });
      }),
    );

    this._registerEventUnsubscriber(this.experimentActionHandler.on(
      ExperimentActionHandler.EVENT.ACTION_ENTERED,
      (data) => {
        Logger.debug("Panel: 新步驟已進入，更新媒體顯示", {
          actionId: data.actionId,
        });
        // 令 ButtonManager 更新媒體顯示並重刷下一個動作的高亮
        this.buttonManager?.updateMediaForCurrentAction?.();
      },
    ));

    Logger.debug("Panel: 已設定頁面特定的實驗事件監聽器");
  }

  _registerEventUnsubscriber(unsubscribe) {
    if (typeof unsubscribe === "function") {
      this._eventUnsubscribers.push(unsubscribe);
    }
  }

  _teardownExperimentEventListeners() {
    this._eventUnsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        Logger.warn("Panel: 解除事件監聽器失敗", error);
      }
    });
    this._eventUnsubscribers = [];
    this._listenersSetup = false;
  }

  _handleFlowTermination(data = {}) {
    this._handleExperimentStopped();
    this._handleExperimentSystemFlowStopped(data);
  }

  _getPowerOptionsForCurrentCombination() {
    return this.experimentSystemManager?.getCurrentPowerOptions?.() || {
      includeStartup: true,
      includeShutdown: true,
    };
  }

  /**
   * 處理實驗開始事件：載入動作序列並通知相關管理器
   * @private
   */
  async _handleExperimentStarted(data) {
    const unitIds = data.units;
    const powerOptions = this._getPowerOptionsForCurrentCombination();

    this.experimentFlowManager?.setDeferCompletion?.(
      Boolean(powerOptions.includeShutdown),
    );

    if (powerOptions.includeStartup) {
      this.powerControl?.ensurePowerOffForExperimentStart();
    }

    Logger.debug(
      `[實驗開始] 電源狀態: ${this.powerControl.isPowerOn ? "已開啟" : "未開啟"} | 單元: ${unitIds.join(", ")}`,
    );

    if (unitIds.length === 0) {
      Logger.warn("沒有可用的單元 ID");
      return;
    }

    // 序列已由 ExperimentFlowManager.startExperiment 完整建立，
    // 這裡只負責設定 actionToStepMap 並通知 ButtonManager
    const actionHandler = this.experimentActionHandler;
    const actionToStepMap = this.actionToStepMap || new Map();

    // 補充電源開關的 step 對應（data-loader 不包含這兩個虛擬 action）
    if (powerOptions.includeStartup) {
      actionToStepMap.set(ACTION_IDS.POWER_ON, {
        unit_id: unitIds[0] || "",
        step_id: "POWER_STARTUP",
        step_name: "電源開機",
        isLastActionInStep: true,
      });
    }
    if (powerOptions.includeShutdown) {
      actionToStepMap.set(ACTION_IDS.POWER_OFF, {
        unit_id: unitIds[unitIds.length - 1] || "",
        step_id: "POWER_SHUTDOWN",
        step_name: "電源關機",
        isLastActionInStep: true,
      });
    }

    actionHandler.actionToStepMap = actionToStepMap;

    if (powerOptions.includeStartup) {
      this.powerControl?.syncPowerActionWithState();
    }

    this._notifyButtonManagerForActions(unitIds);
    this.panelUIManager.setExperimentPanelButtonColor("running");
    this.buttonManager?.updateMediaForCurrentAction?.();

    Logger.debug("實驗開始處理完成");
  }

  /**
   * 初始化按鈕管理器
   * @private
   */
  _initializeButtonManager() {
    this.buttonManager = new ButtonManager({
      logger: this.panelLogger,
      experimentActionHandler: this.experimentActionHandler,
      experimentFlowManager: this.experimentFlowManager,
      experimentSystemManager: this.experimentSystemManager,
      experimentSyncCore: this.experimentSyncCore,
      syncClient: this.syncManager.core?.syncClient,
      powerControl: this.powerControl,
      panelMediaManager: this.panelMediaManager,
    });
    Logger.debug("ButtonManager 已初始化");

    this.panelUIManager.updateDependencies({
      buttonManager: this.buttonManager,
    });
    this.panelUIManager?.updateStepCooldown?.(
      this.configManager?.userSettings?.stepCooldownMs ?? 3000,
    );

    this.buttonManager.on("button:action-clicked", (data) => {
      this._handleButtonActionClick(data);
    });
    Logger.debug("ButtonManager 事件監聽器已設定");
  }

  /**
   * 通知按鈕管理器更新動作狀態
   * @private
   */
  _notifyButtonManagerForActions(unitIds) {
    const allUnits = this.experimentSystemManager.getScriptUnits?.() || [];
    const selectedUnits = unitIds
      .map((id) => allUnits.find((u) => u.unit_id === id))
      .filter(Boolean);

    const allActions = selectedUnits.flatMap((unit) =>
      (unit.steps || []).flatMap((step) => step.actions || []),
    );

    if (allActions.length === 0) {
      Logger.warn("沒有動作需要通知按鈕管理器");
      return;
    }

    const actionData = allActions.map((action, index) => ({
      actionId: action.action_id || action.actionId || `action_${index}`,
      buttonId: action.action_buttons || `B${index + 1}`,
      action,
    }));

    this.buttonManager.handleExperimentActionsLoaded?.({
      actions: actionData,
    });

    Logger.debug(`已通知 ButtonManager 載入 ${allActions.length} 個動作（${unitIds.length} 個單元）`);
  }

  /**
   * 處理按鈕動作點擊事件（從 ButtonManager 接收）
   * @private
   */
  _handleButtonActionClick(data) {
    const { buttonId, actionId, action } = data;

    Logger.debug(`處理按鈕動作點擊: ${buttonId}`, { actionId, action });

    const timestamp = Date.now();
    const validation = this.experimentActionHandler.validateAction(actionId, {
      buttonId,
      timestamp,
    });

    if (validation.valid) {
      const ctx = { buttonId, timestamp };
      const handler = this.experimentSystemManager?.handleCorrectAction
        ? this.experimentSystemManager
        : this.experimentActionHandler;
      handler.handleCorrectAction(actionId, ctx);
      this.buttonManager.showActionFeedback(buttonId, "correct");
      Logger.info(`動作正確: ${buttonId}`);
      return;
    }

    this.experimentActionHandler.handleIncorrectAction(
      actionId,
      validation.error,
    );
    this.buttonManager.showActionFeedback(buttonId, "incorrect");
    Logger.warn(`動作錯誤: ${buttonId}`, validation.error);
  }

  /**
   * 處理實驗停止事件
   * @private
   * 由 ExperimentFlowManager 發出
   */
  _handleExperimentStopped() {
    Logger.debug("Panel: 清理實驗停止時的按鈕和動作狀態");

    this.panelUIManager.setExperimentPanelButtonColor("default");
    this.buttonManager.clearAllButtonHighlights();

    this.buttonManager.resetActionButtonState();

    this.powerControl?.setPowerSwitchHighlight(false);

    this.buttonManager.experimentActions.clear();
    this.buttonManager.removeActionListeners();

    Logger.debug("Panel: 已清理實驗動作狀態");
  }

  /**
   * 處理 ExperimentSystemManager 的實驗系統停止通知
   * @private
   * 用於後處理邏輯（日誌儲存、同步通知等）
   */
  async _handleExperimentSystemFlowStopped(data = {}) {
    Logger.info("Panel: 處理實驗系統停止後續邏輯", data);

    this.panelMediaManager?.playSound?.("experimentEnd");
    Logger.debug("Panel: 已播放實驗結束音效");

    if (data?.reason === "power_off" && this.panelLogger?.exportLog) {
      this.panelLogger.exportLog();
      Logger.debug("Panel: 關機結束實驗，已自動匯出日誌");
    }
    Logger.debug("Panel: 實驗系統停止後續邏輯已完成");
  }

  setExperimentControlsLocked(_locked) {
    // Panel 的通用控制鎖定已由 ExperimentSystemManager DOM 控制主導。
  }
}

// 自動初始化頁面（當 DOM 完全載入時）
const panelPageManager = new PanelPageManager();
window.panelPageManager = panelPageManager;

const initializePanel = async () => {
  try {
    await panelPageManager.initialize();
    Logger.info("Panel 頁面已自動初始化");
  } catch (error) {
    Logger.error("Panel 頁面自動初始化失敗:", error);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePanel);
} else {
  initializePanel();
}
