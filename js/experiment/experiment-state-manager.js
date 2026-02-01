/**
 * ExperimentStateManager - 本機實驗狀態管理器
 * 已從 `js/core/experiment-state-manager.js` 移轉到 `js/experiment/`，成為 canonical 位置。
 */

class ExperimentStateManager {
  constructor() {
    this.experimentId = null;
    this.participantName = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isExperimentRunning = false;
    this.experimentPaused = false;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;

    // 時間同步管理器
    this.timeSyncManager = window.timeSyncManager;

    // 事件監聽器
    this.listeners = new Map();

    // 從 localStorage 還原狀態快照
    this.restoreSnapshot && this.restoreSnapshot();

    // 初始化同步
    this.setupSync && this.setupSync();
  }

  setupSync() {
    this.setupInputSync && this.setupInputSync();
    this.setupHubSync && this.setupHubSync();
  }

  setupInputSync() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        const newId = e.target.value.trim();
        if (newId !== this.experimentId) {
          this.setExperimentId(newId, "input");
        }
      });

      experimentIdInput.addEventListener("change", (e) => {
        const newId = e.target.value.trim();
        if (newId !== this.experimentId) {
          this.setExperimentId(newId, "input");
        }
      });

      if (experimentIdInput.value.trim() && !this.experimentId) {
        this.experimentId = experimentIdInput.value.trim();
      }
    }

    const participantNameInput = document.getElementById("participantName");
    if (participantNameInput) {
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

      if (participantNameInput.value.trim() && !this.participantName) {
        this.participantName = participantNameInput.value.trim();
      }
    }
  }

  setupHubSync() {
    document.addEventListener("hub_state_updated", (event) => {
      const { state } = event.detail;
      this.applyHubState && this.applyHubState(state);
    });

    document.addEventListener("experiment_id_changed", (event) => {
      const { experimentId } = event.detail;
      this.setExperimentId && this.setExperimentId(experimentId, "hub");
    });

    document.addEventListener("participant_name_updated", (event) => {
      const { participantName } = event.detail;
      this.setParticipantName &&
        this.setParticipantName(participantName, "hub");
    });
  }

  applyHubState(state) {
    if (state.experimentId !== undefined) {
      this.setExperimentId &&
        this.setExperimentId(state.experimentId, "hub_state");
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

  setExperimentId(experimentId, source = "unknown") {
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

      if (window.experimentLogManager) {
        window.experimentLogManager.setExperimentId(experimentId, source);
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

      const participantNameInput = document.getElementById("participantName");
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

      if (window.experimentLogManager) {
        const defaultParticipantName =
          this.participantName || `受試者_${this.experimentId}`;
        window.experimentLogManager.initialize(
          this.experimentId,
          defaultParticipantName,
        );
        window.experimentLogManager.logExperimentStart();
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

      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentEnd();
        window.experimentLogManager.flushAll &&
          window.experimentLogManager.flushAll();
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

      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentPause();
      }

      this.emit &&
        this.emit("experimentPaused", { experimentId: this.experimentId });
    }
  }

  resumeExperiment() {
    if (this.isExperimentRunning && this.experimentPaused) {
      this.experimentPaused = false;
      Logger && Logger.info && Logger.info("實驗已還原");

      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentResume();
      }

      this.emit &&
        this.emit("experimentResumed", { experimentId: this.experimentId });
    }
  }

  generateExperimentId() {
    const newId = RandomUtils.generateExperimentId();
    this.setExperimentId && this.setExperimentId(newId, "generate");

    if (window.experimentHubManager?.isInSyncMode?.()) {
      Logger &&
        Logger.debug &&
        Logger.debug(
          `[ExperimentStateManager] 同步模式，註冊實驗ID到中樞: ${newId}`,
        );
      window.experimentHubManager.registerExperimentId &&
        window.experimentHubManager.registerExperimentId(
          newId,
          "state_manager",
        );
    } else {
      Logger &&
        Logger.debug &&
        Logger.debug(
          `[ExperimentStateManager] 獨立模式，實驗ID僅存本機: ${newId}`,
        );
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

// 匯出到全域與模組
if (typeof window !== "undefined") {
  window.ExperimentStateManager = ExperimentStateManager;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentStateManager;
}
