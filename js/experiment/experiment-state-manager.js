/**
 * ExperimentStateManager - 本機實驗狀態管理器
 *
 * 管理實驗 ID、受試者名稱、組合資料、單元列表、執行狀態及時序資料，
 * 提供狀態快照還原與多裝置同步支援。
 */

import { RECORD_SOURCES, SYNC_EVENTS } from "../constants/index.js";
import { generateExperimentId } from "../core/random-utils.js";

class ExperimentStateManager {
  constructor({ timeSyncManager = null, recordManager = null, experimentHubManager = null } = {}) {
    this.experimentId = null;
    this.participantName = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isExperimentRunning = false;
    this.experimentPaused = false;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;

    // 時間同步管理器
    this.timeSyncManager = timeSyncManager;

    // 依賴注入
    this.recordManager = recordManager;
    this.experimentHubManager = experimentHubManager;

    // 初始化 hub 同步事件監聽
    this.setupHubSync();
  }

  updateDependencies({ timeSyncManager, recordManager, experimentHubManager } = {}) {
    if (timeSyncManager) {
      this.timeSyncManager = timeSyncManager;
    }
    if (recordManager) {
      this.recordManager = recordManager;
    }
    if (experimentHubManager) {
      this.experimentHubManager = experimentHubManager;
    }
  }

  setupHubSync() {
    document.addEventListener("experimentSystem:experimentIdChanged", (event) => {
      const { experimentId } = event.detail || {};
      if (!experimentId) return;
      this.setExperimentId(experimentId, RECORD_SOURCES.LOCAL_INITIALIZE);
    });

    document.addEventListener("hub_state_updated", (event) => {
      const { state } = event.detail;
      this.applyHubState(state);
    });

    document.addEventListener(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, (event) => {
      const { experimentId } = event.detail;
      this.setExperimentId(experimentId, RECORD_SOURCES.HUB_SYNC);
    });

    document.addEventListener("participant_name_updated", (event) => {
      const { participantName } = event.detail;
      this.setParticipantName(participantName, "hub");
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
    if (state.isExperimentRunning !== undefined) {
      this.isExperimentRunning = state.isExperimentRunning;
    }
    if (state.experimentPaused !== undefined) {
      this.experimentPaused = state.experimentPaused;
    }
  }

  setExperimentId(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    if (this.experimentId !== experimentId) {
      this.experimentId = experimentId;
      Logger &&
        Logger.info &&
        Logger.info(`實驗ID已更新 (${source}): ${experimentId}`);

      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }

      if (this.recordManager?.setExperimentId) {
        this.recordManager.setExperimentId(experimentId, source);
      }

      // 如果有 Hub 管理器，且更新不是來自 Hub，才同步到 Hub（避免 hub -> local -> hub 迴圈）
      try {
        if (
          source !== "hub_sync" &&
          this.experimentHubManager &&
          typeof this.experimentHubManager.setExperimentId === "function"
        ) {
          const hubCurrent =
            typeof this.experimentHubManager.getExperimentId === "function"
              ? this.experimentHubManager.getExperimentId()
              : null;
          if (hubCurrent !== experimentId) {
            // 使用現有的 Hub API，同步時保留 source 資訊
            this.experimentHubManager.setExperimentId(experimentId, source);
          }
        }
      } catch (err) {
        Logger && Logger.warn && Logger.warn("同步實驗ID到 Hub 失敗:", err);
      }

    }
  }

  getExperimentId() {
    return this.experimentId;
  }

  setParticipantName(participantName, source = "unknown") {
    if (this.participantName !== participantName) {
      this.participantName = participantName;
      Logger &&
        Logger.info &&
        Logger.info(`受試者名稱已更新 (${source}): ${participantName}`);

      const participantNameInput = document.getElementById(
        "participantNameInput",
      );
      if (
        participantNameInput &&
        participantNameInput.value.trim() !== participantName
      ) {
        participantNameInput.value = participantName;
      }

    }
  }

  getParticipantName() {
    return this.participantName;
  }

  setCurrentCombination(combination, source = "unknown") {
    if (
      JSON.stringify(this.currentCombination) !== JSON.stringify(combination)
    ) {
      this.currentCombination = combination;
      Logger &&
        Logger.info &&
        Logger.info(
          `目前組合已更新 (${source}): ${combination?.combinationName || "null"}`,
        );
    }
  }

  startExperiment() {
    if (!this.isExperimentRunning) {
      this.isExperimentRunning = true;
      this.experimentStartTime = this.timeSyncManager?.isSynchronized()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
      this.experimentPaused = false;
      Logger && Logger.info && Logger.info("實驗已開始");

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
      Logger && Logger.info && Logger.info("實驗已停止");

      if (this.recordManager) {
        this.recordManager.logExperimentEnd();
        this.recordManager.flushAll &&
          this.recordManager.flushAll();
      }

    }
  }

  pauseExperiment() {
    if (this.isExperimentRunning && !this.experimentPaused) {
      this.experimentPaused = true;
      Logger && Logger.info && Logger.info("實驗已暫停");

      if (this.recordManager) {
        this.recordManager.logExperimentPause();
      }

    }
  }

  resumeExperiment() {
    if (this.isExperimentRunning && this.experimentPaused) {
      this.experimentPaused = false;
      Logger && Logger.info && Logger.info("實驗已還原");

      if (this.recordManager) {
        this.recordManager.logExperimentResume();
      }

    }
  }

  generateExperimentId() {
    const newId = generateExperimentId();
    this.setExperimentId(newId, RECORD_SOURCES.LOCAL_GENERATE);

    if (this.experimentHubManager?.isInSyncMode?.()) {
      Logger &&
        Logger.debug &&
        Logger.debug(`同步模式，註冊實驗ID到中樞: ${newId}`);
      this.experimentHubManager.registerExperimentId &&
        this.experimentHubManager.registerExperimentId(
          newId,
          "state_manager",
        );
    } else {
      Logger &&
        Logger.debug &&
        Logger.debug(`獨立模式，實驗ID僅存本機: ${newId}`);
    }

    return newId;
  }

  getCurrentState() {
    return {
      experimentId: this.experimentId,
      participantName: this.participantName,
      currentCombination: this.currentCombination,
      loadedUnits: this.loadedUnits,
      isExperimentRunning: this.isExperimentRunning,
      experimentPaused: this.experimentPaused,
      experimentStartTime: this.experimentStartTime,
      experimentElapsed: this.experimentElapsed,
    };
  }
}

// ES6 模組匯出
export default ExperimentStateManager;
export { ExperimentStateManager };
