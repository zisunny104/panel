/**
 * recordViewStats - 實驗日誌統計 mixin
 *
 * 負責彙整日誌條目並計算統計資訊。
 * 作為 mixin 混入 RecordView。
 *
 * 依賴（透過 RecordView.updateDependencies 注入）：
 *   getCombination()  → Object  目前組合（含 gestures 陣列）
 */

import { RECORD_TYPES } from "../constants/index.js";

export const recordViewStats = {
  /**
   * 計算記錄統計資訊
   * @param {Array} entries - 記錄條目陣列
   * @returns {Object}
   */
  calculateRecordStatistics(entries) {
    const stats = {
      experimentId: "",
      participantName: "",
      experimentCombination: "",
      startTime: null,
      endTime: null,
      totalDuration: 0,
      totalUnits: 0,
    };

    if (!entries?.length) return stats;

    const unitsStarted = new Set();

    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      if (entry.type === RECORD_TYPES.EXP_START) {
        stats.experimentId = entry.exp_id || "";
        stats.participantName = entry.participant || "";
        stats.experimentCombination = entry.combo_name || "";
        if (entry.ts) {
          stats.startTime = new Date(typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts);
        }
      }

      if (entry.type === RECORD_TYPES.EXP_END && entry.ts) {
        stats.endTime = new Date(typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts);
      }

      if (entry.type === RECORD_TYPES.GESTURE_STEP_START) {
        if (entry.s_id) {
          const unitId = entry.s_id.split("_")[0];
          if (/[0-9]/.test(unitId)) unitsStarted.add(unitId);
        }
      }
    });

    stats.totalUnits = unitsStarted.size;

    if (stats.startTime && stats.endTime) {
      stats.totalDuration = Math.round((stats.endTime - stats.startTime) / 1000);
    }

    return stats;
  },
};
