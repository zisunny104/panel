/**
 * DataLoader - 從 scenarios.json 載入資料
 *
 * 從 scenarios.json 載入實驗資料
 */

/**
 * 從 scenarios.json 載入實驗資料
 * @returns {Promise<{units: Array, unit_combinations: Array, actions: Map, actionToStep: Map}>}
 */
async function loadUnitsFromScenarios() {
  try {
    const response = await fetch("./data/scenarios.json");
    const scenariosData = await response.json();

    const unitsMap = new Map();
    const actionsMap = new Map(); // action_id -> action 物件
    const actionToStepMap = new Map(); // action_id -> { unit_id, step_id, step_name }

    // 從 sections 中提取所有單元和actions
    if (scenariosData.sections && Array.isArray(scenariosData.sections)) {
      scenariosData.sections.forEach((section) => {
        if (section.units && Array.isArray(section.units)) {
          section.units.forEach((unit) => {
            if (!unitsMap.has(unit.unit_id)) {
              const processedSteps = (unit.steps || []).map((step) => {
                // 提取這個步驟下的所有 actions
                if (step.actions && Array.isArray(step.actions)) {
                  step.actions.forEach((action, actionIndex) => {
                    // 標記是否為該 step 的最後一個 action
                    action.isLastActionInStep =
                      actionIndex === step.actions.length - 1;

                    actionsMap.set(action.action_id, action);
                    actionToStepMap.set(action.action_id, {
                      unit_id: unit.unit_id,
                      step_id: step.step_id,
                      step_name: step.step_name,
                      isLastActionInStep: action.isLastActionInStep
                    });
                  });
                }
                return {
                  step_id: step.step_id,
                  step_name: step.step_name,
                  actions: step.actions || []
                };
              });

              unitsMap.set(unit.unit_id, {
                unit_id: unit.unit_id,
                unit_name: unit.unit_name,
                steps: processedSteps
              });
            }
          });
        }
      });
    }

    return {
      units: Array.from(unitsMap.values()),
      unit_combinations: scenariosData.unit_combinations || [],
      actions: actionsMap,
      actionToStep: actionToStepMap
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
function buildActionSequenceFromUnits(unitIds, actionsMap, unitsData) {
  return unitIds
    .map((unitId) => unitsData.find((u) => u.unit_id === unitId))
    .filter((unit) => unit)
    .flatMap((unit) =>
      unit.steps
        .filter((step) => step.actions && Array.isArray(step.actions))
        .flatMap((step) => step.actions)
    );
}

export { loadUnitsFromScenarios, buildActionSequenceFromUnits };

// 為了向後相容性，也將函數新增到全域範圍
window.loadUnitsFromScenarios = loadUnitsFromScenarios;
window.buildActionSequenceFromUnits = buildActionSequenceFromUnits;





