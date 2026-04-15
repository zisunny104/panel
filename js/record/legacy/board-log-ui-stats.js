/**
 * LogStatsReport - 實驗日誌統計
 *
 * 負責彙整日誌條目並計算統計資訊。
 */

import {
  LOG_TYPES,
  GESTURE_ATTEMPT_TYPES,
} from "../../constants/index.js";

export const logStatsReport = {
  boardPageManager: null,

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  },
  /**
   * 計算日誌統計資訊
   * @param {Array} entries - 日誌條目陣列
   * @returns {Object} 統計資訊物件
   */
  calculateLogStatistics(entries) {
    const stats = {
      // 基本資料
      experimentId: "",
      participantName: "",
      experimentCombination: "",
      startTime: null,
      endTime: null,
      totalDuration: 0,

      // 統計資訊
      totalUnits: 0,
      totalGesturesPlanned: null,
      totalGesturesRecorded: null,
      gestureStats: {},
    };

    if (!entries || entries.length === 0) return stats;

    // 收集基本資料和統計資訊
    const unitsStarted = new Set();
    const gesturesPlanned = new Map();
    const gestureIndexToId = new Map();
    const namedGestureIndices = new Set();
    const plannedGestureIndices = new Set();
    let markedGestureCount = 0;

    // 第一輪：收集 g_idx 到 g_id 的映射
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      if (
        entry.type === "gesture_step_start" &&
        entry.g_id &&
        entry.g_idx !== undefined
      ) {
        gestureIndexToId.set(entry.g_idx, entry.g_id);
        namedGestureIndices.add(entry.g_idx);
      }
      if (entry.type === LOG_TYPES.GESTURE_ATTEMPT && entry.g_id) {
        gestureIndexToId.set(entry.g_idx, entry.g_id);
        namedGestureIndices.add(entry.g_idx);
      }
    });

    const resolveGestureName = (entry, gestureIndex) => {
      const gestureId =
        entry?.g_id ||
        (gestureIndexToId.has(gestureIndex)
          ? gestureIndexToId.get(gestureIndex)
          : null);
      const boardPageManager = this.boardPageManager;
      if (gestureId && boardPageManager?.gesturesData?.[gestureId]?.zh) {
        return boardPageManager.gesturesData[gestureId].zh;
      }
      return null;
    };

    // 第二輪：進行統計計算
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      // 從實驗開始事件取得基本資料
      if (entry.type === "exp_start") {
        stats.experimentId = entry.exp_id || "";
        stats.participantName = entry.participant || "";
        stats.experimentCombination = entry.combo_name || "";

        if (entry.ts) {
          const ts =
            typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts;
          stats.startTime = new Date(ts);
        }
      }

      // 從實驗結束事件取得結束時間
      if (entry.type === "exp_end") {
        if (entry.ts) {
          const ts =
            typeof entry.ts === "string" ? parseInt(entry.ts, 10) : entry.ts;
          stats.endTime = new Date(ts);
        }
      }

      // 計算單元數量
      if (entry.type === "gesture_step_start") {
        if (entry.s_id) {
          const parts = entry.s_id.split("_");
          if (parts.length > 0) {
            const potentialUnitId = parts[0];
            const isActualUnit = /[0-9]/.test(potentialUnitId);
            if (isActualUnit) {
              unitsStarted.add(potentialUnitId);
            }
          }
        }

        const gestureName = resolveGestureName(entry, entry.g_idx || 0);
        if (gestureName) {
          if (!gesturesPlanned.has(gestureName)) {
            gesturesPlanned.set(gestureName, 1);
          } else {
            gesturesPlanned.set(
              gestureName,
              gesturesPlanned.get(gestureName) + 1,
            );
          }
        }
        if (entry.g_idx !== undefined) {
          plannedGestureIndices.add(entry.g_idx);
        }
      }

      // 手勢嘗試（用於統計正確性）
      if (entry.type === LOG_TYPES.GESTURE_ATTEMPT) {
        const gestureIndex = entry.g_idx || 0;
        const gestureType = entry.g_type || GESTURE_ATTEMPT_TYPES.UNKNOWN;

        const gestureName = resolveGestureName(entry, gestureIndex);
        if (!gestureName) return;

        if (!stats.gestureStats[gestureName]) {
          stats.gestureStats[gestureName] = {
            planned: 0,
            recorded: 0,
            correct: 0,
            uncertain: 0,
            incorrect: 0,
          };
        }

        stats.gestureStats[gestureName].recorded++;
        markedGestureCount++;

        if (gestureType === GESTURE_ATTEMPT_TYPES.TRUE) {
          stats.gestureStats[gestureName].correct++;
        } else if (gestureType === GESTURE_ATTEMPT_TYPES.UNKNOWN) {
          stats.gestureStats[gestureName].uncertain++;
        } else if (gestureType === GESTURE_ATTEMPT_TYPES.FALSE) {
          stats.gestureStats[gestureName].incorrect++;
        }
      }
    });

    const plannedFromSequence =
      this.boardPageManager?.currentCombination?.gestures?.length;
    if (Number.isFinite(plannedFromSequence) && plannedFromSequence > 0) {
      stats.totalGesturesPlanned = plannedFromSequence;
    } else if (plannedGestureIndices.size > 0) {
      stats.totalGesturesPlanned = plannedGestureIndices.size;
    }
    if (markedGestureCount > 0) {
      stats.totalGesturesRecorded = markedGestureCount;
    }

    stats.totalUnits = unitsStarted.size;

    for (const [gestureName, count] of gesturesPlanned) {
      if (stats.gestureStats[gestureName]) {
        stats.gestureStats[gestureName].planned = count;
      } else {
        stats.gestureStats[gestureName] = {
          planned: count,
          recorded: 0,
          correct: 0,
          uncertain: 0,
          incorrect: 0,
        };
      }
    }

    if (stats.startTime && stats.endTime) {
      stats.totalDuration = Math.round(
        (stats.endTime - stats.startTime) / 1000,
      );
    }

    return stats;
  },
};
