/**
 * recordViewStats - 實驗日誌統計 mixin
 *
 * 負責彙整日誌條目並計算統計資訊。
 * 作為 mixin 混入 RecordView。
 *
 * 依賴（透過 RecordView.updateDependencies 注入）：
 *   getGesturesData() → Object  手勢資料字典（gesture_id → { zh: string }）
 *   getCombination()  → Object  目前組合（含 gestures 陣列）
 */

import { RECORD_TYPES, GESTURE_ATTEMPT_TYPES } from "../constants/index.js";

export const recordViewStats = {
  /**
   * 計算日誌統計資訊
   * @param {Array} entries - 日誌條目陣列
   * @returns {Object}
   */
  calculateLogStatistics(entries) {
    const stats = {
      experimentId: "",
      participantName: "",
      experimentCombination: "",
      startTime: null,
      endTime: null,
      totalDuration: 0,
      totalUnits: 0,
      totalGesturesPlanned: null,
      totalGesturesRecorded: null,
      gestureStats: {},
    };

    if (!entries?.length) return stats;

    const unitsStarted = new Set();
    const gesturesPlanned = new Map();
    const gestureIndexToId = new Map();
    const plannedGestureIndices = new Set();
    let markedGestureCount = 0;

    // 第一輪：建立 g_idx → g_id 映射
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      if (entry.g_id && entry.g_idx !== undefined) {
        gestureIndexToId.set(entry.g_idx, entry.g_id);
      }
    });

    const resolveGestureName = (entry, gestureIndex) => {
      const gestureId = entry?.g_id ?? gestureIndexToId.get(gestureIndex) ?? null;
      const gesturesData = this.getGesturesData?.() ?? {};
      return (gestureId && gesturesData[gestureId]?.zh) ? gesturesData[gestureId].zh : null;
    };

    // 第二輪：統計計算
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      if (entry.type === "exp_start") {
        stats.experimentId = entry.exp_id || "";
        stats.participantName = entry.participant || "";
        stats.experimentCombination = entry.combo_name || "";
        if (entry.ts) {
          stats.startTime = new Date(typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts);
        }
      }

      if (entry.type === "exp_end" && entry.ts) {
        stats.endTime = new Date(typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts);
      }

      if (entry.type === "gesture_step_start") {
        if (entry.s_id) {
          const unitId = entry.s_id.split("_")[0];
          if (/[0-9]/.test(unitId)) unitsStarted.add(unitId);
        }

        const gestureName = resolveGestureName(entry, entry.g_idx || 0);
        if (gestureName) {
          gesturesPlanned.set(gestureName, (gesturesPlanned.get(gestureName) ?? 0) + 1);
        }
        if (entry.g_idx !== undefined) plannedGestureIndices.add(entry.g_idx);
      }

      if (entry.type === RECORD_TYPES.GESTURE_ATTEMPT) {
        const gestureIndex = entry.g_idx || 0;
        const gestureType = entry.g_type || GESTURE_ATTEMPT_TYPES.UNKNOWN;
        const gestureName = resolveGestureName(entry, gestureIndex);
        if (!gestureName) return;

        if (!stats.gestureStats[gestureName]) {
          stats.gestureStats[gestureName] = { planned: 0, recorded: 0, correct: 0, uncertain: 0, incorrect: 0 };
        }

        stats.gestureStats[gestureName].recorded++;
        markedGestureCount++;

        if (gestureType === GESTURE_ATTEMPT_TYPES.TRUE) stats.gestureStats[gestureName].correct++;
        else if (gestureType === GESTURE_ATTEMPT_TYPES.UNKNOWN) stats.gestureStats[gestureName].uncertain++;
        else if (gestureType === GESTURE_ATTEMPT_TYPES.FALSE) stats.gestureStats[gestureName].incorrect++;
      }
    });

    // 計算計畫手勢數
    const plannedFromSequence = this.getCombination?.()?.gestures?.length;
    if (Number.isFinite(plannedFromSequence) && plannedFromSequence > 0) {
      stats.totalGesturesPlanned = plannedFromSequence;
    } else if (plannedGestureIndices.size > 0) {
      stats.totalGesturesPlanned = plannedGestureIndices.size;
    }

    if (markedGestureCount > 0) stats.totalGesturesRecorded = markedGestureCount;

    stats.totalUnits = unitsStarted.size;

    for (const [gestureName, count] of gesturesPlanned) {
      if (stats.gestureStats[gestureName]) {
        stats.gestureStats[gestureName].planned = count;
      } else {
        stats.gestureStats[gestureName] = { planned: count, recorded: 0, correct: 0, uncertain: 0, incorrect: 0 };
      }
    }

    if (stats.startTime && stats.endTime) {
      stats.totalDuration = Math.round((stats.endTime - stats.startTime) / 1000);
    }

    return stats;
  },
};
