/**
 * ExperimentStateManager - 本機實驗狀態管理器
 *
 * 管理實驗 ID、受試者名稱、組合資料、單元列表、執行狀態及時序資料，
 * 提供狀態快照還原與多裝置同步支援。
 */

import { RECORD_SOURCES, SYNC_EVENTS } from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { generateExperimentId } from "../core/random-utils.js";

const EXPERIMENT_STATE_KEY_MAP = {
  experiment_id: "experimentId",
  participant_name: "participantName",
  combination_name: "combinationName",
  loaded_units: "loadedUnits",
  current_unit_index: "currentUnitIndex",
  total_units: "totalUnits",
  current_step_index: "currentStepIndex",
  total_steps: "totalSteps",
  unit_ids: "unitIds",
};

export function normalizeExperimentStatePayload(payload) {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    return payload.map(normalizeExperimentStatePayload);
  }
  if (typeof payload !== "object") {
    return payload;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey =
      EXPERIMENT_STATE_KEY_MAP[key] || key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    normalized[normalizedKey] = normalizeExperimentStatePayload(value);
  }
  return normalized;
}

class ExperimentStateManager {
  constructor({ timeSyncManager = null, recordManager = null } = {}) {
    this.experimentId = null;
    this.participantName = null;
    this.currentCombination = null;
    this.flowState = "idle";
    this.flowLocked = false;
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.loadedUnits = [];
    this.completedUnits = new Set();
    this.deferCompletion = false;
    this.isExperimentRunning = false;
    this.experimentPaused = false;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;

    this.timeSyncManager = timeSyncManager;
    this.recordManager = recordManager;
    this.setupHubSync();
  }

  updateDependencies({ timeSyncManager, recordManager } = {}) {
    if (timeSyncManager) {
      this.timeSyncManager = timeSyncManager;
    }
    if (recordManager) {
      this.recordManager = recordManager;
    }
  }

  setupHubSync() {
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, (event) => {
      const { experimentId } = event.detail;
      this.setExperimentId(experimentId, RECORD_SOURCES.HUB_SYNC);
    });
  }

  applyHubState(state) {
    if (state.experimentId !== undefined) {
      this.setExperimentId(state.experimentId, RECORD_SOURCES.HUB_SYNC);
    }
    if (state.participantName !== undefined) {
      this.setParticipantName(state.participantName, "hub_state");
    }
    if (state.currentCombination !== undefined) {
      this.setCurrentCombination(state.currentCombination, "hub_state");
    }
    if (state.loadedUnits !== undefined) {
      this.loadedUnits = [...state.loadedUnits];
    }
    if (state.completedUnits !== undefined) {
      this.completedUnits = new Set(state.completedUnits);
    }

    // 純量屬性直接賦值
    for (const prop of [
      "flowState", "flowLocked", "currentUnitIndex", "currentStepIndex",
      "deferCompletion", "isExperimentRunning", "experimentPaused",
      "experimentStartTime", "experimentElapsed",
    ]) {
      if (state[prop] !== undefined) this[prop] = state[prop];
    }
  }

  setExperimentId(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    if (this.experimentId !== experimentId) {
      this.experimentId = experimentId;
      Logger.info(`實驗ID已更新 (${source}): ${experimentId}`);

      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_ID_CHANGED, {
          detail: { experimentId },
        }),
      );

      if (this.recordManager?.setExperimentId) {
        this.recordManager.setExperimentId(experimentId, source);
      }
    }
  }

  getExperimentId() {
    return this.experimentId;
  }

  setParticipantName(participantName, source = "unknown") {
    if (this.participantName !== participantName) {
      this.participantName = participantName;
      Logger.info(`受試者名稱已更新 (${source}): ${participantName}`);

      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_PARTICIPANT_CHANGED, {
          detail: { participantName },
        }),
      );
    }
  }

  getParticipantName() {
    return this.participantName;
  }

  setCurrentCombination(combination, source = "unknown") {
    if (this.currentCombination?.combinationId !== combination?.combinationId) {
      this.currentCombination = combination;
      Logger.info(`目前組合已更新 (${source}): ${combination?.combinationName || "null"}`);
    }
  }

  startExperiment() {
    if (!this.isExperimentRunning) {
      this.isExperimentRunning = true;
      this.flowState = "running";
      this.flowLocked = true;
      this.experimentStartTime = this.timeSyncManager?.isSynchronized()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
      this.experimentPaused = false;
      Logger.info("實驗已開始");

      if (this.recordManager) {
        const defaultParticipantName =
          this.participantName || `受試者_${this.experimentId}`;
        this.recordManager.initialize(
          this.experimentId,
          defaultParticipantName,
        );
        this.recordManager.logExperimentStart();
      }
    }
  }

  stopExperiment() {
    if (this.isExperimentRunning) {
      this.isExperimentRunning = false;
      this.experimentPaused = false;
      this.flowState = "stopped";
      this.flowLocked = false;
      Logger.info("實驗已停止");

      if (this.recordManager) {
        this.recordManager.logExperimentEnd();
        this.recordManager.flushAll?.();
      }
    }
  }

  pauseExperiment() {
    if (this.isExperimentRunning && !this.experimentPaused) {
      this.experimentPaused = true;
      this.flowState = "paused";
      this.flowLocked = true;
      Logger.info("實驗已暫停");

      if (this.recordManager) {
        this.recordManager.logExperimentPause();
      }
    }
  }

  resumeExperiment() {
    if (this.isExperimentRunning && this.experimentPaused) {
      this.experimentPaused = false;
      this.flowState = "running";
      this.flowLocked = true;
      Logger.info("實驗已還原");

      if (this.recordManager) {
        this.recordManager.logExperimentResume();
      }
    }
  }

  generateExperimentId() {
    const newId = generateExperimentId();
    this.setExperimentId(newId, RECORD_SOURCES.LOCAL_GENERATE);

    return newId;
  }

  getCurrentState() {
    return {
      experimentId: this.experimentId,
      participantName: this.participantName,
      currentCombination: this.currentCombination,
      flowState: this.flowState,
      flowLocked: this.flowLocked,
      currentUnitIndex: this.currentUnitIndex,
      currentStepIndex: this.currentStepIndex,
      loadedUnits: [...this.loadedUnits],
      completedUnits: [...this.completedUnits],
      deferCompletion: this.deferCompletion,
      isExperimentRunning: this.isExperimentRunning,
      experimentPaused: this.experimentPaused,
      experimentStartTime: this.experimentStartTime,
      experimentElapsed: this.experimentElapsed,
    };
  }
}

export { ExperimentStateManager };
