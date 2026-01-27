/**
 * ExperimentStateManager - 實驗狀態管理器
 * 負責管理實驗的開始、暫停、停止等狀態轉換
 */

class ExperimentStateManager {
  constructor(coreManager) {
    this.core = coreManager;
  }

  /**
   * 開始實驗
   */
  async startExperiment() {
    if (this.core.experimentRunning) {
      Logger.warn("實驗已在執行中");
      return;
    }

    try {
      this.core.experimentRunning = true;
      this.core.experimentPaused = false;
      this.core.experimentStartTime = Date.now();
      this.core.experimentElapsedTime = 0;

      // 啟動計時器
      this.startTimer();

      // 記錄日誌
      this.core.logAction("experiment_started", {
        experiment_id: this.core.experimentId,
        participant_name: this.core.participantName,
        combination: this.core.currentCombination,
        clientId: this.core.getClientId(),
        start_time: this.core.experimentStartTime
      });

      // 廣播狀態
      this.broadcastExperimentState("started");

      Logger.debug("實驗已開始");
    } catch (error) {
      Logger.error("開始實驗失敗:", error);
      this.core.experimentRunning = false;
      throw error;
    }
  }

  /**
   * 暫停實驗
   */
  pauseExperiment() {
    if (!this.core.experimentRunning || this.core.experimentPaused) {
      return;
    }

    this.core.experimentPaused = true;

    // 停止計時器
    this.stopTimer();

    // 記錄日誌
    this.core.logAction("experiment_paused", {
      experiment_id: this.core.experimentId,
      paused_time: Date.now(),
      elapsed_time: this.core.experimentElapsedTime
    });

    // 廣播狀態
    this.broadcastExperimentState("paused");

    Logger.debug("實驗已暫停");
  }

  /**
   * 繼續實驗
   */
  resumeExperiment() {
    if (!this.core.experimentRunning || !this.core.experimentPaused) {
      return;
    }

    this.core.experimentPaused = false;

    // 重新啟動計時器
    this.startTimer();

    // 記錄日誌
    this.core.logAction("experiment_resumed", {
      experiment_id: this.core.experimentId,
      resumed_time: Date.now(),
      elapsed_time: this.core.experimentElapsedTime
    });

    // 廣播狀態
    this.broadcastExperimentState("resumed");

    Logger.debug("實驗已繼續");
  }

  /**
   * 停止實驗
   */
  async stopExperiment() {
    if (!this.core.experimentRunning) {
      return;
    }

    try {
      const endTime = Date.now();
      const totalDuration = endTime - this.core.experimentStartTime;

      this.core.experimentRunning = false;
      this.core.experimentPaused = false;

      // 停止計時器
      this.stopTimer();

      // 記錄日誌
      this.core.logAction("experiment_stopped", {
        experiment_id: this.core.experimentId,
        end_time: endTime,
        total_duration: totalDuration,
        elapsed_time: this.core.experimentElapsedTime
      });

      // 廣播狀態
      this.broadcastExperimentState("stopped");

      // 重置狀態
      this.resetExperimentState();

      Logger.debug("實驗已停止");
    } catch (error) {
      Logger.error("停止實驗失敗:", error);
      throw error;
    }
  }

  /**
   * 切換實驗狀態（開始/暫停）
   */
  toggleExperiment() {
    if (!this.core.experimentRunning) {
      this.startExperiment();
    } else if (this.core.experimentPaused) {
      this.resumeExperiment();
    } else {
      this.pauseExperiment();
    }
  }

  /**
   * 啟動計時器
   */
  startTimer() {
    if (this.core.experimentTimerInterval) {
      clearInterval(this.core.experimentTimerInterval);
    }

    this.core.experimentTimerInterval = setInterval(() => {
      if (!this.core.experimentPaused) {
        this.core.experimentElapsedTime +=
          ExperimentStateManager.TIMER_UPDATE_INTERVAL;
        this.updateTimerDisplay();
      }
    }, ExperimentStateManager.TIMER_UPDATE_INTERVAL);
  }

  /**
   * 停止計時器
   */
  stopTimer() {
    if (this.core.experimentTimerInterval) {
      clearInterval(this.core.experimentTimerInterval);
      this.core.experimentTimerInterval = null;
    }
  }

  /**
   * 更新計時器顯示
   */
  updateTimerDisplay() {
    const timerDisplay = document.getElementById("experiment-timer");
    if (timerDisplay) {
      timerDisplay.textContent = this.formatDuration(
        this.core.experimentElapsedTime
      );
    }
  }

  /**
   * 格式化持續時間
   */
  formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  }

  /**
   * 廣播實驗狀態
   */
  broadcastExperimentState(state) {
    if (this.core.syncHandler && this.core.syncHandler.isConnected) {
      this.core.syncHandler.broadcastExperimentState({
        type: `experiment_${state}`,
        experiment_id: this.core.experimentId,
        timestamp: Date.now(),
        clientId: this.core.getClientId()
      });
    }
  }

  /**
   * 重置實驗狀態
   */
  resetExperimentState() {
    this.core.experimentStartTime = null;
    this.core.experimentElapsedTime = 0;
    this.core.currentStep = 0;
    this.core.currentUnit = null;
    // 不重置 currentCombination，允許重新開始
  }

  /**
   * 處理同步連接
   */
  onSyncConnected() {
    // 同步連接時的處理邏輯
    Logger.debug("狀態管理器：同步已連接");
  }

  /**
   * 處理同步斷開
   */
  onSyncDisconnected() {
    // 同步斷開時的處理邏輯
    Logger.debug("狀態管理器：同步已斷開");
  }

  /**
   * 處理遠端實驗開始
   */
  handleRemoteExperimentStarted(detail) {
    Logger.debug("處理遠端實驗開始", detail);

    // 如果本地未運行，啟動實驗
    if (!this.core.experimentRunning) {
      this.core.experimentRunning = true;
      this.core.experimentPaused = false;
      this.core.experimentStartTime = detail.start_time || Date.now();

      this.startTimer();

      // 更新UI
      if (this.core.uiManager) {
        this.core.uiManager.updateExperimentStatus("running");
      }
    }
  }

  /**
   * 處理遠端實驗暫停
   */
  handleRemoteExperimentPaused(detail) {
    Logger.debug("處理遠端實驗暫停", detail);

    if (this.core.experimentRunning && !this.core.experimentPaused) {
      this.pauseExperiment();
    }
  }

  /**
   * 處理遠端實驗繼續
   */
  handleRemoteExperimentResumed(detail) {
    Logger.debug("處理遠端實驗繼續", detail);

    if (this.core.experimentRunning && this.core.experimentPaused) {
      this.resumeExperiment();
    }
  }

  /**
   * 處理遠端實驗停止
   */
  handleRemoteExperimentStopped(detail) {
    Logger.debug("處理遠端實驗停止", detail);

    if (this.core.experimentRunning) {
      this.stopExperiment();
    }
  }

  /**
   * 清理資源
   */
  destroy() {
    this.stopTimer();
    Logger.debug("ExperimentStateManager 已清理");
  }
}

// 靜態常數
ExperimentStateManager.TIMER_UPDATE_INTERVAL = 50;

// 匯出
export { ExperimentStateManager };
