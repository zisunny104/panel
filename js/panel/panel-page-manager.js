/**
* PanelPageManager - 面板頁面管理器
*
* 負責面板頁面腳本的載入與初始化。
*/

import { buildActionSequenceFromUnits, loadUnitsFromScenarios } from "../core/data-loader.js";
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
      SCRIPTS_LOADING: "scripts_loading",
      MODULES_INIT: "modules_init",
      COMPLETE: "complete",
    };

    this.currentStage = null;
    this.stageStartTime = null;
    this._panelPageEventsBound = false;

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

  /**
   * 初始化 Panel 頁面（載入所需腳本並呼叫完成流程）
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("PanelPageManager 開始初始化");

      this.startStage(this.initStages.MODULES_INIT);
      await this.initializeModules();
      this.endStage();

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
  * 初始化模組
   */
  async initializeModules() {
    await this.onInitializationComplete();
  }

  /**
   * 完成腳本載入後建立實驗模組並初始化 UI
   */
  async onInitializationComplete() {
    const initStart = performance.now();
    Logger.debug("所有腳本載入完成，開始初始化面板與實驗模組");

    const managerInitStart = performance.now();
    await initializePanelManagers(this);
    Logger.debug(
      `Panel: 管理器初始化完成 (<orange>${(performance.now() - managerInitStart).toFixed(0)} ms</orange>)`,
    );

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
    this.experimentFlowManager.updateDependencies({
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
    this._setupExperimentEventListeners();
    this._bindPanelPageEvents();
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
    const flowManager = this.experimentFlowManager;

    flowManager.on(ExperimentFlowManager.EVENT.STARTED, async (data) => {
      this.panelUIManager?.closeAllPanels();
      Logger.debug("Panel: 收到實驗開始事件，開始載入動作序列");
      await this._handleExperimentStarted(data);
    });

    this.panelSyncManager.bindExperimentBroadcast(flowManager);
    this.panelLogger.bindExperimentEvents(flowManager);

    flowManager.on(ExperimentFlowManager.EVENT.STOPPED, (data) => {
      Logger.debug("Panel: 收到實驗停止事件，清理按鈕狀態");
      this._handleExperimentStopped();
      this._handleExperimentSystemFlowStopped(data);
    });

    flowManager.on(ExperimentFlowManager.EVENT.COMPLETED, (data) => {
      const powerOptions = this._getPowerOptionsForCurrentCombination();
      const reason = powerOptions.includeShutdown ? "power_off" : "completed";
      Logger.debug("Panel: 收到實驗完成事件，清理按鈕狀態", {
        reason,
      });
      this._handleExperimentStopped();
      this._handleExperimentSystemFlowStopped({
        reason,
        completedUnits: data?.completedUnits,
        timestamp: data?.timestamp,
      });
    });

    this.experimentActionHandler.on(
      ExperimentActionHandler.EVENT.ACTION_ENTERED,
      (data) => {
        Logger.debug("Panel: 新步驟已進入，更新媒體顯示", {
          actionId: data.actionId,
        });
        // 令 ButtonManager 更新媒體顯示並重刷下一個動作的高亮
        this.buttonManager?.updateMediaForCurrentAction?.();
      },
    );

    this.experimentActionHandler.on(
      ExperimentActionHandler.EVENT.SEQUENCE_COMPLETED,
      async () => {
        Logger.debug("Panel: ActionHandler 序列完成，檢查是否推進下一個單元");
        await this._handleSequenceCompletedForUnitProgression();
      },
    );

    Logger.debug("Panel: 已設定頁面特定的實驗事件監聽器");
  }

  _bindPanelPageEvents() {
    if (this._panelPageEventsBound) return;

    this._panelPageEventsBound = true;
  }

  _getPowerOptionsForCurrentCombination() {
    const combo =
      this.experimentCombinationManager?.getCurrentCombination?.() ||
      this.experimentSystemManager?.state?.currentCombination ||
      null;
    const powerOptions = combo?.powerOptions || {};
    return {
      includeStartup:
        typeof powerOptions.includeStartup === "boolean"
          ? powerOptions.includeStartup
          : true,
      includeShutdown:
        typeof powerOptions.includeShutdown === "boolean"
          ? powerOptions.includeShutdown
          : true,
    };
  }

  /**
   * 處理實驗開始事件：載入動作序列並通知相關管理器
   * @private
   */
  async _handleExperimentStarted(data) {
    const unitIds = data.units;
    const powerOptions = this._getPowerOptionsForCurrentCombination();

    // 若包含關機步驟，延後流程完成，避免未關機就結束
    this.experimentFlowManager?.setDeferCompletion?.(
      Boolean(powerOptions.includeShutdown),
    );

    if (powerOptions.includeStartup) {
      this.powerControl?.ensurePowerOffForExperimentStart();
    }

    const isPowerOn = this.powerControl.isPowerOn;

    Logger.debug(
      `[實驗開始] 電源狀態: ${isPowerOn ? "已開啟" : "未開啟"} | 單元: ${unitIds.join(", ")}`,
    );

    if (unitIds.length === 0) {
      Logger.warn("沒有可用的單元 ID，無法載入動作序列");
      return;
    }

    const systemManager = this.experimentSystemManager;
    const allUnits = systemManager.state.scriptData.units || [];

    const unitIdToLoad = unitIds[0];

    const firstUnitToLoad = allUnits.find(
      (unit) => unit.unit_id === unitIdToLoad,
    );

    if (!firstUnitToLoad) {
      Logger.warn(`找不到單元 ID: ${unitIdToLoad} 的對應單元資料`);
      return;
    }

    await this._loadUnitActionsToActionHandler(firstUnitToLoad, {
      includeStartup: powerOptions.includeStartup,
      includeShutdown: powerOptions.includeShutdown,
      isFirstUnit: true,
      isLastUnit: unitIds.length === 1,
    });
    this._notifyButtonManagerForActions(firstUnitToLoad);
    this.panelUIManager.setExperimentPanelButtonColor("running");

    Logger.debug("實驗開始處理完成，已載入動作序列並通知管理器");
  }

  /**
   * 載入單元動作序列到 ActionHandler
   * @private
   */
  async _loadUnitActionsToActionHandler(unit, options = {}) {
    const actionHandler = this.experimentActionHandler;
    const {
      includeStartup = false,
      includeShutdown = false,
      isFirstUnit = false,
      isLastUnit = false,
    } = options;
    const allUnits = this.experimentSystemManager?.state?.scriptData?.units || [];
    const actions = buildActionSequenceFromUnits(
      [unit.unit_id],
      this.actionsMap,
      allUnits,
      {
        includeStartup: includeStartup && isFirstUnit,
        includeShutdown: includeShutdown && isLastUnit,
      },
    );

    if (actions.length === 0) {
      Logger.warn(`單元 ${unit.unit_id} 沒有動作序列`);
      return false;
    }

    const success = actionHandler.initializeSequence(actions);

    if (!success) {
      Logger.error(`無法初始化單元 ${unit.unit_id} 的動作序列`);
      return false;
    }

    const actionToStepMap = new Map();
    if (includeStartup && isFirstUnit) {
      actionToStepMap.set(ACTION_IDS.POWER_ON, {
        unit_id: unit.unit_id,
        step_id: "POWER_STARTUP",
        step_name: "電源開機",
        isLastActionInStep: true,
      });
    }
    (unit.steps || []).forEach((step) => {
      (step.actions || []).forEach((action, actionIndex) => {
        const actionId = action.action_id || action.actionId;
        if (actionId) {
          actionToStepMap.set(actionId, {
            unit_id: unit.unit_id,
            step_id: step.step_id,
            step_name: step.step_name,
            isLastActionInStep: actionIndex === step.actions.length - 1,
          });
        }
      });
    });
    if (includeShutdown && isLastUnit) {
      actionToStepMap.set(ACTION_IDS.POWER_OFF, {
        unit_id: unit.unit_id,
        step_id: "POWER_SHUTDOWN",
        step_name: "電源關機",
        isLastActionInStep: true,
      });
    }

    actionHandler.actionToStepMap = actionToStepMap;

    if (includeStartup && isFirstUnit) {
      this.powerControl?.syncPowerActionWithState();
    }

    this.buttonManager?.updateMediaForCurrentAction?.();

    Logger.debug("動作序列已載入到 ActionHandler", {
      unitId: unit.unit_id,
      actionCount: actions.length,
      stepMapSize: actionToStepMap.size,
    });
    return true;
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

    this.buttonManager.on("button:action-clicked", (data) => {
      this._handleButtonActionClick(data);
    });
    Logger.debug("ButtonManager 事件監聽器已設定");
  }

  /**
   * 通知按鈕管理器更新動作狀態
   * @private
   */
  _notifyButtonManagerForActions(unit) {
    const allActions = (unit.steps || []).flatMap((step) => step.actions || []);

    if (allActions.length === 0) {
      Logger.warn("沒有動作需要通知按鈕管理器");
      return;
    }

    const actionData = allActions.map((action, index) => ({
      actionId: action.action_id || action.actionId || `action_${index}`,
      buttonId: action.action_buttons || `B${index + 1}`,
      action: action,
    }));

    // 直接同步通知一次，避免初始化時事件監聽器尚未完成綁定而漏掉刷新
    this.buttonManager.handleExperimentActionsLoaded?.({
      actions: actionData,
      unit,
    });

    Logger.debug(`已通知 ButtonManager 載入 ${allActions.length} 個動作`);
  }

  /**
   * 處理按鈕動作點擊事件（從 ButtonManager 接收）
   * @private
   */
  _handleButtonActionClick(data) {
    const { buttonId, actionId, action } = data;

    Logger.debug(`處理按鈕動作點擊: ${buttonId}`, { actionId, action });

    const validation = this.experimentActionHandler.validateAction(actionId, {
      buttonId,
      timestamp: Date.now(),
    });

    if (validation.valid) {
      this.experimentActionHandler.handleCorrectAction(actionId, {
        buttonId,
        timestamp: Date.now(),
      });

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

    if (
      this.panelMediaManager &&
      typeof this.panelMediaManager.playSound === "function"
    ) {
      this.panelMediaManager.playSound("experimentEnd");
      Logger.debug("Panel: 已播放實驗結束音效");
    }

    if (data?.reason === "power_off" && this.panelLogger?.exportLog) {
      this.panelLogger.exportLog();
      Logger.debug("Panel: 關機結束實驗，已自動匯出日誌");
    }
    Logger.debug("Panel: 實驗系統停止後續邏輯已完成");
  }

  /**
   * 處理動作序列完成時的單元推進邏輯
   * 當 ActionHandler 發出 SEQUENCE_COMPLETED 事件時呼叫
   * @private
   */
  async _handleSequenceCompletedForUnitProgression() {
    const systemManager = this.experimentSystemManager;
    const powerOptions = this._getPowerOptionsForCurrentCombination();
    const beforeProgress = systemManager.getFlowProgressSnapshot();

    if (beforeProgress.isLastUnit) {
      Logger.debug("Panel: 所有單元已完成");
      return;
    }

    Logger.debug("Panel: 推進到下一個單元");
    systemManager.advanceToNextUnit();

    const afterProgress = systemManager.getFlowProgressSnapshot();
    const nextUnitId = afterProgress.unitIds[afterProgress.currentUnitIndex];
    const allUnits = systemManager.state.scriptData.units || [];
    const nextUnit = allUnits.find((unit) => unit.unit_id === nextUnitId);

    if (!nextUnit) {
      Logger.warn(`找不到單元 ID: ${nextUnitId} 的對應單元資料`);
      return;
    }

    await this._loadUnitActionsToActionHandler(nextUnit, {
      includeStartup: false,
      includeShutdown: powerOptions.includeShutdown,
      isFirstUnit: false,
      isLastUnit: afterProgress.isLastUnit,
    });
    this._notifyButtonManagerForActions(nextUnit);

    Logger.debug("Panel: 已推進到下一個單元並載入動作序列", {
      nextUnitId,
      actionCount: (nextUnit.steps || []).flatMap(
        (step) => step.actions || [],
      ).length,
    });
  }

  /**
   * 更新全選複選框的狀態
   */
  updateSelectAllState() {
    this.uiManager.updateSelectAllState();
  }
};

// 自動初始化頁面（當 DOM 完全載入時）
const panelPageManager = new PanelPageManager();

const initializePanel = async () => {
  await panelPageManager.initialize();
  Logger.info("Panel 頁面已自動初始化");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePanel);

} else {

  initializePanel();

}
