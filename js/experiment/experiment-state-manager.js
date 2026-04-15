/**
 * ExperimentStateManager - 本機實驗狀態管理器
 *
 * 管理實驗 ID、受試者名稱、組合資料、單元列表、執行狀態及時序資料，
 * 提供狀態快照還原與多裝置同步支援。
 */

import { RECORD_SOURCES, SYNC_EVENTS } from "../constants/index.js";
import { generateExperimentId } from "../core/random-utils.js";

class ExperimentStateManager {
  constructor({ timeSyncManager = null, experimentLogManager = null, experimentHubManager = null } = {}) {
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
    this.experimentLogManager = experimentLogManager;
    this.experimentHubManager = experimentHubManager;

    // 事件監聽器
    this.listeners = new Map();

    // 從 localStorage 還原狀態快照
    this.restoreSnapshot && this.restoreSnapshot();

    // 初始化同步
    this.setupSync && this.setupSync();
  }

  updateDependencies({ timeSyncManager, experimentLogManager, experimentHubManager } = {}) {
    if (timeSyncManager) {
      this.timeSyncManager = timeSyncManager;
    }
    if (experimentLogManager) {
      this.experimentLogManager = experimentLogManager;
    }
    if (experimentHubManager) {
      this.experimentHubManager = experimentHubManager;
    }
  }

  setupSync() {
    this.setupInputSync && this.setupInputSync();
    this.setupHubSync && this.setupHubSync();
  }

  setupInputSync() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      if (!experimentIdInput._stateSyncBound) {
        experimentIdInput._stateSyncBound = true;
        // 對 input 做去抖，避免高頻輸入導致 race 或大量同步
        let _debounceTimer = null;
        const DEBOUNCE_MS = 300;

        experimentIdInput.addEventListener("input", (e) => {
          const newId = e.target.value.trim();
          if (_debounceTimer) clearTimeout(_debounceTimer);
          _debounceTimer = setTimeout(() => {
            if (newId !== this.experimentId) {
              this.setExperimentId(newId, RECORD_SOURCES.LOCAL_INPUT);
            }
            _debounceTimer = null;
          }, DEBOUNCE_MS);
        });

        // change 事件立即同步（例如離開欄位時）
        experimentIdInput.addEventListener("change", (e) => {
          const newId = e.target.value.trim();
          if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
          }
          if (newId !== this.experimentId) {
            this.setExperimentId(newId, RECORD_SOURCES.LOCAL_INPUT);
          }
        });
      }

      if (experimentIdInput.value.trim() && !this.experimentId) {
        this.experimentId = experimentIdInput.value.trim();
      }
    }

    const participantNameInput = document.getElementById(
      "participantNameInput",
    );
    if (participantNameInput) {
      if (!participantNameInput._stateSyncBound) {
        participantNameInput._stateSyncBound = true;
        participantNameInput.addEventListener("input", (e) => {
          const newName = e.target.value.trim();
          if (newName !== this.participantName) {
            this.setParticipantName(newName, "input");
          }
        });

        participantNameInput.addEventListener("change", (e) => {
          const newName = e.target.value.trim();
          if (newName !== this.participantName) {
            this.setParticipantName(newName, "input");
          }
        });
      }

      if (participantNameInput.value.trim() && !this.participantName) {
        this.participantName = participantNameInput.value.trim();
      }
    }
  }

  setupHubSync() {
    document.addEventListener(
      "experimentSystem:experimentIdChanged",
      (event) => {
        const { experimentId } = event.detail || {};
        if (!experimentId) return;
        this.setExperimentId &&
          this.setExperimentId(experimentId, RECORD_SOURCES.LOCAL_INITIALIZE);
      },
    );

    document.addEventListener("hub_state_updated", (event) => {
      const { state } = event.detail;
      this.applyHubState && this.applyHubState(state);
    });

    document.addEventListener(
      SYNC_EVENTS.EXPERIMENT_ID_CHANGED,
      (event) => {
        const { experimentId } = event.detail;
        this.setExperimentId && this.setExperimentId(experimentId, RECORD_SOURCES.HUB_SYNC);
      },
    );

    document.addEventListener("participant_name_updated", (event) => {
      const { participantName } = event.detail;
      this.setParticipantName &&
        this.setParticipantName(participantName, "hub");
    });
  }

  applyHubState(state) {
    if (state.experimentId !== undefined) {
      this.setExperimentId &&
        this.setExperimentId(state.experimentId, RECORD_SOURCES.HUB_SYNC);
    }
    if (state.participantName !== undefined) {
      this.setParticipantName &&
        this.setParticipantName(state.participantName, "hub_state");
    }
    if (state.currentCombination !== undefined) {
      this.setCurrentCombination &&
        this.setCurrentCombination(state.currentCombination, "hub_state");
    }
    if (state.loadedUnits !== undefined) {
      this.loadedUnits = [...state.loadedUnits];
      this.emit && this.emit("loadedUnitsChanged", this.loadedUnits);
    }
    if (state.isExperimentRunning !== undefined) {
      this.isExperimentRunning = state.isExperimentRunning;
      this.emit &&
        this.emit("experimentRunningChanged", this.isExperimentRunning);
    }
    if (state.experimentPaused !== undefined) {
      this.experimentPaused = state.experimentPaused;
      this.emit && this.emit("experimentPausedChanged", this.experimentPaused);
    }
  }

  setExperimentId(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    if (this.experimentId !== experimentId) {
      const oldId = this.experimentId;
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

      if (this.experimentLogManager?.setExperimentId) {
        this.experimentLogManager.setExperimentId(experimentId, source);
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

      this.emit &&
        this.emit("experimentIdChanged", { experimentId, oldId, source });
    }
  }

  getExperimentId() {
    return this.experimentId;
  }

  syncExperimentIdWithInput(experimentId) {
    if (!experimentId) return;
    this.experimentId = experimentId;
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput && experimentIdInput.value.trim() !== experimentId) {
      experimentIdInput.value = experimentId;
    }
  }

  getInputExperimentId() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    return experimentIdInput?.value?.trim() || null;
  }

  setParticipantName(participantName, source = "unknown") {
    if (this.participantName !== participantName) {
      const oldName = this.participantName;
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

      this.emit &&
        this.emit("participantNameChanged", {
          participantName,
          oldName,
          source,
        });
    }
  }

  getParticipantName() {
    return this.participantName;
  }

  setCurrentCombination(combination, source = "unknown") {
    if (
      JSON.stringify(this.currentCombination) !== JSON.stringify(combination)
    ) {
      const oldCombination = this.currentCombination;
      this.currentCombination = combination;
      Logger &&
        Logger.info &&
        Logger.info(
          `目前組合已更新 (${source}): ${combination?.combinationName || "null"}`,
        );
      this.emit &&
        this.emit("currentCombinationChanged", {
          combination,
          oldCombination,
          source,
        });
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

      if (this.experimentLogManager) {
        const defaultParticipantName =
          this.participantName || `受試者_${this.experimentId}`;
        this.experimentLogManager.initialize(
          this.experimentId,
          defaultParticipantName,
        );
        this.experimentLogManager.logExperimentStart();
      }

      this.emit &&
        this.emit("experimentStarted", {
          experimentId: this.experimentId,
          participantName: this.participantName,
          combination: this.currentCombination,
        });
    }
  }

  stopExperiment() {
    if (this.isExperimentRunning) {
      this.isExperimentRunning = false;
      this.experimentPaused = false;
      Logger && Logger.info && Logger.info("實驗已停止");

      if (this.experimentLogManager) {
        this.experimentLogManager.logExperimentEnd();
        this.experimentLogManager.flushAll &&
          this.experimentLogManager.flushAll();
      }

      this.emit &&
        this.emit("experimentStopped", {
          experimentId: this.experimentId,
          participantName: this.participantName,
        });
    }
  }

  pauseExperiment() {
    if (this.isExperimentRunning && !this.experimentPaused) {
      this.experimentPaused = true;
      Logger && Logger.info && Logger.info("實驗已暫停");

      if (this.experimentLogManager) {
        this.experimentLogManager.logExperimentPause();
      }

      this.emit &&
        this.emit("experimentPaused", { experimentId: this.experimentId });
    }
  }

  resumeExperiment() {
    if (this.isExperimentRunning && this.experimentPaused) {
      this.experimentPaused = false;
      Logger && Logger.info && Logger.info("實驗已還原");

      if (this.experimentLogManager) {
        this.experimentLogManager.logExperimentResume();
      }

      this.emit &&
        this.emit("experimentResumed", { experimentId: this.experimentId });
    }
  }

  generateExperimentId() {
    const newId = generateExperimentId();
    this.setExperimentId && this.setExperimentId(newId, RECORD_SOURCES.LOCAL_GENERATE);

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
