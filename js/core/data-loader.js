import { ACTION_IDS, ACTION_BUTTONS } from "../constants/action-constants.js";
import { Logger } from "./console-manager.js";

let scenariosDataCache = null;
let scenariosDataPromise = null;

/**
 * DataLoader - 讀取 scenarios.json（含快取）
 * @returns {Promise<Object>}
 */
async function loadScenariosData() {
  if (scenariosDataCache) return scenariosDataCache;
  if (scenariosDataPromise) return scenariosDataPromise;

  scenariosDataPromise = (async () => {
    const response = await fetch("./data/scenarios.json");
    if (!response.ok) {
      throw new Error("Failed to load scenarios.json");
    }
    const data = await response.json();
    scenariosDataCache = data;
    return data;
  })();

  return scenariosDataPromise;
}

/**
 * DataLoader - 從 scenarios.json 載入實驗資料
 * @returns {Promise<{units: Array, unit_combinations: Array, sections: Array, gestures: Array, actions: Map, actionToStep: Map}>}
 */
async function loadUnitsFromScenarios() {
  try {
    const scenariosData = await loadScenariosData();

    const unitsMap = new Map();
    const actionsMap = new Map(); // actionId -> action 物件
    const actionToStepMap = new Map(); // actionId -> { unit_id, step_id, step_name }

    // 從 sections 整理所有單元與 actions
    if (scenariosData.sections && Array.isArray(scenariosData.sections)) {
      scenariosData.sections.forEach((section) => {
        if (section.units && Array.isArray(section.units)) {
          section.units.forEach((unit) => {
            if (!unitsMap.has(unit.unit_id)) {
              const processedSteps = (unit.steps || []).map((step) => {
                // 收集這個步驟下的所有 actions
                if (step.actions && Array.isArray(step.actions)) {
                  step.actions.forEach((action, actionIndex) => {
                    // 標記是否為該 step 的最後一個 action
                    action.isLastActionInStep =
                      actionIndex === step.actions.length - 1;

                    // 確保使用正確的字段名稱 (action_id -> actionId)
                    const actionId = action.action_id || action.actionId;
                    if (actionId) {
                      // 將 action_id 轉換為 actionId 以保持一致性
                      action.actionId = actionId;
                      actionsMap.set(actionId, action);
                      actionToStepMap.set(actionId, {
                        unit_id: unit.unit_id,
                        step_id: step.step_id,
                        step_name: step.step_name,
                        isLastActionInStep: action.isLastActionInStep,
                      });
                    } else {
                      Logger.warn("動作缺少 action_id 或 actionId:", action);
                    }
                  });
                }
                return {
                  step_id: step.step_id,
                  step_name: step.step_name,
                  actions: step.actions || [],
                };
              });

              unitsMap.set(unit.unit_id, {
                unit_id: unit.unit_id,
                unit_name: unit.unit_name,
                steps: processedSteps,
              });
            }
          });
        }
      });
    }

    // 轉換 unit_combinations 欄位名稱為駝峰式
    const unitCombinations = (scenariosData.unit_combinations || []).map(
      (c) => ({
        ...c,
        combinationId: c.combination_id,
        combinationName: c.combination_name,
      }),
    );

    return {
      units: Array.from(unitsMap.values()),
      unit_combinations: unitCombinations,
      sections: scenariosData.sections || [],
      gestures: scenariosData.gesture_list || [],
      actions: actionsMap,
      actionToStep: actionToStepMap,
    };
  } catch (error) {
    Logger.error("載入 scenarios.json 失敗:", error);
    throw error;
  }
}

/**
 * 從指定單元組合建立 action 序列
 * @param {Array} unitIds - 單元 ID 陣列
 * @param {Map} actionsMap - actions 映射
 * @param {Array} unitsData - 單元資料陣列
 * @returns {Array} action 流程陣列
 */
function buildActionSequenceFromUnits(unitIds, actionsMap, unitsData, options = {}) {
  const startupCheckbox = document.getElementById("includeStartup");
  const shutdownCheckbox = document.getElementById("includeShutdown");
  const includeStartup =
    options.includeStartup ??
    (startupCheckbox ? startupCheckbox.checked : true);
  const includeShutdown =
    options.includeShutdown ??
    (shutdownCheckbox ? shutdownCheckbox.checked : true);

  const baseSequence = unitIds
    .map((unitId) => unitsData.find((u) => u.unit_id === unitId))
    .filter((unit) => unit)
    .flatMap((unit) =>
      unit.steps
        .filter((step) => step.actions && Array.isArray(step.actions))
        .flatMap((step) => step.actions),
    );

  const sequence = [...baseSequence];

  if (includeStartup) {
    sequence.unshift({
      action_id: ACTION_IDS.POWER_ON,
      actionId: ACTION_IDS.POWER_ON,
      action_name: "電源開機",
      action_buttons: ACTION_BUTTONS.POWER_ON,
      media_file: null,
      interactions: { [ACTION_BUTTONS.POWER_ON]: { next_action_id: null } },
    });
  }

  if (includeShutdown) {
    sequence.push({
      action_id: ACTION_IDS.POWER_OFF,
      actionId: ACTION_IDS.POWER_OFF,
      action_name: "電源關機",
      action_buttons: ACTION_BUTTONS.POWER_OFF,
      media_file: null,
      interactions: { [ACTION_BUTTONS.POWER_OFF]: { next_action_id: null } },
    });
  }

  return sequence;
}

export { loadScenariosData, loadUnitsFromScenarios, buildActionSequenceFromUnits };
