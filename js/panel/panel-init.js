import { MediaManager } from "./panel-media-manager.js";
import { PowerControl } from "./panel-power-control.js";
import { PanelLogger } from "./panel-logger.js";
import { Logger } from "../core/console-manager.js";
import { ExperimentSyncCore } from "../sync/experiment-sync-core.js";
import { PanelUIManager } from "./panel-ui-manager.js";
import { PanelSyncManager } from "./panel-sync-manager.js";
import { ConfigManager } from "../core/config.js";
import { experimentSyncManager } from "../board/board-experiment-sync.js";
import { ExperimentHubManager } from "../experiment/experiment-hub-manager.js";
import { ExperimentCombinationManager } from "../experiment/experiment-combination-manager.js";
import { ExperimentStateManager } from "../experiment/experiment-state-manager.js";
import { ExperimentTimerManager } from "../experiment/experiment-timer.js";
import { ExperimentFlowManager } from "../experiment/experiment-flow-manager.js";
import { ExperimentUIManager } from "../experiment/experiment-ui-manager.js";
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
    experimentCombinationManager: page.experimentCombinationManager,
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
  page.experimentCombinationManager.on(
    ExperimentCombinationManager.EVENT.COMBINATION_SELECTED,
    (data) => page.panelMediaManager.onCombinationSelected(data),
  );

  if (!page.timerManager) {
    const timerStart = performance.now();
    page.timerManager = new ExperimentTimerManager({
      timeSyncManager: page.syncManager?.core?.timeSyncManager,
      stateManager: page.experimentStateManager,
      getCurrentCombination: () =>
        page.experimentCombinationManager?.getCurrentCombination?.() || null,
    });
    logInitDuration("ExperimentTimerManager 已初始化", timerStart);
  }

  const flowStart = performance.now();
  page.experimentFlowManager = new ExperimentFlowManager({
    combinationManager: page.experimentCombinationManager,
    hubManager: page.experimentHubManager,
    stateManager: page.experimentStateManager,
  });
  logInitDuration("ExperimentFlowManager 已初始化", flowStart);
  page.panelMediaManager.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
  });

  const uiStart = performance.now();
  page.uiManager = new ExperimentUIManager({ timerManager: page.timerManager });
  page.uiManager.initialize();
  page.uiManager.injectFlowManager(page.experimentFlowManager);
  page.uiManager.updateDependencies({
    combinationManager: page.experimentCombinationManager,
    hubManager: page.experimentHubManager,
    syncManager: page.syncManager,
    syncClient: page.syncManager?.core?.syncClient,
    experimentSyncCore: page.experimentSyncCore,
  });
  logInitDuration("ExperimentUIManager 已初始化", uiStart);
  page.panelUIManager.updateDependencies({
    uiManager: page.uiManager,
  });

  const systemStart = performance.now();
  page.experimentSystemManager?.cleanup();
  page.experimentSystemManager = new ExperimentSystemManager({
    combinationManager: page.experimentCombinationManager,
    uiManager: page.uiManager,
    hubManager: page.experimentHubManager,
    flowManager: page.experimentFlowManager,
    timerManager: page.timerManager,
    pageManager: page,
  });
  await page.experimentSystemManager.initialize();
  logInitDuration("ExperimentSystemManager 已初始化", systemStart);

  page.uiManager.updateDependencies({
    experimentSystemManager: page.experimentSystemManager,
  });
  page.uiManager.bindStateManagerInputs(page.experimentStateManager);

  page.experimentActionHandler = page.experimentSystemManager.actionHandler;
  if (!page.experimentActionHandler) {
    throw new Error("ExperimentActionHandler 未初始化");
  }

  page.panelSyncManager.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
    experimentSystemManager: page.experimentSystemManager,
    experimentCombinationManager: page.experimentCombinationManager,
  });
  page.panelLogger.updateDependencies({
    experimentFlowManager: page.experimentFlowManager,
    experimentActionHandler: page.experimentActionHandler,
    experimentSystemManager: page.experimentSystemManager,
  });

  logInitDuration("Panel 管理器初始化與依賴注入完成", initStart);
}
