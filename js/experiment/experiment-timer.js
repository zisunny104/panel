/**
 * ExperimentTimerManager - 統一計時器管理器
 *
 * 提供單一實驗計時和多個單元/步驟計時功能
 */

class ExperimentTimerManager {
  constructor() {
    this.experimentStartTime = null;
    this.experimentElapsedMs = 0;
    this.experimentInterval = null;
    this.experimentPaused = false;

    this.timerStates = {};
    this.timerIntervals = {};
    this.longPressTimers = {};
    this.currentActiveIndex = null;

    this.onExperimentTick = null;
    this.onIndexedTick = null;
  }

  // ========== utility ==========
  formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  }

  // ========== experiment timer ==========
  startExperimentTimer() {
    if (this.experimentInterval) return;
    this.experimentStartTime = Date.now();
    this.experimentElapsedMs = 0;
    this.experimentPaused = false;

    this.experimentInterval = setInterval(() => {
      if (!this.experimentPaused) {
        this.experimentElapsedMs = Date.now() - this.experimentStartTime;
        if (typeof this.onExperimentTick === "function")
          this.onExperimentTick(this.experimentElapsedMs);
        const el =
          document.getElementById("experimentTimer") ||
          document.getElementById("experiment-timer");
        if (el) el.textContent = this.formatDuration(this.experimentElapsedMs);
      }
    }, 50);
  }

  pauseExperimentTimer() {
    this.experimentPaused = true;
    if (this.experimentInterval) {
      clearInterval(this.experimentInterval);
      this.experimentInterval = null;
    }

    // 暫停所有運行中的手勢時間卡片計時器
    Object.keys(this.timerStates).forEach((idx) => {
      const state = this.timerStates[idx];
      if (state && state.running) {
        clearInterval(this.timerIntervals[idx]);
        state.running = false;
        state.elapsedTime += Date.now() - state.startTime;
      }
    });
  }

  resumeExperimentTimer() {
    if (!this.experimentStartTime) {
      this.startExperimentTimer();
      return;
    }
    this.experimentStartTime = Date.now() - this.experimentElapsedMs;
    this.experimentPaused = false;
    this.startExperimentTimer();

    // 註：手勢時間卡片計時器不自動恢復
    // 使用者需要主動點擊手勢卡片以繼續計時
  }

  stopExperimentTimer() {
    this.experimentPaused = false;
    if (this.experimentInterval) {
      clearInterval(this.experimentInterval);
      this.experimentInterval = null;
    }
    this.experimentStartTime = null;
    this.experimentElapsedMs = 0;
    const el =
      document.getElementById("experimentTimer") ||
      document.getElementById("experiment-timer");
    if (el) el.textContent = this.formatDuration(0);

    // 停止所有手勢時間卡片計時器並重置狀態
    Object.keys(this.timerStates).forEach((idx) => {
      if (this.timerIntervals[idx]) {
        clearInterval(this.timerIntervals[idx]);
        this.timerIntervals[idx] = null;
      }
      const state = this.timerStates[idx];
      if (state) {
        state.running = false;
        state.elapsedTime = 0;
      }
    });
    this.currentActiveIndex = null;
  }

  getExperimentElapsedMs() {
    return this.experimentElapsedMs;
  }

  // ========== indexed timers (for board per-unit timers) ==========
  _ensureState(idx) {
    if (!this.timerStates[idx]) {
      this.timerStates[idx] = {
        running: false,
        startTime: 0,
        elapsedTime: 0,
        justReset: false,
      };
    }
  }

  toggleIndexedTimer(idx) {
    this._ensureState(idx);
    const state = this.timerStates[idx];
    const card = document.getElementById(`timer-card-${idx}`);

    if (state.running) {
      clearInterval(this.timerIntervals[idx]);
      state.running = false;
      state.elapsedTime += Date.now() - state.startTime;
      if (card) {
        card.classList.remove("timer-card-pressed");
      }
      if (this.currentActiveIndex === idx) {
        this.currentActiveIndex = null;
      }
      if (window.experimentLogManager && window.app) {
        const currentGesture = window.app.currentCombination?.gestures?.[idx];
        const stepId = currentGesture?.step_id || null;
        window.experimentLogManager.logGestureStepPause &&
          window.experimentLogManager.logGestureStepPause(idx, stepId);
      }
    } else {
      if (this.currentActiveIndex !== null && this.currentActiveIndex !== idx) {
        this._clearTimerOutline(this.currentActiveIndex);
      }

      state.running = true;
      state.startTime = Date.now();
      this.currentActiveIndex = idx;

      // 按下計時器的短暫邊框回饋（CSS 動畫 400ms，使用 class 避免 inline style）
      if (card) {
        card.classList.remove("timer-card-pressed");
        // force reflow so animation retriggers if pressed rapidly
        void card.offsetWidth;
        card.classList.add("timer-card-pressed");
        setTimeout(() => card.classList.remove("timer-card-pressed"), 400);
      }

      this.timerIntervals[idx] = setInterval(() => {
        const currentElapsed =
          state.elapsedTime + (Date.now() - state.startTime);
        const display = document.getElementById(`timer-display-${idx}`);
        if (display) display.textContent = this.formatDuration(currentElapsed);
        if (typeof this.onIndexedTick === "function")
          this.onIndexedTick(idx, currentElapsed);
      }, 10);

      if (window.experimentLogManager && window.app) {
        const currentGesture = window.app.currentCombination?.gestures?.[idx];
        const stepId = currentGesture?.step_id || null;
        window.experimentLogManager.logGestureStepStart &&
          window.experimentLogManager.logGestureStepStart(idx, stepId);
      }
    }
  }

  longPressStart(idx) {
    this._ensureState(idx);
    this.longPressTimers[idx] = setTimeout(() => {
      this.resetIndexedTimer(idx);
    }, 1000);
  }

  longPressEnd(idx) {
    if (this.longPressTimers[idx]) {
      clearTimeout(this.longPressTimers[idx]);
      this.longPressTimers[idx] = null;
    }
  }

  resetIndexedTimer(idx) {
    if (this.timerIntervals[idx]) {
      clearInterval(this.timerIntervals[idx]);
    }
    this._clearTimerOutline(idx);
    this.timerStates[idx] = {
      running: false,
      startTime: 0,
      elapsedTime: 0,
      justReset: true,
    };
    if (this.currentActiveIndex === idx) {
      this.currentActiveIndex = null;
    }
    const display = document.getElementById(`timer-display-${idx}`);
    if (display) display.textContent = "00:00.000";
  }

  _clearTimerOutline(idx) {
    const card = document.getElementById(`timer-card-${idx}`);
    if (card) {
      card.classList.remove(
        "timer-card-pressed",
        "timer-card-marked-correct",
        "timer-card-marked-uncertain",
        "timer-card-marked-incorrect",
      );
    }
  }

  getIndexedElapsedSeconds(idx) {
    this._ensureState(idx);
    const state = this.timerStates[idx];
    if (state.running) {
      return Math.floor(
        (state.elapsedTime + (Date.now() - state.startTime)) / 1000,
      );
    }
    return Math.floor((state.elapsedTime || 0) / 1000);
  }
}

// 註冊到全域
const manager = new ExperimentTimerManager();
window.experimentTimerManager = manager;

// 也提供兼容的全域函式名稱（原 board/panel 期待）
window.formatDuration =
  window.formatDuration || ((ms) => manager.formatDuration(ms));
window.toggleTimer =
  window.toggleTimer || ((idx) => manager.toggleIndexedTimer(idx));
window.timerLongPressStart =
  window.timerLongPressStart || ((idx) => manager.longPressStart(idx));
window.timerLongPressEnd =
  window.timerLongPressEnd || ((idx) => manager.longPressEnd(idx));
window.resetTimer =
  window.resetTimer || ((idx) => manager.resetIndexedTimer(idx));
