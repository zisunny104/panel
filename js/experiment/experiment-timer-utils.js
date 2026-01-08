// experiment-timer-utils.js - 實驗計時器工具函式

// ============ 計時器功能 ============
// 儲存每個計時器的狀態
window.timerStates = {};
window.timerIntervals = {};
window.longPressTimers = {};

/**
 * 格式化持續時間顯示：00:00.000
 * @param {number} ms - 毫秒數
 * @returns {string} - 格式化的時間字串
 */
window.formatDuration = function (ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(milliseconds).padStart(3, "0")}`;
};

/**
 * 切換計時器狀態（開始/暫停）
 * @param {number} idx - 計時器索引
 */
window.toggleTimer = function (idx) {
  // 如果正在長按或剛剛完成長按歸零，不執行切換
  if (window.longPressTimers[idx] || window.timerStates[idx]?.justReset) {
    // 清除 justReset 標記
    if (window.timerStates[idx]?.justReset) {
      window.timerStates[idx].justReset = false;
    }
    return;
  }

  const state = window.timerStates[idx] || {
    running: false,
    startTime: 0,
    elapsedTime: 0,
  };

  const card = document.getElementById(`timer-card-${idx}`);

  if (state.running) {
    // 暫停：停止計時並移除粗外框
    clearInterval(window.timerIntervals[idx]);
    state.running = false;
    state.elapsedTime += Date.now() - state.startTime;

    if (card) {
      card.style.outline = "none";
      card.style.outlineOffset = "0";
    }

    // 紀錄步驟暫停
    if (window.experimentLogManager) {
      const currentGesture = window.app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      window.experimentLogManager.logGestureStepPause(idx, stepId);
    }
  } else {
    // 開始：啟動計時並新增粗外框
    state.running = true;
    state.startTime = Date.now();

    if (card) {
      const computedStyle = window.getComputedStyle(card);
      const originalBorderColor = computedStyle.borderColor;
      card.setAttribute("data-original-border-color", originalBorderColor);

      // 使用 outline 避免內容位移，向內偏移模擬加粗邊框
      card.style.outline = `4px solid ${originalBorderColor}`;
      card.style.outlineOffset = "-2px";
    }

    // 啟動更新循環（每 10 毫秒更新一次）
    window.timerIntervals[idx] = setInterval(() => {
      const currentElapsed = state.elapsedTime + (Date.now() - state.startTime);
      const display = document.getElementById(`timer-display-${idx}`);
      if (display) {
        display.textContent = window.formatDuration(currentElapsed);
      }
    }, 10);

    // 紀錄步驟開始
    if (window.experimentLogManager) {
      const currentGesture = window.app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      window.experimentLogManager.logGestureStepStart(idx, stepId);
    }
  }

  window.timerStates[idx] = state;
};

/**
 * 長按開始（準備歸零）
 * @param {number} idx - 計時器索引
 */
window.timerLongPressStart = function (idx) {
  window.longPressTimers[idx] = setTimeout(() => {
    // 長按 1 秒後執行歸零
    window.resetTimer(idx);
  }, 1000);
};

/**
 * 長按結束
 * @param {number} idx - 計時器索引
 */
window.timerLongPressEnd = function (idx) {
  if (window.longPressTimers[idx]) {
    clearTimeout(window.longPressTimers[idx]);
    window.longPressTimers[idx] = null;
  }
};

/**
 * 歸零計時器
 * @param {number} idx - 計時器索引
 */
window.resetTimer = function (idx) {
  if (window.timerIntervals[idx]) {
    clearInterval(window.timerIntervals[idx]);
  }

  const card = document.getElementById(`timer-card-${idx}`);
  if (card) {
    card.style.outline = "none";
    card.style.outlineOffset = "0";
  }

  // 重置狀態，並設定 justReset 標記防止鬆開時立即重新啟動
  window.timerStates[idx] = {
    running: false,
    startTime: 0,
    elapsedTime: 0,
    justReset: true,
  };

  const display = document.getElementById(`timer-display-${idx}`);
  if (display) {
    display.textContent = "00:00.000";
  }
};

//匯出ES6模組
export const formatDuration = window.formatDuration;
export const toggleTimer = window.toggleTimer;
export const timerLongPressStart = window.timerLongPressStart;
export const timerLongPressEnd = window.timerLongPressEnd;
export const resetTimer = window.resetTimer;
