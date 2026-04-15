/**
 * ExperimentScriptBuilder - 建立 board 端手勢序列腳本
 */

export function buildBoardGestureScript({
  combination,
  experimentId,
  scenariosData,
  unitIds,
  actionIds,
  actionButtons,
}) {
  const script = {
    combinationId: combination.combinationId,
    combinationName: combination.combinationName,
    description: combination.description,
    experimentId,
    unitsSequence: [],
    gestures: [],
  };

  if (!scenariosData || !scenariosData.sections) {
    return { script, hasScenarioSections: false };
  }

  const gestureList = scenariosData.gesture_list || [];
  const section = scenariosData.sections?.[0];
  const findGesture = (gestureId) =>
    gestureList.find((g) => g.gesture_id === gestureId);

  const confirmGesture = findGesture("confirm");
  const nextGesture = findGesture("next");
  const prevGesture = findGesture("prev");
  const openGesture = findGesture("open");

  const powerOptions = combination?.powerOptions || {};
  const includeStartup =
    typeof powerOptions.includeStartup === "boolean"
      ? powerOptions.includeStartup
      : true;
  const includeShutdown =
    typeof powerOptions.includeShutdown === "boolean"
      ? powerOptions.includeShutdown
      : true;

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
    const firstUnit = section.units.find((u) => u.unit_id === firstUnitId);
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
        step_name: step0.step_name || `確認進入「${firstUnit.unit_name}」`,
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
      const reloadGesture = findGesture("reload");
      if (reloadGesture) {
        script.gestures.push({
          step: script.gestures.length + 1,
          gesture: "reload",
          name: reloadGesture.gesture_name,
          description: reloadGesture.gesture_description,
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
        const gesture = findGesture(gestureId);
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
      const nextUnit = section.units.find((u) => u.unit_id === nextUnitId);

      if (unitIdx === 0) {
        const zoomInGesture = findGesture("zoom_in");
        if (zoomInGesture) {
          script.gestures.push({
            step: script.gestures.length + 1,
            gesture: "zoom_in",
            name: zoomInGesture.gesture_name,
            description: zoomInGesture.gesture_description,
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

      const currentIdxInJson = section.units.findIndex((u) => u.unit_id === unitId);
      const nextIdxInJson = section.units.findIndex((u) => u.unit_id === nextUnitId);
      const dist = nextIdxInJson - currentIdxInJson;
      const navGesture = dist > 0 ? nextGesture : prevGesture;

      if (navGesture && dist !== 0) {
        script.gestures.push({
          step: script.gestures.length + 1,
          gesture: navGesture.gesture_id,
          name: navGesture.gesture_name,
          description: navGesture.gesture_description,
          reason: `[${dist > 0 ? "num6" : "num4"}] x${Math.abs(dist)} | 導航至「${nextUnit.unit_name}」 | ${unitId} -> ${nextUnitId}`,
          step_id: `UNIT_NAV_${unitId}_TO_${nextUnitId}`,
          step_name: `單元列表導航 ([${dist > 0 ? "num6" : "num4"}] x${Math.abs(dist)})`,
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
          step_name: nextStep0.step_name || `確認進入「${nextUnit.unit_name}」`,
          actions: nextStep0.actions || [],
        });
      }
    }
  });

  const zoomOutGesture = findGesture("zoom_out");
  if (zoomOutGesture) {
    script.gestures.push({
      step: script.gestures.length + 1,
      gesture: "zoom_out",
      name: zoomOutGesture.gesture_name,
      description: zoomOutGesture.gesture_description,
      reason: "[num7] x2 | 完成最後一個教學單元後，操作縮小說明文字",
      step_id: "LAST_UNIT_ZOOM_OUT",
      step_name: "文字縮小操作",
      actions: [],
    });
  }

  const captureGesture = findGesture("capture");
  if (captureGesture) {
    script.gestures.push({
      step: script.gestures.length + 1,
      gesture: "capture",
      name: captureGesture.gesture_name,
      description: captureGesture.gesture_description,
      reason: "[num8] | 完成所有教學單元後，拍攝機台最終狀態作為記錄",
      step_id: "FINAL_CAPTURE",
      step_name: "拍攝機台狀態",
      actions: [],
    });
  }

  const closeGesture = findGesture("close");
  if (closeGesture) {
    script.gestures.push({
      step: script.gestures.length + 1,
      gesture: "close",
      name: closeGesture.gesture_name,
      description: closeGesture.gesture_description,
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
      action_id: actionIds.POWER_ON,
      action_name: "電源開機",
      action_buttons: actionButtons.POWER_ON,
      media_file: null,
      interactions: {
        [actionButtons.POWER_ON]: { next_action_id: null },
      },
    });
  }

  if (includeShutdown && script.gestures.length > 0) {
    const lastIndex = script.gestures.length - 1;
    const targetIndex = lastIndex > 0 ? lastIndex - 1 : 0;
    addPowerActionToGesture(targetIndex, {
      action_id: actionIds.POWER_OFF,
      action_name: "電源關機",
      action_buttons: actionButtons.POWER_OFF,
      media_file: null,
      interactions: {
        [actionButtons.POWER_OFF]: { next_action_id: null },
      },
    });
  }

  return { script, hasScenarioSections: true };
}
