/**
* ExperimentTimerManager - 統一計時器管理器
*
* 提供實驗總計時與步驟計時功能。
*/

import { TimeSyncManager } from "../core/time-sync-manager.js";

export const ExperimentTimerManager = class ExperimentTimerManager {
  constructor(options = {}) {
    this.experimentStartTime = null;
    this.experimentElapsedMs = 0;
    this.experimentInterval = null;
    this.experimentPaused = false;

    this.timeSyncManager =
      options.timeSyncManager || new TimeSyncManager();
    this.experimentLogManager = options.experimentLogManager || null;
    this.getCurrentCombination = options.getCurrentCombination || null;

    this.timerStates = {};
    this.timerIntervals = {};
    this.longPressTimers = {};
    this.currentActiveIndex = null;

    this.onExperimentTick = null;
    this.onIndexedTick = null;
  }

  // ===== 實驗計時 =====
  startExperimentTimer() {
    if (this.experimentInterval) return;
    this.experimentStartTime = Date.now();
    this.experimentElapsedMs = 0;
    this.experimentPaused = false;

    this.experimentInterval = setInterval(() => {
      if (!this.experimentPaused) {
        this.experimentElapsedMs = Date.now() - this.experimentStartTime;
        if (typeof this.onExperimentTick === "function") {
          this.onExperimentTick(this.experimentElapsedMs);
        }
        const el =
          document.getElementById("experimentTimer") ||
          document.getElementById("experiment-timer");
        if (el) {
          el.textContent = this.timeSyncManager.formatStopwatch(
            this.experimentElapsedMs,
          );
        }
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
    if (el) el.textContent = this.timeSyncManager.formatStopwatch(0);

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

  // ===== 步驟計時 =====
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
      if (this.experimentLogManager && this.getCurrentCombination) {
        const currentCombination = this.getCurrentCombination();
        const currentGesture = currentCombination?.gestures?.[idx];
        if (currentGesture?.step_id) {
          this.experimentLogManager.logGestureStepPause(
            idx,
            currentGesture.step_id,
          );
        }
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
        if (display) {
          display.textContent = this.timeSyncManager.formatStopwatch(
            currentElapsed,
          );
        }
        if (typeof this.onIndexedTick === "function") {
          this.onIndexedTick(idx, currentElapsed);
        }
      }, 10);

      if (this.experimentLogManager && this.getCurrentCombination) {
        const currentCombination = this.getCurrentCombination();
        const currentGesture = currentCombination?.gestures?.[idx];
        if (currentGesture?.step_id) {
          this.experimentLogManager.logGestureStepStart(
            idx,
            currentGesture.step_id,
          );
        }
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
};

