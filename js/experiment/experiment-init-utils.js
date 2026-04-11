import { ExperimentFlowManager } from "./experiment-flow-manager.js";
import { ExperimentUIManager } from "./experiment-ui-manager.js";

const initExperimentFlowManager = ({
  combinationManager,
  hubManager,
  actionHandler = null,
  actionsMap = null,
  unitsData = null,
} = {}) => {
  if (!combinationManager) {
    throw new Error("ExperimentFlowManager requires combinationManager");
  }
  if (!hubManager) {
    throw new Error("ExperimentFlowManager requires hubManager");
  }

  const flowManager = new ExperimentFlowManager();
  flowManager.injectCombinationManager(combinationManager);
  flowManager.injectHubManager(hubManager);
  if (actionHandler) {
    flowManager.injectActionHandler(actionHandler);
  }
  flowManager.updateDependencies?.({ actionsMap, unitsData });
  return flowManager;
};

const initExperimentUIManager = ({
  timerManager,
  flowManager,
  combinationManager,
  hubManager,
  syncManager,
  syncClient,
  experimentSyncCore,
  panelUIManager = null,
  enableVisualHints = true,
  debug = false,
} = {}) => {
  if (!timerManager) {
    throw new Error("ExperimentUIManager requires timerManager");
  }
  if (!flowManager) {
    throw new Error("ExperimentUIManager requires flowManager");
  }

  const uiManager = new ExperimentUIManager({
    enableVisualHints,
    debug,
    timerManager,
  });
  uiManager.initialize();
  uiManager.injectFlowManager(flowManager);
  uiManager.updateDependencies({
    combinationManager,
    hubManager,
    syncManager,
    syncClient,
    experimentSyncCore,
    panelUIManager,
  });
  return uiManager;
};

export { initExperimentFlowManager, initExperimentUIManager };
