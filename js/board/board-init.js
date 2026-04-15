/**
 * BoardInit - board 管理器初始化協調
 */

import { experimentSyncManager } from "./board-sync-manager.js";
import { createBoardGestureUtils } from "./board-gesture-utils.js";
import { RecordManager as ExperimentLogManager, recordView as experimentLogUI } from "../record/index.js";
import { ConfigManager, getSharedConfig } from "../core/config.js";
import { SyncManager } from "../sync/sync-manager.js";
import { ExperimentSyncCore } from "../sync/experiment-sync-manager.js";
import { ExperimentCombinationManager } from "../experiment/experiment-combination-manager.js";
import {
  initExperimentFlowManager,
  initExperimentUIManager,
} from "../experiment/experiment-init-utils.js";
import { ExperimentStateManager } from "../experiment/experiment-state-manager.js";
import { ExperimentHubManager } from "../experiment/experiment-hub-manager.js";
import { ExperimentSystemManager } from "../experiment/experiment-system-manager.js";
import { ExperimentTimerManager } from "../experiment/experiment-timer.js";

export async function initializeBoardManagers(page) {
  const initStart = performance.now();
  const logInitDuration = (label, start) => {
    const duration = performance.now() - start;
    Logger.debug(`${label} (<orange>${duration.toFixed(0)} ms</orange>)`);
  };

  try {
    if (!page.syncManager) {
      const syncStart = performance.now();
      page.syncManager = new SyncManager();
      logInitDuration("Board: SyncManager 已初始化", syncStart);
    }

    if (!page.experimentSyncCore) {
      const syncCoreStart = performance.now();
      page.experimentSyncCore = new ExperimentSyncCore();
      page.experimentSyncCore.updateDependencies?.({
        syncManager: page.syncManager,
        syncClient: page.syncManager?.core?.syncClient,
      });
      logInitDuration("ExperimentSyncCore 已初始化", syncCoreStart);
    }

    experimentSyncManager.updateDependencies({
      syncManager: page.syncManager,
      syncClient: page.syncManager?.core?.syncClient,
      experimentSyncCore: page.experimentSyncCore,
      experimentHubManager: page.experimentHubManager,
    });

    if (!page.configManager) {
      const configStart = performance.now();
      page.configManager = new ConfigManager();
      await page.configManager.loadConfigSettings();
      logInitDuration("ConfigManager 已初始化", configStart);
    }

    if (!page.experimentHubManager) {
      page.experimentHubManager = new ExperimentHubManager({
        syncManager: page.syncManager,
        syncClient: page.syncManager?.core?.syncClient,
        experimentSyncCore: page.experimentSyncCore,
        roleConfig: page.syncManager?.constructor?.ROLE || {
          VIEWER: "viewer",
        },
      });
    }

    if (page.experimentHubManager?.updateDependencies) {
      page.experimentHubManager.updateDependencies({
        syncManager: page.syncManager,
        syncClient: page.syncManager?.core?.syncClient,
        experimentSyncCore: page.experimentSyncCore,
        roleConfig: page.syncManager?.constructor?.ROLE || {
          VIEWER: "viewer",
        },
      });
    }

    page.syncManager.updateDependencies({
      experimentHubManager: page.experimentHubManager,
    });

    experimentSyncManager.updateDependencies({
      experimentHubManager: page.experimentHubManager,
    });

    if (!page.experimentCombinationManager) {
      page.experimentCombinationManager = new ExperimentCombinationManager();
    }

    if (page.experimentCombinationManager?.updateDependencies) {
      page.experimentCombinationManager.updateDependencies({
        hubManager: page.experimentHubManager,
        syncManager: page.syncManager,
        syncClient: page.syncManager?.core?.syncClient,
        experimentSyncCore: page.experimentSyncCore,
      });
    }

    if (!page.experimentFlowManager) {
      const flowStart = performance.now();
      page.experimentFlowManager = initExperimentFlowManager({
        combinationManager: page.experimentCombinationManager,
        hubManager: page.experimentHubManager,
        actionHandler: page.experimentActionHandler,
        actionsMap: page.actionsMap || null,
        unitsData: page.unitsData || null,
      });
      logInitDuration("ExperimentFlowManager 已初始化", flowStart);
    }

    const stateStart = performance.now();
    page.experimentStateManager = new ExperimentStateManager({
      timeSyncManager: page.syncManager?.core?.timeSyncManager,
      experimentHubManager: page.experimentHubManager,
    });
    logInitDuration("ExperimentStateManager 已初始化", stateStart);

    if (!page.experimentLogManager) {
      const logStart = performance.now();
      page.experimentLogManager = new ExperimentLogManager({
        timeSyncManager: page.syncManager?.core?.timeSyncManager,
        stateManager: page.experimentStateManager,
      });
      page.experimentLogManager.updateDependencies?.({
        syncClient: page.syncManager?.core?.syncClient,
      });
      logInitDuration("ExperimentLogManager 已初始化", logStart);
    }

    page.experimentStateManager.updateDependencies({
      experimentLogManager: page.experimentLogManager,
    });

    if (!page.timerManager) {
      page.timerManager = new ExperimentTimerManager({
        timeSyncManager: page.syncManager?.core?.timeSyncManager,
        experimentLogManager: page.experimentLogManager,
        getCurrentCombination: () => page.currentCombination,
      });
    }

    if (!page.uiManager) {
      const uiStart = performance.now();
      page.uiManager = initExperimentUIManager({
        timerManager: page.timerManager,
        flowManager: page.experimentFlowManager,
        combinationManager: page.experimentCombinationManager,
        hubManager: page.experimentHubManager,
        syncManager: page.syncManager,
        syncClient: page.syncManager?.core?.syncClient,
        experimentSyncCore: page.experimentSyncCore,
        panelUIManager: null,
      });
      logInitDuration("ExperimentUIManager 已初始化", uiStart);
    }

    if (!page.gestureUtils) {
      page.gestureUtils = createBoardGestureUtils({
        pageManager: page,
        timerManager: page.timerManager,
        syncClient: page.syncManager?.core?.syncClient,
        syncCore: page.experimentSyncCore,
        logger: Logger,
        experimentLogManager: page.experimentLogManager,
      });
    }

    if (experimentLogUI) {
      const uiLogStart = performance.now();
      experimentLogUI.updateDependencies({
        logManager: page.experimentLogManager,
        timeSyncManager: page.syncManager?.core?.timeSyncManager,
        config: getSharedConfig(),
        getGesturesData: () => page.gesturesData,
        getCombination: () => page.currentCombination,
        syncLogsNow: () => page.experimentLogManager?.flushAll?.(),
      });
      if (!experimentLogUI._initialized) {
        experimentLogUI.initialize();
      }
      logInitDuration("RecordView 已初始化", uiLogStart);
    }

    page._setupEventListeners();

    const systemStart = performance.now();
    const instance = new ExperimentSystemManager({
      combinationManager: page.experimentCombinationManager,
      uiManager: page.uiManager,
      hubManager: page.experimentHubManager,
      flowManager: page.experimentFlowManager,
      timerManager: page.timerManager,
      pageManager: page,
      experimentLogManager: page.experimentLogManager,
    });
    await instance.initialize();
    page.experimentSystemManager = instance;
    page.experimentActionHandler = instance.actionHandler;
    logInitDuration("系統管理器已初始化", systemStart);

    // 在系統管理器初始化完成後，補充 RecordManager 的執行期 getter
    page.experimentLogManager.updateDependencies?.({
      view: experimentLogUI,
      getGestures: (idx) =>
        page.currentCombination?.gestures?.[idx] ||
        page.experimentSystemManager?.state?.gestures?.[idx],
      getGesturesData: () => page.gesturesData,
      getCombination: () => page.currentCombination,
    });

    logInitDuration("所有管理器已初始化", initStart);
  } catch (error) {
    Logger.error("初始化模組失敗:", error);
    throw error;
  }
}
