import { MediaManager } from "./panel-media-manager.js";
import { PowerControl } from "./panel-power-control.js";
import { PanelLogger } from "./panel-logger.js";
import { ExperimentSyncCore } from "../sync/experiment-sync-manager.js";
import { PanelUIManager } from "./panel-ui-manager.js";
import { PanelSyncManager } from "./panel-sync-manager.js";
import { ConfigManager } from "../core/config.js";
import { experimentSyncManager } from "../board/board-sync-manager.js";
import { ExperimentHubManager } from "../experiment/experiment-hub-manager.js";
import { ExperimentCombinationManager } from "../experiment/experiment-combination-manager.js";
import { ExperimentStateManager } from "../experiment/experiment-state-manager.js";
import { ExperimentTimerManager } from "../experiment/experiment-timer.js";
import {
  initExperimentFlowManager,
  initExperimentUIManager,
} from "../experiment/experiment-init-utils.js";
import { SyncManager } from "../sync/sync-manager.js";
import { ExperimentSystemManager } from "../experiment/experiment-system-manager.js";

/**
 * 集中初始化 Panel 端管理器與依賴注入
 * @param {object} page PanelPageManager 實例
 */
export async function initializePanelManagers(page) {
  const initStart = performance.now();
  const logInitDuration = (label, start) => {
    const duration = performance.now() - start;
    Logger.debug(`${label} (<orange>${duration.toFixed(0)} ms</orange>)`);
  };

  const configStart = performance.now();
  page.configManager = new ConfigManager();
  await page.configManager.loadConfigSettings();
  logInitDuration("ConfigManager 已初始化", configStart);

  const panelUIStart = performance.now();
  page.panelUIManager = new PanelUIManager({
    configManager: page.configManager,
  });
  logInitDuration("PanelUIManager 已初始化", panelUIStart);
  page.configManager?.updateDependencies?.({ panelUIManager: page.panelUIManager });

  const powerStart = performance.now();
  page.powerControl = new PowerControl();
  logInitDuration("PowerControl 已初始化", powerStart);

  const mediaStart = performance.now();
  page.panelMediaManager = new MediaManager({
    panelUIManager: page.panelUIManager,
    powerControl: page.powerControl,
    experimentFlowManager: page.experimentFlowManager,
    configManager: page.configManager,
  });
  logInitDuration("PanelMediaManager 已初始化", mediaStart);
  page.panelUIManager.updateDependencies({
    panelMediaManager: page.panelMediaManager,
  });

  const syncStart = performance.now();
  page.syncManager = new SyncManager();
  logInitDuration("SyncManager 已初始化", syncStart);
  page.panelMediaManager.updateDependencies({
    syncClient: page.syncManager.core?.syncClient,
    timeSyncManager: page.syncManager.core?.timeSyncManager,
  });

  const loggerStart = performance.now();
  page.panelLogger = new PanelLogger({
    timeSyncManager: page.syncManager.core?.timeSyncManager,
    syncClient: page.syncManager.core?.syncClient,
    syncManager: page.syncManager,
    panelMediaManager: page.panelMediaManager,
  });
  logInitDuration("PanelLogger 已初始化", loggerStart);
  page.panelUIManager.updateDependencies({
    logger: page.panelLogger,
  });
  page.panelMediaManager.updateDependencies({
    logger: page.panelLogger,
  });

  const syncCoreStart = performance.now();
  page.experimentSyncCore = new ExperimentSyncCore();
  page.experimentSyncCore.updateDependencies({
    syncManager: page.syncManager,
    syncClient: page.syncManager?.core?.syncClient,
  });
  experimentSyncManager.updateDependencies({
    syncManager: page.syncManager,
    syncClient: page.syncManager.core?.syncClient,
    experimentSyncCore: page.experimentSyncCore,
  });
  logInitDuration("ExperimentSyncCore 已初始化", syncCoreStart);

  const panelSyncStart = performance.now();
  page.panelSyncManager = new PanelSyncManager({
    logger: page.panelLogger,
    experimentSyncCore: page.experimentSyncCore,
    syncClient: page.syncManager.core?.syncClient,
    experimentFlowManager: page.experimentFlowManager,
    experimentSystemManager: page.experimentSystemManager,
    experimentActionHandler: page.experimentActionHandler,
    experimentCombinationManager: page.experimentCombinationManager,
    powerControl: page.powerControl,
  });
  await page.panelSyncManager.initialize();
  logInitDuration("PanelSyncManager 已初始化", panelSyncStart);

  const hubStart = performance.now();
  page.experimentHubManager = new ExperimentHubManager({
    syncManager: page.syncManager,
    syncClient: page.syncManager?.core?.syncClient,
    experimentSyncCore: page.experimentSyncCore,
    roleConfig: SyncManager.ROLE,
  });
  page.syncManager.updateDependencies({
    experimentHubManager: page.experimentHubManager,
  });
  logInitDuration("ExperimentHubManager 已初始化", hubStart);

  const stateStart = performance.now();
  page.experimentStateManager = new ExperimentStateManager({
    timeSyncManager: page.syncManager?.core?.timeSyncManager,
    experimentHubManager: page.experimentHubManager,
  });
  logInitDuration("ExperimentStateManager 已初始化", stateStart);

  const combinationStart = performance.now();
  page.experimentCombinationManager = new ExperimentCombinationManager();
  page.experimentCombinationManager.updateDependencies({
    hubManager: page.experimentHubManager,
    syncManager: page.syncManager,
    syncClient: page.syncManager?.core?.syncClient,
    experimentSyncCore: page.experimentSyncCore,
  });
  logInitDuration("ExperimentCombinationManager 已初始化", combinationStart);
  page.panelMediaManager.updateDependencies({
    experimentCombinationManager: page.experimentCombinationManager,
  });

  if (!page.timerManager) {
    const timerStart = performance.now();
    page.timerManager = new ExperimentTimerManager({
      timeSyncManager: page.syncManager?.core?.timeSyncManager,
      experimentLogManager: null,
      getCurrentCombination: () =>
        page.experimentCombinationManager?.getCurrentCombination?.() || null,
    });
    logInitDuration("ExperimentTimerManager 已初始化", timerStart);
  }

  const flowStart = performance.now();
  page.experimentFlowManager = initExperimentFlowManager({
    combinationManager: page.experimentCombinationManager,
    hubManager: page.experimentHubManager,
    actionHandler: page.experimentActionHandler,
  });
  logInitDuration("ExperimentFlowManager 已初始化", flowStart);
  page.panelMediaManager.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
  });

  const uiStart = performance.now();
  page.syncManager.updateDependencies({
    experimentHubManager: page.experimentHubManager,
  });
  page.uiManager = initExperimentUIManager({
    timerManager: page.timerManager,
    flowManager: page.experimentFlowManager,
    combinationManager: page.experimentCombinationManager,
    hubManager: page.experimentHubManager,
    syncManager: page.syncManager,
    syncClient: page.syncManager?.core?.syncClient,
    experimentSyncCore: page.experimentSyncCore,
    panelUIManager: page.panelUIManager,
  });
  logInitDuration("ExperimentUIManager 已初始化", uiStart);
  page.panelUIManager.updateDependencies({
    uiManager: page.uiManager,
  });

  const systemStart = performance.now();
  page.experimentSystemManager = new ExperimentSystemManager({
    combinationManager: page.experimentCombinationManager,
    uiManager: page.uiManager,
    hubManager: page.experimentHubManager,
    flowManager: page.experimentFlowManager,
    timerManager: page.timerManager,
    pageManager: page,
    experimentLogManager: null,
  });
  await page.experimentSystemManager.initialize();
  logInitDuration("ExperimentSystemManager 已初始化", systemStart);

  page.experimentActionHandler = page.experimentSystemManager.actionHandler;
  if (!page.experimentActionHandler) {
    throw new Error("ExperimentActionHandler 未初始化");
  }

  page.experimentActionHandler.disableAutoProgress();
  page.panelSyncManager.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
    experimentSystemManager: page.experimentSystemManager,
    experimentActionHandler: page.experimentActionHandler,
    experimentCombinationManager: page.experimentCombinationManager,
  });
  page.panelLogger.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
    experimentActionHandler: page.experimentActionHandler,
  });

  logInitDuration("Panel 管理器初始化與依賴注入完成", initStart);
}
