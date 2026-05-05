/**
 * ExperimentStateManager - 實驗元資料管理器
 *
 * 職責：管理實驗識別資訊（ID、受試者名稱、組合）並在多個模組間同步。
 * 不負責流程狀態（running/paused/locked）— 由 ExperimentFlowManager 擁有。
 * 不負責計時狀態 — 由 ExperimentTimerManager 擁有。
 */

import { RECORD_SOURCES, SYNC_EVENTS } from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { generateExperimentId } from "../core/random-utils.js";

export function normalizeExperimentStatePayload(payload) {
  const KEY_MAP = {
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

  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) return payload.map(normalizeExperimentStatePayload);
  if (typeof payload !== "object") return payload;

  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = KEY_MAP[key] || key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    normalized[normalizedKey] = normalizeExperimentStatePayload(value);
  }
  return normalized;
}

class ExperimentStateManager {
  constructor({ timeSyncManager = null, recordManager = null } = {}) {
    // 實驗元資料 — 此管理器的唯一職責
    this.experimentId = null;
    this.participantName = null;
    this.currentCombination = null;

    this.timeSyncManager = timeSyncManager;
    this.recordManager = recordManager;
    this._setupHubSync();
  }

  updateDependencies({ timeSyncManager, recordManager } = {}) {
    if (timeSyncManager) this.timeSyncManager = timeSyncManager;
    if (recordManager) this.recordManager = recordManager;
  }

  _setupHubSync() {
    document.addEventListener(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, (event) => {
      const { experimentId } = event.detail;
      this.setExperimentId(experimentId, RECORD_SOURCES.HUB_SYNC);
    });
  }

  setExperimentId(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    if (this.experimentId === experimentId) return;
    this.experimentId = experimentId;
    Logger.info(`實驗ID已更新 (${source}): ${experimentId}`);

    document.dispatchEvent(new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_ID_CHANGED, {
      detail: { experimentId },
    }));

    if (this.recordManager?.setExperimentId) {
      this.recordManager.setExperimentId(experimentId, source);
    }
  }

  getExperimentId() {
    return this.experimentId;
  }

  setParticipantName(participantName, source = "unknown") {
    if (this.participantName === participantName) return;
    this.participantName = participantName;
    Logger.info(`受試者名稱已更新 (${source}): ${participantName}`);

    document.dispatchEvent(new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_PARTICIPANT_CHANGED, {
      detail: { participantName },
    }));
  }

  getParticipantName() {
    return this.participantName;
  }

  setCurrentCombination(combination, source = "unknown") {
    if (this.currentCombination?.combinationId === combination?.combinationId) return;
    this.currentCombination = combination;
    Logger.info(`目前組合已更新 (${source}): ${combination?.combinationName || "null"}`);
  }

  generateExperimentId() {
    const newId = generateExperimentId();
    this.setExperimentId(newId, RECORD_SOURCES.LOCAL_GENERATE);
    return newId;
  }
}

export { ExperimentStateManager };
