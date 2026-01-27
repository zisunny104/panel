/**
 * PanelExperimentTimer - 面板實驗計時器管理器
 *
 * 負責實驗計時器的啟動、暫停、恢復和顯示
 * 專門處理時間相關的邏輯和UI更新
 */
class PanelExperimentTimer {
  constructor() {
    // 計時器狀態
    this.experimentInterval = null;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;
    this.experimentPaused = false;
  }

  /**
   * 更新計時器顯示
   */
  updateTimerDisplay() {
    const experimentTimer = document.getElementById("experimentTimer");
    if (!experimentTimer) return;

    this.experimentInterval = setInterval(() => {
      if (!this.experimentPaused) {
        const now = Date.now();
        const deltaMs = now - this.experimentStartTime;
        this.experimentElapsed = Math.floor(deltaMs / 1000);

        const totalSeconds = Math.floor(deltaMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const milliseconds = deltaMs % 1000;

        const timeString = `${String(minutes).padStart(2, "0")}:${String(
          seconds,
        ).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;

        experimentTimer.textContent = timeString;
      }
    }, 50);
  }

  /**
   * 開始計時器（顯示 mm:ss.mmm，內部 this.experimentElapsed 保持為秒）
   */
  startTimer() {
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer) {
      experimentTimer.style.display = "block";
      this.experimentStartTime = Date.now();
      this.experimentElapsed = 0; // seconds
      this.experimentPaused = false;
      experimentTimer.textContent = "00:00.000";

      this.updateTimerDisplay();
    }
  }

  /**
   * 還原計時器（不重置時間）
   */
  resumeTimer() {
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer) {
      this.experimentStartTime = Date.now() - this.experimentElapsed * 1000;
      this.experimentPaused = false;

      this.updateTimerDisplay();
    }
  }

  /**
   * 暫停計時器
   */
  pauseTimer() {
    this.experimentPaused = true;
    if (this.experimentInterval) {
      clearInterval(this.experimentInterval);
      this.experimentInterval = null;
    }
  }

  /**
   * 停止計時器
   */
  stopTimer() {
    this.experimentPaused = false;
    if (this.experimentInterval) {
      clearInterval(this.experimentInterval);
      this.experimentInterval = null;
    }
    this.experimentStartTime = null;
    this.experimentElapsed = 0;

    // 重置 UI 顯示
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer) {
      experimentTimer.textContent = "00:00.000";
    }
  }

  /**
   * 取得目前經過的時間（秒）
   */
  getElapsedTime() {
    return this.experimentElapsed;
  }

  /**
   * 檢查計時器是否正在運行
   */
  isRunning() {
    return this.experimentInterval !== null && !this.experimentPaused;
  }

  /**
   * 檢查計時器是否已暫停
   */
  isPaused() {
    return this.experimentPaused;
  }

  /**
   * 設定經過時間
   */
  setElapsedTime(elapsed) {
    this.experimentElapsed = elapsed;
  }
}

// 匯出計時器管理器
window.panelExperimentTimer = new PanelExperimentTimer();
